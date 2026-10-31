import { z } from "zod";
import { q, tx } from "@/lib/db";
import { err, isUuid } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Fold a duplicate entity into another: claims and edges move over, and the old name is remembered as an alias so re-extraction can't recreate it. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = z.object({ keepId: z.string().refine(isUuid), mergeId: z.string().refine(isUuid) }).safeParse(await req.json().catch(() => null));
  if (!isUuid(id) || !b.success || b.data.keepId === b.data.mergeId) return err(422, "INVALID_CONFIG", "keepId and mergeId must be two different nodes");
  const { keepId, mergeId } = b.data;
  const [k] = await q("select properties from graph_nodes where id=$1 and investigation_id=$2", [keepId, id]);
  const [m] = await q("select canonical_key, properties from graph_nodes where id=$1 and investigation_id=$2", [mergeId, id]);
  if (!k || !m) return err(404, "NOT_FOUND", "Node not found in investigation");

  const version = await tx(async () => {
    const [{ version }] = await q("update investigations set version=version+1 where id=$1 returning version", [id]);
    await q("update claims set subject_node_id=$1 where subject_node_id=$2", [keepId, mergeId]);
    await q("update claims set object_node_id=$1 where object_node_id=$2", [keepId, mergeId]);
    // "or ignore" leaves rows that would duplicate an existing edge; those are dropped below
    await q("update or ignore graph_edges set from_node_id=$1, version=$3 where from_node_id=$2", [keepId, mergeId, version]);
    await q("update or ignore graph_edges set to_node_id=$1, version=$3 where to_node_id=$2", [keepId, mergeId, version]);
    await q("delete from graph_edges where from_node_id=$1 or to_node_id=$1", [mergeId]);
    await q("delete from graph_edges where from_node_id=to_node_id and investigation_id=$1", [id]);
    const aliases = [...new Set([...(k.properties?.aliases ?? []), m.canonical_key, ...(m.properties?.aliases ?? [])])];
    await q("update graph_nodes set properties=$2, version=$3 where id=$1", [keepId, JSON.stringify({ ...k.properties, aliases }), version]);
    await q("delete from graph_nodes where id=$1", [mergeId]);
    return version;
  });
  return Response.json({ version });
}
