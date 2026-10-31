import { q } from "@/lib/db";
import { err, isUuid } from "@/lib/http";
import { TERMINAL } from "@/lib/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Replays persisted events after Last-Event-ID, then tails the table until the job is terminal. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return err(404, "NOT_FOUND", "Expansion not found");
  const [job] = await q("select status from expansion_jobs where id=$1", [id]);
  if (!job) return err(404, "NOT_FOUND", "Expansion not found");

  let last = Number(req.headers.get("last-event-id") ?? new URL(req.url).searchParams.get("last") ?? 0) || 0;
  const enc = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream({
    async start(ctl) {
      req.signal.addEventListener("abort", () => { closed = true; });
      while (!closed) {
        const [{ status }] = await q("select status from expansion_jobs where id=$1", [id]);
        const rows = await q("select sequence_number as s, event_type as t, payload from expansion_events where job_id=$1 and sequence_number>$2 order by sequence_number", [id, last]);
        for (const r of rows) {
          last = r.s;
          ctl.enqueue(enc.encode(`id: ${r.s}\nevent: ${r.t}\ndata: ${JSON.stringify({ sequence: r.s, ...r.payload })}\n\n`));
        }
        if (!rows.length && TERMINAL.includes(status)) break; // terminal and fully drained
        if (!rows.length) ctl.enqueue(enc.encode(": keepalive\n\n"));
        await new Promise(r => setTimeout(r, 1000));
      }
      try { ctl.close(); } catch {}
    },
    cancel() { closed = true; },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}
