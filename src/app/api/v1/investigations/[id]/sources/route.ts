import { q } from "@/lib/db";
import { err, isUuid } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };

/** Every source any run of this investigation touched, rebuilt from the persisted event log (so it survives new runs and reloads). */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return err(404, "NOT_FOUND", "Investigation not found");
  const events = await q(
    `select e.event_type as t, e.payload from expansion_events e join expansion_jobs j on j.id=e.job_id
     where j.investigation_id=$1 and e.event_type in ('source.discovered','source.fetched','source.failed','claim.verified') order by e.id`, [id]);
  const m = new Map<string, any>();
  const get = (url: string) => { if (!m.has(url)) m.set(url, { url, host: hostOf(url), state: "found", ok: 0, bad: 0 }); return m.get(url); };
  for (const { t, payload: d } of events) { // the db layer only JSON-parses columns literally named payload
    if (t === "source.discovered") { const s = get(d.url); s.title ||= d.title; s.kind = d.kind; }
    else if (t === "source.fetched") { const s = get(d.url); if (s.state !== "read") Object.assign(s, { state: "read", title: d.title || s.title, via: d.via }); }
    else if (t === "source.failed" && d.url) { const s = get(d.url); if (s.state === "found") Object.assign(s, { state: "failed", error: d.error }); } // a later successful read wins
    else if (t === "claim.verified" && d.sourceUrl) get(d.sourceUrl)[d.accepted ? "ok" : "bad"]++;
  }
  return Response.json([...m.values()]);
}
