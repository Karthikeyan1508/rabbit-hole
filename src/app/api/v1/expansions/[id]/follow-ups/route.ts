import { q } from "@/lib/db";
import { err, isUuid } from "@/lib/http";
import { startFromRequest } from "@/lib/routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return err(404, "NOT_FOUND", "Expansion not found");
  const [parent] = await q("select investigation_id from expansion_jobs where id=$1", [id]);
  if (!parent) return err(404, "NOT_FOUND", "Expansion not found");
  return startFromRequest(req, parent.investigation_id, id);
}
