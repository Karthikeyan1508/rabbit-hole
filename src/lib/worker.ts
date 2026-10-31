import { z } from "zod";
import { placeholders, q, tx } from "./db";
import { ask } from "./llm";
import * as tf from "./tinyfish";
import { agentText } from "./agenttext";
import { notifyWatch } from "./notify";
import { scoreSource } from "./quality";
import { canon, host, isSafeUrl } from "./urlguard";
import { independentCount, keyOf, locate, normalize, sha256 } from "./verify";

export const TERMINAL = ["COMPLETED", "PARTIAL", "FAILED", "CANCELLED"];
const MAX_SNAPSHOT = 60_000;
const LLM_WINDOW = 15_000;
// claims backed only by pages scoring below this (social, job posts) wait for a human instead of entering the graph
const MIN_TRUST = 0.4;
const SINGLE_VALUED = /^(FOUNDED_IN|LAUNCHED_IN|HEADQUARTERED_IN|HAS_CEO|CEO|FOUNDED_YEAR|LAUNCH_YEAR)$/;
const TYPES = ["Company", "Person", "Product", "Event", "Claim", "Source"];

export type Config = { mode: "quick" | "deep"; maxDepth: number; depth?: number; docIds?: string[]; agent?: boolean; agentUrl?: string; maxSources: number; maxAgentRuns: number; allowedDomains?: string[] };
type Budget = Config & { maxSearches: number; maxSeconds: number };

// shortcut: jobs run in this process (state is durable in SQLite, execution is not); move to pg-boss when deploying beyond one instance
const g = globalThis as unknown as { __running?: Set<string> };
export const running = (g.__running ??= new Set<string>());
class Cancelled extends Error {}

export async function emit(jobId: string, type: string, payload: object = {}) {
  await q(
    `insert into expansion_events (job_id, sequence_number, event_type, payload)
     select $1, coalesce(max(sequence_number), 0) + 1, $2, $3 from expansion_events where job_id = $1`,
    [jobId, type, JSON.stringify(payload)],
  );
}

/* ---------- creation ---------- */

export async function createExpansion(
  invId: string, input: { target: { type: "entity" | "claim" | "edge"; id: string }; question: string; config?: Partial<Config> },
  idemKey?: string, parentId?: string,
) {
  if (idemKey) {
    const [dup] = await q("select id, status from expansion_jobs where investigation_id=$1 and idempotency_key=$2", [invId, idemKey]);
    if (dup) return { job: dup, existing: true };
  }
  const table = { entity: "graph_nodes", claim: "claims", edge: "graph_edges" }[input.target.type];
  const [t] = await q(`select id from ${table} where id=$1 and investigation_id=$2`, [input.target.id, invId]);
  if (!t) throw Object.assign(new Error("Target not found in investigation"), { status: 404, code: "TARGET_NOT_FOUND" });

  const active = await q(`select id from expansion_jobs where investigation_id=$1 and status not in (${placeholders(TERMINAL.length, 2)})`, [invId, ...TERMINAL]);
  for (const a of active) {
    if (running.has(a.id)) throw Object.assign(new Error("An expansion is already active"), { status: 409, code: "EXPANSION_ACTIVE" });
    await q("update expansion_jobs set status='FAILED', finished_at=(strftime('%Y-%m-%dT%H:%M:%fZ','now')), error=$2 where id=$1", [a.id, JSON.stringify({ message: "Worker lost (server restarted)" })]);
  }

  const c = input.config ?? {};
  const deep = c.mode === "deep";
  const budget: Budget = {
    mode: deep ? "deep" : "quick", maxDepth: Math.min(c.maxDepth ?? 1, 3), depth: c.depth ?? 1, maxSources: Math.min(c.maxSources ?? 12, 20),
    maxAgentRuns: Math.min(c.maxAgentRuns ?? 2, 3), allowedDomains: c.allowedDomains, docIds: c.docIds, agent: c.agent, agentUrl: c.agentUrl,
    maxSearches: deep ? 5 : 3, maxSeconds: (deep ? 300 : 180) + (c.agent ? 240 : 0), // a live browser run needs its own time
  };
  const [job] = await q(
    `insert into expansion_jobs (investigation_id, parent_id, idempotency_key, target_type, target_id, question, status, budget)
     values ($1,$2,$3,$4,$5,$6,'QUEUED',$7) returning id, status`,
    [invId, parentId ?? null, idemKey ?? null, input.target.type, input.target.id, input.question, JSON.stringify(budget)],
  );
  await emit(job.id, "expansion.started", { question: input.question, budget });
  running.add(job.id);
  void runJob(job.id).finally(() => { running.delete(job.id); void autoExpand(job.id); void notifyWatch(job.id); });
  return { job, existing: false };
}

