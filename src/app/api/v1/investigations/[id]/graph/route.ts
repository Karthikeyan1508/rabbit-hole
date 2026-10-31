import { q } from "@/lib/db";
import { err, isUuid } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return err(404, "NOT_FOUND", "Investigation not found");
  const since = Number(new URL(req.url).searchParams.get("sinceVersion") ?? -1);
  const [inv] = await q("select version, root_subject from investigations where id=$1", [id]);
  if (!inv) return err(404, "NOT_FOUND", "Investigation not found");
  const nodes = await q(
    `select n.id, n.type, n.label, n.version, (select group_concat(distinct c.verification_status) from claims c where c.subject_node_id=n.id or c.object_node_id=n.id) as "verificationStatus"
     from graph_nodes n where n.investigation_id=$1 and n.version>$2`, [id, since]);
  const edges = await q(
    `select id, from_node_id as source, to_node_id as target, relation, status, claim_id as "claimId", version
     from graph_edges where investigation_id=$1 and version>$2`, [id, since]);
  return Response.json({ version: inv.version, rootSubject: inv.root_subject, nodes, edges });
}
