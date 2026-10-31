import { z } from "zod";
import { createExpansion } from "./worker";
import { err, isUuid } from "./http";
import { isSafeUrl } from "./urlguard";

const Body = z.object({
  target: z.object({ type: z.enum(["entity", "claim", "edge"]), id: z.string().refine(isUuid) }),
  question: z.string().trim().min(1).max(1000),
  config: z.object({
    mode: z.enum(["quick", "deep"]), maxDepth: z.number().int().min(0), maxSources: z.number().int().min(1),
    maxAgentRuns: z.number().int().min(0), allowedDomains: z.array(z.string()).optional(),
    agent: z.boolean(), agentUrl: z.string().url().refine(u => isSafeUrl(u), "must be a public http(s) URL"),
  }).partial().optional(),
});

/** Shared by the start and follow-up routes. */
export async function startFromRequest(req: Request, invId: string, parentId?: string) {
  if (!isUuid(invId)) return err(404, "NOT_FOUND", "Investigation not found");
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return err(422, "INVALID_CONFIG", "Invalid investigation configuration", false, body.error.issues);
  try {
    const { job, existing } = await createExpansion(invId, body.data, req.headers.get("idempotency-key") ?? undefined, parentId);
    return Response.json({
      expansionId: job.id, investigationId: invId, status: job.status,
      eventsUrl: `/api/v1/expansions/${job.id}/events`, statusUrl: `/api/v1/expansions/${job.id}`,
    }, { status: existing ? 200 : 202 });
  } catch (e: any) {
    if (e.status) return err(e.status, e.code, e.message);
    return err(503, "WORKER_UNAVAILABLE", String(e.message ?? e), true);
  }
}