/* ---------- context ---------- */

async function describeTarget(job: any): Promise<string> {
  const inv = job.investigation_id;
  if (job.target_type === "entity") {
    const [n] = await q("select id, label, type from graph_nodes where id=$1", [job.target_id]);
    const rel = await q(
      `select a.label as f, e.relation, b.label as t from graph_edges e join graph_nodes a on a.id=e.from_node_id join graph_nodes b on b.id=e.to_node_id
       where e.investigation_id=$1 and (e.from_node_id=$2 or e.to_node_id=$2) limit 20`, [inv, n.id]);
    return `Entity "${n.label}" (${n.type}). Known relationships: ${rel.map(r => `${r.f} ${r.relation} ${r.t}`).join("; ") || "none"}`;
  }
  if (job.target_type === "edge") {
    const [e] = await q(
      `select a.label as f, e.relation, b.label as t, e.claim_id from graph_edges e join graph_nodes a on a.id=e.from_node_id join graph_nodes b on b.id=e.to_node_id where e.id=$1`, [job.target_id]);
    const ev = e.claim_id ? await q("select excerpt from claim_evidence where claim_id=$1 limit 3", [e.claim_id]) : [];
    return `Relationship: ${e.f} ${e.relation} ${e.t}. Existing evidence: ${ev.map(x => `"${x.excerpt}"`).join(" | ") || "none"}`;
  }
  const [c] = await q(
    `select a.label as s, c.predicate, b.label as o, c.value from claims c join graph_nodes a on a.id=c.subject_node_id left join graph_nodes b on b.id=c.object_node_id where c.id=$1`, [job.target_id]);
  const ev = await q("select excerpt from claim_evidence where claim_id=$1 limit 3", [job.target_id]);
  return `Claim: ${c.s} ${c.predicate} ${c.o ?? JSON.stringify(c.value)}. Existing evidence: ${ev.map(x => `"${x.excerpt}"`).join(" | ") || "none"}`;
}

/* ---------- schemas ---------- */

const Plan = z.object({ queries: z.array(z.string()).min(1).max(5), expected: z.string().optional() });
const Extraction = z.object({
  claims: z.array(z.object({
    subject: z.string(), subjectType: z.string(), predicate: z.string(), object: z.string(), objectType: z.string(),
    quote: z.string(), validFrom: z.string().nullish(), validTo: z.string().nullish(),
  })).max(15),
  unresolved: z.array(z.string()).max(5).default([]),
});
const Judgment = z.object({ judgments: z.array(z.object({ i: z.number(), verdict: z.enum(["supported", "contradicted", "insufficient"]), reason: z.string() })) });

/* ---------- pipeline ---------- */

type Doc = { id: string; url: string; host: string; text: string; title?: string };
type Accepted = { c: z.infer<typeof Extraction>["claims"][number]; doc: Doc; start: number; end: number; reason: string };

