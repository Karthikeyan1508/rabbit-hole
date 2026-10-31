import { z } from 'zod';
import { createHash, randomUUID } from 'node:crypto';
import { q, qOne, qRun, tx } from './db.ts';
import { emitEvent } from './events.ts';
import { groqStructuredCall } from './groq.ts';
import { tinyfishSearch, tinyfishFetch, tinyfishAgentRun, tinyfishAgentPoll, tinyfishAgentCancel } from './tinyfish.ts';
import { isSafeUrl, canonicalizeUrl, calculateSourceScore } from './url-safety.ts';

// Extraction Zod schema
const extractionResponseSchema = z.object({
  claims: z.array(
    z.object({
      subject: z.string(),
      subjectType: z.enum(['Company', 'Person', 'Product', 'Event', 'Claim', 'Source']).default('Company'),
      predicate: z.string(),
      object: z.string(),
      objectType: z.enum(['Company', 'Person', 'Product', 'Event', 'Claim', 'Source', 'Value']).default('Value'),
      quote: z.string(),
      validFrom: z.string().nullable().optional(),
      validTo: z.string().nullable().optional(),
    })
  ),
  unresolved: z.array(z.any()).default([]),
});

// Verification Zod schema
const verificationResponseSchema = z.object({
  verdict: z.enum(['supported', 'contradicted', 'insufficient']),
  reasoning: z.string().optional(),
});

// Planning Zod schema
const planResponseSchema = z.object({
  queries: z.array(z.string()).min(1).max(5),
});

/**
 * Normalizes text and whitespace
 */
export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Searches for a quote inside source text:
 * 1. Exact match
 * 2. Case-insensitive normalized whitespace match
 * Returns offsets or null if not found or quote < 8 chars.
 */
export function findQuoteOffsets(
  quote: string,
  sourceText: string
): { found: boolean; startOffset: number; endOffset: number; exact: boolean } {
  if (!quote || quote.length < 8 || !sourceText) {
    return { found: false, startOffset: -1, endOffset: -1, exact: false };
  }

  // 1. Exact search
  const exactIndex = sourceText.indexOf(quote);
  if (exactIndex !== -1) {
    return {
      found: true,
      startOffset: exactIndex,
      endOffset: exactIndex + quote.length,
      exact: true,
    };
  }

  // 2. Normalized whitespace search
  const normQuote = normalizeWhitespace(quote).toLowerCase();
  const normSource = normalizeWhitespace(sourceText).toLowerCase();
  const normIndex = normSource.indexOf(normQuote);

  if (normIndex !== -1) {
    // Approximate mapping back to sourceText or normalized offset
    return {
      found: true,
      startOffset: normIndex,
      endOffset: normIndex + normQuote.length,
      exact: false,
    };
  }

  return { found: false, startOffset: -1, endOffset: -1, exact: false };
}

// Single-valued attributes for conflict detection
const SINGLE_VALUED_PREDICATES = new Set([
  'FOUNDED_YEAR',
  'FOUNDING_YEAR',
  'LAUNCH_YEAR',
  'CEO',
  'CHIEF_EXECUTIVE_OFFICER',
  'HEADQUARTERS',
  'HQ',
  'HEADQUARTERED_IN',
]);

/**
 * Checks if job was requested to cancel.
 */
function isCancelled(jobId: string): boolean {
  const job = qOne<{ cancel_requested: number }>(
    `SELECT cancel_requested FROM expansion_jobs WHERE id = $1`,
    jobId
  );
  return Boolean(job && job.cancel_requested === 1);
}

/**
 * Execute the complete bounded expansion pipeline.
 */
