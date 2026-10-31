import { q } from "./db";
import { isSafeUrl } from "./urlguard";

/** After a scheduled check finishes, post a Slack-compatible message if it found something. Never throws. */
export async function notifyWatch(jobId: string) {
  try {
    const [j] = await q(
      `select j.idempotency_key as k, j.status, j.usage, i.title, i.watch_webhook as hook
       from expansion_jobs j join investigations i on i.id=j.investigation_id where j.id=$1`, [jobId]);
    const s = j?.usage?.summary;
    if (!j?.k?.startsWith("watch:") || !j.hook || !isSafeUrl(j.hook) || !["COMPLETED", "PARTIAL"].includes(j.status) || !(s?.newRelations || s?.conflicts)) return;
    await fetch(j.hook, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `RabbitHole · ${j.title}: ${s.newRelations} new relation(s), ${s.conflicts} conflict(s) since the last check.` }),
    });
  } catch { /* alerts are best-effort */ }
}
