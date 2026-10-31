import { q } from "@/lib/db";
import { err, isUuid } from "@/lib/http";
import { confidence, scoreSource } from "@/lib/quality";
import { host } from "@/lib/urlguard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return err(404, "NOT_FOUND", "Claim not found");
  const [c] = await q(
    `select c.verification_status, i.root_subject, n.label as subject from claims c
     join investigations i on i.id=c.investigation_id join graph_nodes n on n.id=c.subject_node_id where c.id=$1`, [id]);
  if (!c) return err(404, "NOT_FOUND", "Claim not found");
  const rows = await q(
    `select s.id as "sourceId", s.canonical_url as url, s.title, e.excerpt, e.support_verdict as "supportVerdict", s.retrieved_at as "retrievedAt", s.retrieval_status as "via"
     from claim_evidence e join sources s on s.id=e.source_id where e.claim_id=$1`, [id]);
  const sources = rows.map(r => ({ ...r, ...scoreSource(r.url, [c.root_subject, c.subject]) }));
  const conflicts = await q("select id, reason, resolution_status, claim_a_id, claim_b_id from claim_conflicts where claim_a_id=$1 or claim_b_id=$1", [id]);
  return Response.json({
    claimId: id, status: c.verification_status, sources, conflicts,
    confidence: confidence(sources.map(s => s.score), new Set(sources.map(s => host(s.url))).size),
  });
}