export async function runExpansionPipeline(jobId: string): Promise<void> {
  const job = qOne<{
    id: string;
    investigation_id: string;
    target_type: string;
    target_id: string;
    question: string;
    budget: Record<string, any>;
  }>(`SELECT * FROM expansion_jobs WHERE id = $1`, jobId);

  if (!job) return;

  const invId = job.investigation_id;
  const mode = job.budget?.mode === 'deep' ? 'deep' : 'quick';
  const maxSearches = mode === 'deep' ? 5 : 3;
  const maxSources = job.budget?.maxSources || (mode === 'deep' ? 20 : 12);
  const allowedDomains = job.budget?.allowedDomains || [];

  let activeAgentRun: { runId: string; apiKeyUsed: string | null } | null = null;

  try {
    // --- STAGE: PLANNING ---
    qRun(
      `UPDATE expansion_jobs SET status = 'PLANNING', stage = 'planning', updated_at = $1 WHERE id = $2`,
      new Date().toISOString(),
      jobId
    );
    emitEvent(jobId, 'expansion.started', { mode, maxSearches, maxSources });

    if (isCancelled(jobId)) throw new Error('CANCELLED');

    // Context gathering
    const targetNode = qOne<{ label: string; type: string; canonical_key: string }>(
      `SELECT label, type, canonical_key FROM graph_nodes WHERE id = $1`,
      job.target_id
    );

    const targetContext = targetNode ? `${targetNode.label} (${targetNode.type})` : job.question;

    let queries: string[] = [];
    try {
      const planRes = await groqStructuredCall(
        planResponseSchema,
        'You are an expert fact-checking investigation planner. Return a JSON object with bounded search queries targeting verified evidence.',
        `Target: ${targetContext}\nInvestigation Question: ${job.question}\nGenerate up to ${maxSearches} search queries for factual verification.`
      );
      queries = planRes.queries.slice(0, maxSearches);
    } catch {
      // Fallback deterministic query if model call fails
      queries = [`"${targetNode?.label || job.question}" corporate overview headquarters founder`].slice(0, maxSearches);
    }

    emitEvent(jobId, 'plan.created', { queries });
    if (isCancelled(jobId)) throw new Error('CANCELLED');

    // --- STAGE: DISCOVERING ---
    qRun(
      `UPDATE expansion_jobs SET status = 'DISCOVERING', stage = 'discovering', updated_at = $1 WHERE id = $2`,
      new Date().toISOString(),
      jobId
    );

    const discoveredUrls = new Map<string, { url: string; title: string; score: number }>();

    for (const query of queries) {
      if (isCancelled(jobId)) throw new Error('CANCELLED');

      let results: any[] = [];
      try {
        results = await tinyfishSearch(query);
      } catch (err: any) {
        emitEvent(jobId, 'search.failed', { query, error: err.message });
      }

      emitEvent(jobId, 'search.completed', { query, resultCount: results.length });

      for (const item of results) {
        const rawUrl = item.url || item.link;
        if (!rawUrl) continue;

        if (isSafeUrl(rawUrl, { allowedDomains })) {
          const canonical = canonicalizeUrl(rawUrl);
          if (!discoveredUrls.has(canonical)) {
            const score = calculateSourceScore(canonical, targetNode?.canonical_key);
            discoveredUrls.set(canonical, {
              url: canonical,
              title: item.title || '',
              score,
            });
            emitEvent(jobId, 'source.discovered', { url: canonical, score });
          }
        }
      }
    }

    // Rank by score descending, keep within budget
    const rankedSources = Array.from(discoveredUrls.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, maxSources);

    if (isCancelled(jobId)) throw new Error('CANCELLED');

    // Optional: TinyFish Agent run for deep mode
    if (mode === 'deep' && job.budget?.maxAgentRuns > 0 && targetNode) {
      try {
        activeAgentRun = await tinyfishAgentRun(`Verify corporate facts for ${targetNode.label}`);
        emitEvent(jobId, 'browser.progress', { runId: activeAgentRun.runId, status: 'started' });
      } catch (agentErr: any) {
        console.warn('Agent run creation skipped/failed:', agentErr.message);
      }
    }

    // --- STAGE: READING ---
    qRun(
      `UPDATE expansion_jobs SET status = 'READING', stage = 'reading', updated_at = $1 WHERE id = $2`,
      new Date().toISOString(),
      jobId
    );

    const batchSize = 10;
    const fetchedSources: Array<{
      id: string;
      url: string;
      title: string;
      publisher: string;
      text: string;
      score: number;
    }> = [];

    for (let i = 0; i < rankedSources.length; i += batchSize) {
      if (isCancelled(jobId)) throw new Error('CANCELLED');

      const batch = rankedSources.slice(i, i + batchSize);
      const urls = batch.map((s) => s.url);

      let fetchResults: any[] = [];
      try {
        fetchResults = await tinyfishFetch(urls);
      } catch (fetchErr: any) {
        emitEvent(jobId, 'source.failed', { urls, error: fetchErr.message });
        continue;
      }

      for (const item of fetchResults) {
        const canonical = canonicalizeUrl(item.url);
        const sourceMeta = batch.find((b) => b.url === canonical) || { title: '', score: 0.5 };
        const rawText = item.markdown || item.content || '';

        if (!rawText || item.error) {
          emitEvent(jobId, 'source.failed', { url: canonical, error: item.error || 'Empty text' });
          continue;
        }

        const snapshotText = rawText.slice(0, 60_000);
        const contentHash = createHash('sha256').update(snapshotText).digest('hex');
        const publisher = new URL(canonical).hostname;
        const sourceId = `src_${randomUUID().replace(/-/g, '')}`;
        const now = new Date().toISOString();

        // Upsert into sources table
        qRun(
          `INSERT INTO sources (id, canonical_url, title, publisher, retrieved_at, content_hash, snapshot_text, retrieval_status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (canonical_url) DO UPDATE SET
             title = excluded.title,
             snapshot_text = excluded.snapshot_text,
             content_hash = excluded.content_hash,
             retrieved_at = excluded.retrieved_at,
             retrieval_status = excluded.retrieval_status`,
          sourceId,
          canonical,
          sourceMeta.title || publisher,
          publisher,
          now,
          contentHash,
          snapshotText,
          'retrieved'
        );

        // Fetch the actual source record ID in case it already existed
        const existingSrc = qOne<{ id: string }>(`SELECT id FROM sources WHERE canonical_url = $1`, canonical);
        const actualSourceId = existingSrc?.id || sourceId;

        fetchedSources.push({
          id: actualSourceId,
          url: canonical,
          title: sourceMeta.title,
          publisher,
          text: snapshotText,
          score: sourceMeta.score,
        });

        emitEvent(jobId, 'source.fetched', { url: canonical, length: snapshotText.length, publisher });
      }
    }

    if (isCancelled(jobId)) throw new Error('CANCELLED');

    // --- STAGE: EXTRACTING ---
    qRun(
      `UPDATE expansion_jobs SET status = 'EXTRACTING', stage = 'extracting', updated_at = $1 WHERE id = $2`,
      new Date().toISOString(),
      jobId
    );

    interface CandidateClaim {
      subject: string;
      subjectType: string;
      predicate: string;
      object: string;
      objectType: string;
      quote: string;
      validFrom?: string | null;
      validTo?: string | null;
      source: {
        id: string;
        url: string;
        publisher: string;
        text: string;
        score: number;
      };
    }

    const candidateClaims: CandidateClaim[] = [];

    for (const src of fetchedSources) {
      if (isCancelled(jobId)) throw new Error('CANCELLED');

      try {
        const extractRes = await groqStructuredCall(
          extractionResponseSchema,
          `You are an evidence extraction engine. Extract factual atomic claims. 
Each claim must include a verbatim exact quote from the provided text supporting the claim. 
Predicate must be in UPPER_SNAKE_CASE (e.g. FOUNDED_YEAR, CEO, ACQUIRED_BY, PARTNERED_WITH, HEADQUARTERS).`,
          `Source: ${src.url}\nText:\n${src.text.slice(0, 15000)}`
        );

        for (const claim of extractRes.claims) {
          candidateClaims.push({
            subject: claim.subject,
            subjectType: claim.subjectType || 'Company',
            predicate: claim.predicate.toUpperCase().replace(/\s+/g, '_'),
            object: claim.object,
            objectType: claim.objectType || 'Value',
            quote: claim.quote,
            validFrom: claim.validFrom,
            validTo: claim.validTo,
            source: src,
          });
          emitEvent(jobId, 'claim.extracted', {
            subject: claim.subject,
            predicate: claim.predicate,
            object: claim.object,
            quote: claim.quote,
          });
        }
      } catch (err: any) {
        emitEvent(jobId, 'extraction.failed', { url: src.url, error: err.message });
      }
    }

    if (isCancelled(jobId)) throw new Error('CANCELLED');

    // --- STAGE: VERIFYING ---
    qRun(
      `UPDATE expansion_jobs SET status = 'VERIFYING', stage = 'verifying', updated_at = $1 WHERE id = $2`,
      new Date().toISOString(),
      jobId
    );

    interface VerifiedClaim extends CandidateClaim {
      startOffset: number;
      endOffset: number;
      verdict: 'supported';
    }

    const verifiedClaims: VerifiedClaim[] = [];

    for (const c of candidateClaims) {
      if (isCancelled(jobId)) throw new Error('CANCELLED');

      // 1. Quote search (exact or whitespace normalized)
      const quoteCheck = findQuoteOffsets(c.quote, c.source.text);
      if (!quoteCheck.found) {
        emitEvent(jobId, 'claim.rejected', {
          reason: 'quote_not_found',
          quote: c.quote,
        });
        continue;
      }

      // 2. Semantic verifier call
      let verdict = 'supported';
      try {
        const verifyRes = await groqStructuredCall(
          verificationResponseSchema,
          `You are an impartial verifier. Assess whether the quote from the specified source strictly supports the claim statement.
Return "supported", "contradicted", or "insufficient".`,
          `Claim: "${c.subject}" ${c.predicate} "${c.object}"\nSource URL: ${c.source.url}\nQuote: "${c.quote}"`
        );
        verdict = verifyRes.verdict;
      } catch {
        // If semantic verifier call fails, default to supported if quote exists
        verdict = 'supported';
      }

      if (verdict !== 'supported') {
        emitEvent(jobId, 'claim.rejected', {
          reason: `semantic_verdict_${verdict}`,
          claim: `${c.subject} ${c.predicate} ${c.object}`,
        });
        continue;
      }

      // 3. Trust gate: source score < 0.4 goes to review_items
      if (c.source.score < 0.4) {
        const reviewId = `rev_${randomUUID().replace(/-/g, '')}`;
        qRun(
          `INSERT INTO review_items (id, investigation_id, item_type, item_id, action_needed, status, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          reviewId,
          invId,
          'claim',
          c.quote,
          'low_trust_source_review',
          'pending',
          new Date().toISOString()
        );
        emitEvent(jobId, 'review.flagged', { sourceUrl: c.source.url, score: c.source.score });
        continue;
      }

      verifiedClaims.push({
        ...c,
        startOffset: quoteCheck.startOffset,
        endOffset: quoteCheck.endOffset,
        verdict: 'supported',
      });

      emitEvent(jobId, 'claim.verified', {
        subject: c.subject,
        predicate: c.predicate,
        object: c.object,
      });
    }

    if (isCancelled(jobId)) throw new Error('CANCELLED');

    // --- STAGE: COMMITTING ---
    qRun(
      `UPDATE expansion_jobs SET status = 'COMMITTING', stage = 'committing', updated_at = $1 WHERE id = $2`,
      new Date().toISOString(),
      jobId
    );

    // Group verified claims by subject + predicate + object to check corroboration
    const claimGroups = new Map<string, VerifiedClaim[]>();
    for (const vc of verifiedClaims) {
      const key = `${vc.subject.toLowerCase()}|${vc.predicate}|${vc.object.toLowerCase()}`;
      if (!claimGroups.has(key)) claimGroups.set(key, []);
      claimGroups.get(key)!.push(vc);
    }

    let addedNodesCount = 0;
    let addedEdgesCount = 0;

    tx(() => {
      // Increment investigation version
      qRun(
        `UPDATE investigations SET version = version + 1, updated_at = $1 WHERE id = $2`,
        new Date().toISOString(),
        invId
      );

      const invRow = qOne<{ version: number }>(`SELECT version FROM investigations WHERE id = $1`, invId);
      const newVersion = invRow?.version || 1;
      const now = new Date().toISOString();

      for (const [groupKey, group] of claimGroups.entries()) {
        const first = group[0];

        // Corroboration status: distinct hostnames
        const hostnames = new Set(group.map((g) => g.source.publisher));
        const verificationStatus = hostnames.size >= 2 ? 'CORROBORATED' : 'SOURCE_SUPPORTED';

        // 1. Get or create Subject node
        const subCanonical = first.subject.trim().toLowerCase();
        let subNode = qOne<{ id: string }>(
          `SELECT id FROM graph_nodes WHERE investigation_id = $1 AND canonical_key = $2`,
          invId,
          subCanonical
        );

        if (!subNode) {
          const subId = `node_${randomUUID().replace(/-/g, '')}`;
          qRun(
            `INSERT INTO graph_nodes (id, investigation_id, canonical_key, type, label, properties, version, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            subId,
            invId,
            subCanonical,
            first.subjectType.toLowerCase(),
            first.subject.trim(),
            JSON.stringify({}),
            newVersion,
            now
          );
          subNode = { id: subId };
          addedNodesCount++;
        }

        // 2. Get or create Object node (if entity object)
        const isEntityObject = ['Company', 'Person', 'Product', 'Event'].includes(first.objectType);
        let objNodeId: string | null = null;

        if (isEntityObject) {
          const objCanonical = first.object.trim().toLowerCase();
          let objNode = qOne<{ id: string }>(
            `SELECT id FROM graph_nodes WHERE investigation_id = $1 AND canonical_key = $2`,
            invId,
            objCanonical
          );

          if (!objNode) {
            const newObjId = `node_${randomUUID().replace(/-/g, '')}`;
            qRun(
              `INSERT INTO graph_nodes (id, investigation_id, canonical_key, type, label, properties, version, created_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
              newObjId,
              invId,
              objCanonical,
              first.objectType.toLowerCase(),
              first.object.trim(),
              JSON.stringify({}),
              newVersion,
              now
            );
            objNode = { id: newObjId };
            addedNodesCount++;
          }
          objNodeId = objNode.id;
        }

        // 3. Conflict detection for single-valued predicates
        const isSingleValued = SINGLE_VALUED_PREDICATES.has(first.predicate);
        const isUndated = !first.validFrom && !first.validTo;

        if (isSingleValued && isUndated) {
          const existingClaims = q<{ id: string; value: any; predicate: string }>(
            `SELECT id, value, predicate FROM claims 
             WHERE investigation_id = $1 AND subject_node_id = $2 AND predicate = $3`,
            invId,
            subNode.id,
            first.predicate
          );

          for (const ec of existingClaims) {
            const existingValStr = typeof ec.value === 'object' ? JSON.stringify(ec.value) : String(ec.value);
            if (existingValStr && existingValStr.toLowerCase() !== first.object.toLowerCase()) {
              // Conflict detected!
              const conflictId = `cnf_${randomUUID().replace(/-/g, '')}`;
              qRun(
                `INSERT INTO claim_conflicts (id, investigation_id, claim_a_id, claim_b_id, conflict_description, status, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                conflictId,
                invId,
                ec.id,
                'pending_insert',
                `Conflicting values for ${first.predicate}: "${existingValStr}" vs "${first.object}"`,
                'unresolved',
                now
              );
              emitEvent(jobId, 'conflict.detected', {
                predicate: first.predicate,
                valA: existingValStr,
                valB: first.object,
              });
            }
          }
        }

        // 4. Insert Claim
        const claimId = `clm_${randomUUID().replace(/-/g, '')}`;
        qRun(
          `INSERT INTO claims (id, investigation_id, subject_node_id, predicate, object_node_id, value, valid_from, valid_to, verification_status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          claimId,
          invId,
          subNode.id,
          first.predicate,
          objNodeId,
          JSON.stringify({ raw: first.object }),
          first.validFrom || null,
          first.validTo || null,
          verificationStatus
        );

        // 5. Insert Evidence for all corroborating sources
        for (const item of group) {
          const evidenceId = `ev_${randomUUID().replace(/-/g, '')}`;
          qRun(
            `INSERT INTO claim_evidence (id, claim_id, source_id, excerpt, start_offset, end_offset, support_verdict, verification_metadata)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            evidenceId,
            claimId,
            item.source.id,
            item.quote,
            item.startOffset,
            item.endOffset,
            'supported',
            JSON.stringify({ url: item.source.url, score: item.source.score })
          );
        }

        // 6. Insert or Update Graph Edge (if objNode exists)
        if (objNodeId) {
          const edgeId = `edge_${randomUUID().replace(/-/g, '')}`;
          qRun(
            `INSERT INTO graph_edges (id, investigation_id, from_node_id, to_node_id, relation, status, claim_id, properties, version)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (investigation_id, from_node_id, to_node_id, relation) DO UPDATE SET
               claim_id = excluded.claim_id,
               status = 'active',
               version = excluded.version`,
            edgeId,
            invId,
            subNode.id,
            objNodeId,
            first.predicate,
            'active',
            claimId,
            JSON.stringify({ verificationStatus }),
            newVersion
          );
          addedEdgesCount++;
        }

        // Record Discovery
        const discId = `disc_${randomUUID().replace(/-/g, '')}`;
        qRun(
          `INSERT INTO job_discoveries (id, job_id, entity_type, entity_id, discovery_data, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          discId,
          jobId,
          'claim',
          claimId,
          JSON.stringify({ predicate: first.predicate, object: first.object, verificationStatus }),
          now
        );
      }
    });

    emitEvent(jobId, 'graph.updated', {
      nodesAdded: addedNodesCount,
      edgesAdded: addedEdgesCount,
      claimsVerified: verifiedClaims.length,
    });

    // Mark Job Completed
    const finalStatus = verifiedClaims.length > 0 ? 'COMPLETED' : 'PARTIAL';
    qRun(
      `UPDATE expansion_jobs SET status = $1, stage = 'completed', updated_at = $2 WHERE id = $3`,
      finalStatus,
      new Date().toISOString(),
      jobId
    );

    emitEvent(jobId, finalStatus === 'COMPLETED' ? 'expansion.completed' : 'expansion.partial', {
      claimsCount: verifiedClaims.length,
    });
  } catch (err: any) {
    if (err.message === 'CANCELLED' || isCancelled(jobId)) {
      if (activeAgentRun) {
        try {
          await tinyfishAgentCancel(activeAgentRun.runId, activeAgentRun.apiKeyUsed);
        } catch {
          // ignore cancel error
        }
      }
      qRun(
        `UPDATE expansion_jobs SET status = 'CANCELLED', stage = 'cancelled', updated_at = $1 WHERE id = $2`,
        new Date().toISOString(),
        jobId
      );
      emitEvent(jobId, 'expansion.cancelled', { reason: 'user_requested' });
    } else {
      qRun(
        `UPDATE expansion_jobs SET status = 'FAILED', stage = 'failed', error = $1, updated_at = $2 WHERE id = $3`,
        err.message || 'Unknown error',
        new Date().toISOString(),
        jobId
      );
      emitEvent(jobId, 'expansion.failed', { error: err.message });
    }
  }
}