export async function runJob(id: string) {
  const [job] = await q("select * from expansion_jobs where id=$1", [id]);
  const b: Budget = job.budget;
  const t0 = Date.now();
  const usage = { searches: 0, sourcesDiscovered: 0, sourcesFetched: 0, sourcesFailed: 0, claimsExtracted: 0, claimsAccepted: 0, llmErrors: 0, agentRuns: 0, runIds: [] as string[], unresolved: [] as string[], failed: [] as string[] };
  const flush = (stage: string, status?: string) =>
    q("update expansion_jobs set stage=$2, status=coalesce($3,status), usage=$4, started_at=coalesce(started_at, (strftime('%Y-%m-%dT%H:%M:%fZ','now'))) where id=$1", [id, stage, status ?? null, JSON.stringify(usage)]);
  const checkpoint = async () => {
    const [r] = await q("select cancel_requested from expansion_jobs where id=$1", [id]);
    if (r.cancel_requested) throw new Cancelled();
    return Date.now() - t0 > b.maxSeconds * 1000; // true => budget exhausted, finish with what we have
  };
  let partial = false;

  try {
    // PLANNING
    await flush("PLANNING", "PLANNING");
    const context = await describeTarget(job);
    const parentQs = job.parent_id ? (await q("select payload from expansion_events where job_id=$1 and event_type='plan.created'", [job.parent_id])).flatMap(r => r.payload.queries ?? []) : [];
    const upload = !!b.docIds?.length; // uploaded documents replace web search entirely
    const plan = upload ? { queries: [] as string[], expected: "facts stated in the uploaded document" } : await ask(Plan,
      `You plan focused web research. Output {"queries": [up to ${b.maxSearches} distinct web search queries], "expected": "what to extract"}. Avoid repeating prior queries.`,
      `Target: ${context}\nUser question: ${job.question}\nPrior queries: ${parentQs.join(" | ") || "none"}`);
    const queries = plan.queries.slice(0, b.maxSearches);
    await emit(id, "plan.created", { queries, expected: plan.expected });

    // DISCOVERING
    await flush("DISCOVERING", "DISCOVERING");
    const cands = new Map<string, tf.Hit>();
    const found = new Map<string, tf.Hit>();
    const subjects = await subjectsOf(job);
    for (const query of queries) {
      if (await checkpoint()) { partial = true; break; }
      try {
        const hits = await tf.search(query);
        usage.searches++;
        for (const h of hits) if (isSafeUrl(h.url, b.allowedDomains)) { const k = canon(h.url); if (!found.has(k)) found.set(k, h); }
        await emit(id, "search.completed", { query, results: hits.length });
      } catch (e) {
        await emit(id, "search.completed", { query, error: String(e) });
      }
    }
    // spend the source budget on the most trustworthy pages first
    const ranked = [...found].map(([k, h]) => ({ k, h, ...scoreSource(k, subjects) })).sort((a, b2) => b2.score - a.score).slice(0, b.maxSources);
    for (const r of ranked) {
      cands.set(r.k, r.h);
      usage.sourcesDiscovered++;
      await emit(id, "source.discovered", { url: r.k, title: r.h.title, kind: r.kind, score: r.score });
    }
    await flush("DISCOVERING");

    // READING
    await flush("READING", "READING");
    const docs: Doc[] = [];
    for (const docId of b.docIds ?? []) {
      const [s] = await q("select id, canonical_url as url, title, snapshot_text as text from sources where id=$1", [docId]);
      if (!s) continue;
      docs.push({ id: s.id, url: s.url, host: "", text: s.text, title: s.title });
      usage.sourcesFetched++;
      await emit(id, "source.fetched", { sourceId: s.id, url: s.url, title: s.title, chars: s.text.length, via: "upload" });
    }
    const urls = [...cands.keys()];
    for (let i = 0; i < urls.length && !partial; i += 10) {
      if (await checkpoint()) { partial = true; break; }
      try {
        const { results, errors } = await tf.fetchPages(urls.slice(i, i + 10));
        for (const p of results) {
          const url = canon(p.final_url ?? p.url);
          if (!isSafeUrl(url, b.allowedDomains)) continue; // revalidate redirects
          docs.push(await saveSource(id, url, p.title, p.text, "ok", usage));
        }
        for (const e of errors) { usage.sourcesFailed++; usage.failed.push(e.url); await emit(id, "source.failed", e); }
      } catch (e) {
        usage.sourcesFailed += urls.slice(i, i + 10).length;
        await emit(id, "source.failed", { error: String(e) });
      }
    }

    // Browser agent: always when the user asked for it (on their URL, else the best-ranked page), otherwise only when plain fetch produced nothing usable
    const agentUrls = b.agent ? [b.agentUrl ?? urls[0]].filter(Boolean) : !docs.length ? urls : [];
    if (agentUrls.length && b.maxAgentRuns > 0 && !partial) {
      for (const url of agentUrls.slice(0, b.agent ? 1 : b.maxAgentRuns)) {
        if (await checkpoint()) { partial = true; break; }
        const d = await agentRead(id, url, job.question, b, usage, t0, checkpoint);
        if (d) b.agent ? docs.unshift(d) : docs.push(d); // a requested agent run is read first so the time budget can't cut it off
      }
    }
    await flush("READING");

    // EXTRACTING + VERIFYING
    const accepted: Accepted[] = [];
    for (const doc of docs) {
      if (await checkpoint()) { partial = true; break; }
      await flush("EXTRACTING", "EXTRACTING");
      let ex: { claims: z.infer<typeof Extraction>["claims"]; unresolved: string[] };
      try {
        const parsed = await ask(Extraction,
          `Extract factual claims relevant to the user's question from the source. Each claim: subject, subjectType, predicate (UPPER_SNAKE_CASE, e.g. OFFERS_PRODUCT, COMPETES_WITH, PARTNERS_WITH, INVESTED_IN, FOUNDED_BY, ACQUIRED, LAUNCHED_IN), object, objectType (one of ${TYPES.join("|")}|Value), a VERBATIM quote (8-300 chars) copied exactly from the source that states it, validFrom/validTo if the claim is time-bound (else null). Subject and entity objects must be short proper names (max 6 words); use objectType Value for descriptions. Never infer beyond the text. List open questions in "unresolved". Output {"claims":[...],"unresolved":[...]}.`,
          `Target: ${context}\nQuestion: ${job.question}\n<source url="${doc.url}">\n${doc.text.slice(0, LLM_WINDOW)}\n</source>`);
        ex = { claims: parsed.claims, unresolved: parsed.unresolved ?? [] };
      } catch (e) { usage.llmErrors++; await emit(id, "claim.extracted", { sourceUrl: doc.url, error: String(e) }); continue; }
      usage.claimsExtracted += ex.claims.length;
      usage.unresolved.push(...ex.unresolved);
      for (const c of ex.claims) await emit(id, "claim.extracted", { subject: c.subject, predicate: c.predicate, object: c.object, sourceUrl: doc.url });

      await flush("VERIFYING", "VERIFYING");
      const located = ex.claims.map(c => ({ c, loc: locate(doc.text, c.quote) }));
      for (const x of located.filter(x => !x.loc)) await emit(id, "claim.verified", { sourceUrl: doc.url, subject: x.c.subject, predicate: x.c.predicate, object: x.c.object, accepted: false, status: "REJECTED", reason: "quote not found in source snapshot" });
      const ok = located.filter((x): x is { c: typeof x.c; loc: [number, number] } => !!x.loc);
      if (!ok.length) continue;
      let judged: z.infer<typeof Judgment>["judgments"] = [];
      try {
        judged = (await ask(Judgment,
          `For each numbered claim decide if the excerpt alone states it. verdict: supported | contradicted | insufficient. A lexical match is not enough; the excerpt must actually assert the relationship. Each excerpt comes from the page at the given SOURCE url, so the page's owner is known from its domain: a product, service or program listed on a company's own website counts as that company offering it. Output {"judgments":[{"i":0,"verdict":"supported","reason":"..."}]}.`,
          `<source>\n${ok.map((x, i) => `[${i}] CLAIM: ${x.c.subject} ${x.c.predicate} ${x.c.object}\nSOURCE: ${doc.url}\nEXCERPT: ${x.c.quote}`).join("\n\n")}\n</source>`)).judgments;
      } catch (e) { usage.llmErrors++; await emit(id, "claim.verified", { error: String(e), accepted: false }); }
      for (const [i, x] of ok.entries()) {
        const j = judged.find(j => j.i === i);
        const good = j?.verdict === "supported";
        if (good) accepted.push({ c: x.c, doc, start: x.loc[0], end: x.loc[1], reason: j.reason });
        await emit(id, "claim.verified", { sourceUrl: doc.url, subject: x.c.subject, predicate: x.c.predicate, object: x.c.object, accepted: good, status: good ? "SOURCE_SUPPORTED" : j?.verdict === "contradicted" ? "CONFLICTING" : "INSUFFICIENT_EVIDENCE", reason: j?.reason ?? "no judgment" });
      }
    }
    usage.claimsAccepted = accepted.length;

    // COMMITTING
    await flush("COMMITTING", "COMMITTING");
    const trusted = accepted.filter(a => scoreSource(a.doc.url, subjects).score >= MIN_TRUST);
    const queue = accepted.filter(a => !trusted.includes(a));
    const result = await commit(id, job, trusted);
    for (const a of queue) {
      await q(
        `insert into review_items (investigation_id, job_id, subject, subject_type, predicate, object, object_type, valid_from, valid_to, source_id, start_offset, end_offset, excerpt, source_kind)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [job.investigation_id, id, a.c.subject, a.c.subjectType, a.c.predicate, a.c.object, a.c.objectType, a.c.validFrom ?? null, a.c.validTo ?? null,
          a.doc.id, a.start, a.end, a.doc.text.slice(a.start, a.end), scoreSource(a.doc.url, subjects).kind]);
    }
    await flush("COMMITTING");

    const nextQuestions = await suggest(context, job.question, accepted, usage.unresolved);
    const summary = { ...result, llmErrors: usage.llmErrors, queued: queue.length, nextQuestions, sourcesConsulted: docs.length, sourcesFailed: usage.failed, unresolved: usage.unresolved, claimsRejected: usage.claimsExtracted - accepted.length };
    const final = partial || (usage.llmErrors > 0 && !accepted.length) ? "PARTIAL" : "COMPLETED"; // a run that never got model output is not a clean completion
    await q("update expansion_jobs set status=$2, stage=$2, finished_at=(strftime('%Y-%m-%dT%H:%M:%fZ','now')), usage=$3 where id=$1", [id, final, JSON.stringify({ ...usage, summary })]);
    await emit(id, final === "PARTIAL" ? "expansion.partial" : "expansion.completed", summary);
  } catch (e) {
    if (e instanceof Cancelled) {
      await Promise.allSettled(usage.runIds.map(tf.cancelRun));
      await q("update expansion_jobs set status='CANCELLED', finished_at=(strftime('%Y-%m-%dT%H:%M:%fZ','now')), usage=$2 where id=$1", [id, JSON.stringify(usage)]);
      await emit(id, "expansion.cancelled");
    } else {
      const error = { message: String(e instanceof Error ? e.message : e) };
      await q("update expansion_jobs set status='FAILED', finished_at=(strftime('%Y-%m-%dT%H:%M:%fZ','now')), error=$2, usage=$3 where id=$1", [id, JSON.stringify(error), JSON.stringify(usage)]);
      await emit(id, "expansion.failed", error);
    }
  }
}

async function saveSource(jobId: string, url: string, title: string | undefined, raw: string, status: string, usage: { sourcesFetched: number }): Promise<Doc> {
  const text = normalize(raw).slice(0, MAX_SNAPSHOT);
  const [s] = await q(
    `insert into sources (canonical_url, title, publisher, content_hash, snapshot_text, retrieval_status) values ($1,$2,$3,$4,$5,$6)
     on conflict (canonical_url) do update set title=excluded.title, content_hash=excluded.content_hash, snapshot_text=excluded.snapshot_text, retrieval_status=excluded.retrieval_status, retrieved_at=(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     returning id`, [url, title ?? null, host(url), sha256(text), text, status]);
  usage.sourcesFetched++;
  await emit(jobId, "source.fetched", { sourceId: s.id, url, title, chars: text.length, via: status });
  return { id: s.id, url, host: host(url), text, title };
}

/** TinyFish Agent run. COMPLETED only means the run ended; the output is just another untrusted snapshot that still has to pass quote + support checks. */
async function agentRead(jobId: string, url: string, question: string, b: Budget, usage: any, t0: number, checkpoint: () => Promise<boolean>): Promise<Doc | null> {
  try {
    const runId = await tf.startRun(url, `Navigate this site as needed (use its menus, search box or filters if they help) and extract, verbatim and character for character, the passages that answer: ${question}. Return JSON {"passages": ["..."]}. Read only; do not log in, buy anything or submit personal data.`, 150);
    usage.agentRuns++;
    usage.runIds.push(runId);
    await emit(jobId, "browser.progress", { runId, status: "STARTED", url });
    let lastSig = "";
    while (Date.now() - t0 < b.maxSeconds * 1000) {
      await new Promise(r => setTimeout(r, 3000));
      await checkpoint();
      const run = await tf.getRun(runId);
      const sig = `${run.status}|${run.num_of_steps}|${run.streaming_url}`;
      if (sig !== lastSig) { lastSig = sig; await emit(jobId, "browser.progress", { runId, status: run.status, steps: run.num_of_steps, streamingUrl: run.streaming_url ?? null, url }); } // only on change: polling is every 3s
      if (run.status === "COMPLETED") {
        // plain passages (not JSON) so quotes can be matched against the text exactly
        const text = agentText(run.result);
        if (text.length < 40) { usage.failed.push(url); return null; }
        // own canonical url so the agent's output never overwrites the fetched snapshot of the same page
        return await saveSource(jobId, url + "#browser-agent", undefined, text, "agent", usage);
      }
      if (run.status === "FAILED" || run.status === "CANCELLED") { usage.failed.push(url); await emit(jobId, "source.failed", { url, error: run.error?.message ?? run.status }); return null; }
    }
    await tf.cancelRun(runId).catch(() => {});
  } catch (e) {
    if (e instanceof Cancelled) throw e;
    usage.failed.push(url);
    await emit(jobId, "source.failed", { url, error: String(e) });
  }
  return null;
}

/* ---------- commit ---------- */

async function upsertNode(inv: string, label: string, type: string, v: number) {
  const key = keyOf(label);
  const [hit] = await q("select id from graph_nodes where investigation_id=$1 and (canonical_key=$2 or exists (select 1 from json_each(coalesce(properties, '{}'), '$.aliases') where value=$2)) limit 1", [inv, key]); // aliases remember merged duplicates
  if (hit) return { id: hit.id as string, isNew: false };
  const t = TYPES.includes(type) ? type : "Company";
  const [n] = await q(
    "insert into graph_nodes (investigation_id, canonical_key, type, label, version) values ($1,$2,$3,$4,$5) returning id", [inv, key, t, label, v]);
  return { id: n.id as string, isNew: true };
}

async function commit(jobId: string, job: any, accepted: Accepted[]) {
  const inv = job.investigation_id;
  const out = { newEntities: 0, newRelations: 0, conflicts: 0, version: null as number | null };
  if (!accepted.length) return out;
  const touched: { claimId: string; subject: string; predicate: string; object: string | null; value: string | null }[] = [];
  await tx(async () => {
    const [{ version }] = await q("update investigations set version=version+1, updated_at=(strftime('%Y-%m-%dT%H:%M:%fZ','now')) where id=$1 returning version", [inv]);
    out.version = version;
    for (const a of accepted) {
      if (a.c.subject.length > 60) continue; // a sentence is not an entity name
      const isEntity = a.c.objectType !== "Value" && a.c.object.length <= 60;
      const s = await upsertNode(inv, a.c.subject, a.c.subjectType, version);
      const o = isEntity ? await upsertNode(inv, a.c.object, a.c.objectType, version) : null;
      for (const n of [s, o]) if (n?.isNew) { out.newEntities++; await q("insert into job_discoveries (job_id, node_id) values ($1,$2)", [jobId, n.id]); }
      const value = isEntity ? null : JSON.stringify(a.c.object);
      let [claim] = await q(
        `select id from claims where investigation_id=$1 and subject_node_id=$2 and predicate=$3
         and object_node_id is $4 and value is $5`, [inv, s.id, a.c.predicate, o?.id ?? null, value]);
      if (!claim) {
        [claim] = await q(
          `insert into claims (investigation_id, subject_node_id, predicate, object_node_id, value, valid_from, valid_to, verification_status)
           values ($1,$2,$3,$4,$5,$6,$7,'SOURCE_SUPPORTED') returning id`,
          [inv, s.id, a.c.predicate, o?.id ?? null, value, a.c.validFrom ?? null, a.c.validTo ?? null]);
        await q("insert into job_discoveries (job_id, claim_id) values ($1,$2)", [jobId, claim.id]);
      }
      await q(
        `insert into claim_evidence (claim_id, source_id, excerpt, start_offset, end_offset, support_verdict, verification_metadata)
         values ($1,$2,$3,$4,$5,'supported',$6) on conflict do nothing`,
        [claim.id, a.doc.id, a.doc.text.slice(a.start, a.end), a.start, a.end, JSON.stringify({ method: "exact_quote_plus_semantic_review", reason: a.reason, snapshotHash: sha256(a.doc.text) })]);
      const hosts = (await q("select s.publisher from claim_evidence e join sources s on s.id=e.source_id where e.claim_id=$1 and e.support_verdict='supported'", [claim.id])).map(r => r.publisher);
      const status = independentCount(hosts) >= 2 ? "CORROBORATED" : "SOURCE_SUPPORTED";
      // never downgrade a conflict flag set by an earlier run
      await q("update claims set verification_status=$2 where id=$1 and verification_status in ('SOURCE_SUPPORTED','CORROBORATED')", [claim.id, status]);
      if (o) {
        const [prior] = await q("select id from graph_edges where investigation_id=$1 and from_node_id=$2 and to_node_id=$3 and relation=$4", [inv, s.id, o.id, a.c.predicate]);
        const [e] = await q(
          `insert into graph_edges (investigation_id, from_node_id, to_node_id, relation, status, claim_id, version) values ($1,$2,$3,$4,$5,$6,$7)
           on conflict (investigation_id, from_node_id, to_node_id, relation) do update set status=excluded.status, version=excluded.version
           returning id`, [inv, s.id, o.id, a.c.predicate, status, claim.id, version]);
        if (!prior) { out.newRelations++; await q("insert into job_discoveries (job_id, edge_id) values ($1,$2)", [jobId, e.id]); }
      }
      touched.push({ claimId: claim.id, subject: s.id, predicate: a.c.predicate, object: o?.id ?? null, value });
    }

    // Conflicts: only single-valued attributes with no validity period that could explain the difference.
    // only plain values (a year, a headcount) can conflict; two different entities as objects are just two facts
    for (const t of touched.filter(t => SINGLE_VALUED.test(t.predicate) && t.value !== null)) {
      const others = await q(
        `select id from claims where investigation_id=$1 and subject_node_id=$2 and predicate=$3 and id<>$4
         and valid_from is null and valid_to is null and $5 is null and object_node_id is null and value is not $6`,
        [inv, t.subject, t.predicate, t.claimId, t.object, t.value]);
      for (const o of others) {
        const [a, b2] = [t.claimId, o.id].sort();
        const r = await q("insert into claim_conflicts (claim_a_id, claim_b_id, reason) values ($1,$2,$3) on conflict do nothing returning id", [a, b2, `Different values for ${t.predicate} with no validity period to explain it`]);
        if (!r.length) continue;
        out.conflicts++;
        await q("update claims set verification_status='CONFLICTING' where id in ($1,$2)", [a, b2]);
        await q("update graph_edges set status='CONFLICTING', version=$1 where claim_id in ($2,$3)", [version, a, b2]);
      }
    }
  });
  if (out.conflicts) await emit(jobId, "conflict.detected", { count: out.conflicts });
  await emit(jobId, "graph.updated", out);
  return out;
}

/* ---------- follow-ups ---------- */

async function subjectsOf(job: any): Promise<string[]> {
  const [inv] = await q("select root_subject from investigations where id=$1", [job.investigation_id]);
  const [n] = job.target_type === "entity" ? await q("select label from graph_nodes where id=$1", [job.target_id]) : [];
  return [inv?.root_subject, n?.label].filter(Boolean);
}

const Suggestions = z.object({ questions: z.array(z.string()).max(3) });

/** Best-effort: three concrete follow-up questions. Never fails the job. */
async function suggest(context: string, question: string, accepted: Accepted[], unresolved: string[]): Promise<string[]> {
  try {
    const found = accepted.slice(0, 10).map(a => `${a.c.subject} ${a.c.predicate} ${a.c.object}`).join("; ") || "nothing new";
    return (await ask(Suggestions,
      'Suggest up to 3 short, specific follow-up research questions (each under 90 characters) that a researcher would ask next. Output {"questions": []}.',
      `Target: ${context}
Asked: ${question}
Found: ${found}
Open questions: ${unresolved.slice(0, 5).join(" | ") || "none"}`)).questions;
  } catch { return []; }
}

/** Depth chaining: after a finished run, investigate one newly discovered entity until maxDepth. */
// shortcut: breadth 1 (first new entity only) so a chain costs at most maxDepth runs; add a sibling queue for wider crawls
async function autoExpand(jobId: string) {
  const [job] = await q("select * from expansion_jobs where id=$1", [jobId]);
  const b = job?.budget;
  if (!job || !["COMPLETED", "PARTIAL"].includes(job.status) || (b.depth ?? 1) >= b.maxDepth) return;
  const [n] = await q(
    "select n.id from job_discoveries d join graph_nodes n on n.id=d.node_id where d.job_id=$1 and n.id<>$2 and n.type in ('Company','Product') limit 1", [jobId, job.target_id]);
  if (!n) return;
  try {
    await createExpansion(job.investigation_id, {
      target: { type: "entity", id: n.id }, question: job.question,
      config: { mode: b.mode, maxDepth: b.maxDepth, depth: (b.depth ?? 1) + 1, maxSources: b.maxSources, maxAgentRuns: b.maxAgentRuns, allowedDomains: b.allowedDomains },
    }, undefined, jobId);
  } catch { /* another run started meanwhile; the chain just stops */ }
}

/** Reviewer approved a held claim: commit it exactly like a trusted one. */
export async function acceptReview(itemId: string) {
  const [r] = await q("select * from review_items where id=$1 and status='pending'", [itemId]);
  if (!r) throw Object.assign(new Error("Review item not found"), { status: 404, code: "NOT_FOUND" });
  const [s] = await q("select id, canonical_url as url, title, snapshot_text as text from sources where id=$1", [r.source_id]);
  const [job] = await q("select * from expansion_jobs where id=$1", [r.job_id]);
  const doc: Doc = { id: s.id, url: s.url, host: host(s.url), text: s.text, title: s.title };
  const c = { subject: r.subject, subjectType: r.subject_type ?? "Company", predicate: r.predicate, object: r.object, objectType: r.object_type ?? "Company", quote: r.excerpt, validFrom: r.valid_from, validTo: r.valid_to };
  const res = await commit(r.job_id, job, [{ c, doc, start: r.start_offset, end: r.end_offset, reason: "approved by reviewer" }]);
  await q("update review_items set status='accepted' where id=$1", [itemId]);
  return res;
}
