import { z } from "zod";
import { q } from "@/lib/db";
import { err, isUuid } from "@/lib/http";
import { acceptReview } from "@/lib/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  const { id, itemId } = await params;
  const b = z.object({ decision: z.enum(["accept", "reject"]) }).safeParse(await req.json().catch(() => null));
  if (!isUuid(id) || !isUuid(itemId)) return err(404, "NOT_FOUND", "Review item not found");
  if (!b.success) return err(422, "INVALID_CONFIG", "decision must be accept or reject");
  const [item] = await q("select id from review_items where id=$1 and investigation_id=$2 and status='pending'", [itemId, id]);
  if (!item) return err(404, "NOT_FOUND", "Review item not found");
  if (b.data.decision === "reject") {
    await q("update review_items set status='rejected' where id=$1", [itemId]);
    return Response.json({ status: "rejected" });
  }
  try { return Response.json({ status: "accepted", ...(await acceptReview(itemId)) }); }
  catch (e: any) { return err(e.status ?? 503, e.code ?? "WORKER_UNAVAILABLE", e.message); }
}
