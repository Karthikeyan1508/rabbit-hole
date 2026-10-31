import { z } from "zod";
import { q } from "@/lib/db";
import { err, isUuid } from "@/lib/http";
import { isSafeUrl } from "@/lib/urlguard";
import { check } from "@/lib/watch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type P = { params: Promise<{ id: string }> };
const read = async (id: string) =>
  (await q("select watch_hours as hours, watch_webhook as webhook, last_watch_at as lastWatchAt from investigations where id=$1", [id]))[0];

export async function GET(_: Request, { params }: P) {
  const { id } = await params;
  const w = isUuid(id) && (await read(id));
  return w ? Response.json(w) : err(404, "NOT_FOUND", "Investigation not found");
}

const Body = z.object({ hours: z.number().int().min(0).max(720), webhook: z.string().trim().max(500).optional() });

export async function PUT(req: Request, { params }: P) {
  const { id } = await params;
  if (!isUuid(id) || !(await read(id))) return err(404, "NOT_FOUND", "Investigation not found");
  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) return err(422, "INVALID_CONFIG", "hours must be 0-720");
  const hook = b.data.webhook || null;
  if (hook && (!hook.startsWith("https://") || !isSafeUrl(hook))) return err(422, "INVALID_WEBHOOK", "Webhook must be a public https URL");
  await q("update investigations set watch_hours=$2, watch_webhook=$3 where id=$1", [id, b.data.hours, hook]);
  return Response.json(await read(id));
}

/** Check now: runs immediate manual research and posts updates. */
export async function POST(_: Request, { params }: P) {
  const { id } = await params;
  if (!isUuid(id) || !(await read(id))) return err(404, "NOT_FOUND", "Investigation not found");
  try { return Response.json({ expansionId: (await check(id, true)).id }, { status: 202 }); }
  catch (e: any) { return err(e.status ?? 503, e.code ?? "WORKER_UNAVAILABLE", e.message); }
}
