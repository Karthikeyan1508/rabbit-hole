import { q } from "./db";
import { isSafeUrl } from "./urlguard";

/**
 * Sends a rich, structured Slack message with research statistics,
 * newly discovered relationships, quotes, and primary source links.
 * Never throws.
 */
export async function notifyWatch(jobId: string) {
  try {
    const [j] = await q(
      `select j.id, j.idempotency_key as k, j.status, j.usage, j.question,
              i.id as inv_id, i.title, i.root_subject, i.watch_webhook as hook
       from expansion_jobs j 
       join investigations i on i.id=j.investigation_id 
       where j.id=$1`,
      [jobId]
    );

    if (!j?.hook || !isSafeUrl(j.hook) || !["COMPLETED", "PARTIAL"].includes(j.status)) {
      return;
    }

    const usage = j.usage ?? {};
    const s = usage.summary ?? {};

    // Only notify if changes, relations, or discoveries happened (or if triggered by watch/monitoring)
    if (!j.k?.startsWith("watch:") && !s?.newRelations && !s?.conflicts && !s?.newEntities) {
      return;
    }

    // Query discovered claims and their sources for this job
    const discoveries = await q(
      `select c.predicate, c.verification_status, c.value,
              s_node.label as subject_label,
              coalesce(o_node.label, c.value) as object_label,
              e.excerpt, s.canonical_url as source_url, s.title as source_title, s.publisher
       from job_discoveries jd
       join claims c on c.id = jd.claim_id
       join graph_nodes s_node on s_node.id = c.subject_node_id
       left join graph_nodes o_node on o_node.id = c.object_node_id
       left join claim_evidence e on e.claim_id = c.id
       left join sources s on s.id = e.source_id
       where jd.job_id = $1
       group by c.id
       limit 8`,
      [jobId]
    );

    const rootName = j.title || j.root_subject || "Investigation Target";

    // Format relationship bullet lines
    const relLines = discoveries.length
      ? discoveries.map((d: any) => {
          const relation = d.predicate.toLowerCase().replace(/_/g, " ");
          const srcLink = d.source_url ? `<${d.source_url}|${d.publisher || "Source"}>` : "Local Knowledge";
          const quoteStr = d.excerpt ? `\n> _"${d.excerpt.slice(0, 150)}..."_` : "";
          return `• *${d.subject_label}* ${relation} *${d.object_label}* — ${srcLink}${quoteStr}`;
        })
      : ["• _Incremental scan completed; no new relations exceeded confidence thresholds._"];

    // Format conflict warnings if any
    const conflicts = await q(
      `select cc.reason, ca.predicate as pred
       from claim_conflicts cc
       join claims ca on ca.id = cc.claim_a_id
       where ca.investigation_id = $1
       order by cc.rowid desc limit 3`,
      [j.inv_id]
    );

    const conflictBlocks = conflicts.length
      ? [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `⚠️ *Detected Conflicts (${conflicts.length}):*\n` +
                conflicts.map((c: any) => `• *${c.pred}*: ${c.reason}`).join("\n"),
            },
          },
        ]
      : [];

    // Assemble Slack Block Kit payload
    const payload = {
      text: `🔍 RabbitHole Update: ${rootName}`,
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: `🔍 RabbitHole Intelligence Report: ${rootName}`,
            emoji: true,
          },
        },
        {
          type: "section",
          fields: [
            {
              type: "mrkdwn",
              text: `*Status:*\n\`${j.status}\``,
            },
            {
              type: "mrkdwn",
              text: `*New Entities:*\n\`${s.newEntities ?? 0}\``,
            },
            {
              type: "mrkdwn",
              text: `*New Relationships:*\n\`${s.newRelations ?? 0}\``,
            },
            {
              type: "mrkdwn",
              text: `*Sources Consulted:*\n\`${s.sourcesConsulted ?? usage.sourcesFetched ?? 0}\``,
            },
          ],
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Research Objective:*\n"${j.question || 'Continuous automated monitoring'}"`,
          },
        },
        {
          type: "divider",
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Verified Discoveries & Sources:*\n${relLines.join("\n\n")}`,
          },
        },
        ...conflictBlocks,
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `📊 Research Stats: ${usage.searches ?? 0} searches · ${usage.claimsExtracted ?? 0} extracted · ${usage.claimsAccepted ?? discoveries.length} accepted | RabbitHole Engine`,
            },
          ],
        },
      ],
    };

    await fetch(j.hook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    /* alerts are best-effort */
  }
}
