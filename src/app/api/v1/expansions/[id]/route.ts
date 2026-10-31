import { q } from "@/lib/db";
import { err, isUuid } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return err(404, "NOT_FOUND", "Expansion not found");
  const [j] = await q("select id, status, stage, budget, usage, error, started_at, finished_at from expansion_jobs where id=$1", [id]);
  if (!j) return err(404, "NOT_FOUND", "Expansion not found");
  const u = j.usage ?? {};
  return Response.json({
    id: j.id, status: j.status, stage: j.stage, error: j.error, startedAt: j.started_at, finishedAt: j.finished_at,
    progress: { searchesCompleted: u.searches ?? 0, sourcesFetched: u.sourcesFetched ?? 0, claimsExtracted: u.claimsExtracted ?? 0, claimsAccepted: u.claimsAccepted ?? 0 },
    usage: { agentRuns: u.agentRuns ?? 0, sourceLimit: j.budget.maxSources },
    summary: u.summary ?? null,
  });
}
