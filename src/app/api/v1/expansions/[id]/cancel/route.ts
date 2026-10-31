import { q } from "@/lib/db";
import { err, isUuid } from "@/lib/http";
import { emit, running, TERMINAL } from "@/lib/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return err(404, "NOT_FOUND", "Expansion not found");
  const [j] = await q("select status from expansion_jobs where id=$1", [id]);
  if (!j) return err(404, "NOT_FOUND", "Expansion not found");
  if (TERMINAL.includes(j.status)) return Response.json({ expansionId: id, status: j.status });
  await q("update expansion_jobs set cancel_requested=true where id=$1", [id]);
  if (!running.has(id)) { // orphaned job: no worker will ever confirm, so terminate it here
    await q("update expansion_jobs set status='CANCELLED', finished_at=(strftime('%Y-%m-%dT%H:%M:%fZ','now')) where id=$1", [id]);
    await emit(id, "expansion.cancelled");
  }
  return Response.json({ expansionId: id, status: "CANCELLING" });
}
