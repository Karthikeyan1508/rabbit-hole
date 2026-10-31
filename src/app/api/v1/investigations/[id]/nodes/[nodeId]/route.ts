import { q, tx } from "@/lib/db";
import { err, isUuid } from "@/lib/http";
import { keyOf } from "@/lib/verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Remove a junk entity with its claims, evidence links and edges. The root subject cannot be removed. */
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string; nodeId: string }> }) {
  const { id, nodeId } = await params;
  if (!isUuid(id) || !isUuid(nodeId)) return err(404, "NOT_FOUND", "Node not found");
  const [n] = await q("select n.canonical_key as k, i.root_subject as root from graph_nodes n join investigations i on i.id=n.investigation_id where n.id=$1 and n.investigation_id=$2", [nodeId, id]);
  if (!n) return err(404, "NOT_FOUND", "Node not found");
  if (n.k === keyOf(n.root)) return err(409, "ROOT_NODE", "The root entity cannot be removed");
  const mine = "select id from claims where subject_node_id=$1 or object_node_id=$1";
  await tx(async () => {
    await q(`delete from claim_conflicts where claim_a_id in (${mine}) or claim_b_id in (${mine})`, [nodeId]);
    await q(`delete from graph_edges where from_node_id=$1 or to_node_id=$1 or claim_id in (${mine})`, [nodeId]);
    await q("delete from claims where subject_node_id=$1 or object_node_id=$1", [nodeId]);
    await q("delete from graph_nodes where id=$1", [nodeId]);
    await q("update investigations set version=version+1 where id=$1", [id]);
  });
  return Response.json({ removed: nodeId });
}
