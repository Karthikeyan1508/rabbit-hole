import { z } from "zod";
import { err } from "@/lib/http";
import { startBulk } from "@/lib/bulk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ subjects: z.array(z.string().trim().min(1).max(200)).min(1).max(20) });

export async function POST(req: Request) {
  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) return err(422, "INVALID_CONFIG", "Send 1 to 20 company names");
  const unique = [...new Map(b.data.subjects.map(s => [s.toLowerCase(), s])).values()];
  return Response.json({ started: await startBulk(unique) }, { status: 202 });
}
