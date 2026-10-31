import { q } from "@/lib/db";
import { err, isUuid } from "@/lib/http";
import { startFromRequest } from "@/lib/routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type P = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: P) {
  return startFromRequest(req, (await params).id);
}

export async function GET(_: Request, { params }: P) {
  const { id } = await params;
  if (!isUuid(id)) return err(404, "NOT_FOUND", "Investigation not found");
  return Response.json(await q(
    "select id, parent_id, idempotency_key, target_type, target_id, question, status, stage, created_at, json_extract(usage,'$.summary') as summary from expansion_jobs where investigation_id=$1 order by created_at desc limit 30", [id]));
}
