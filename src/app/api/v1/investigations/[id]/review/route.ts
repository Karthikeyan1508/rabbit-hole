import { q } from "@/lib/db";
import { err, isUuid } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return err(404, "NOT_FOUND", "Investigation not found");
  return Response.json(await q(
    `select r.id, r.subject, r.predicate, r.object, r.excerpt, r.source_kind as kind, s.canonical_url as url, s.title
     from review_items r join sources s on s.id=r.source_id where r.investigation_id=$1 and r.status='pending' order by r.created_at`, [id]));
}
