import { q } from "@/lib/db";
import { err, isUuid } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** What each run added, newest first, plus facts that carry their own dates. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return err(404, "NOT_FOUND", "Investigation not found");
  const runs = await q(
    "select id, question, status, created_at as at, idempotency_key as key from expansion_jobs where investigation_id=$1 order by created_at desc limit 30", [id]);
  const added = await q(
    `select d.job_id as jobId, e.id as edgeId, a.label as fromLabel, e.relation, b.label as toLabel
     from job_discoveries d join graph_edges e on e.id=d.edge_id join graph_nodes a on a.id=e.from_node_id join graph_nodes b on b.id=e.to_node_id
     where e.investigation_id=$1`, [id]);
  const dated = await q(
    `select c.id, c.valid_from as "from", c.valid_to as "to", a.label as subject, c.predicate, coalesce(b.label, c.value) as object
     from claims c join graph_nodes a on a.id=c.subject_node_id left join graph_nodes b on b.id=c.object_node_id
     where c.investigation_id=$1 and c.valid_from is not null order by c.valid_from`, [id]);
  return Response.json({ runs: runs.map(r => ({ ...r, added: added.filter(x => x.jobId === r.id) })), dated });
}
