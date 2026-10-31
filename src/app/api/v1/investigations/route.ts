import { z } from "zod";
import { q } from "@/lib/db";
import { err } from "@/lib/http";
import { createInvestigation } from "@/lib/bulk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await q("select id, title, root_subject, version, created_at from investigations order by created_at desc limit 20"));
}

export async function POST(req: Request) {
  try {
    const raw = await req.json().catch(() => null);
    const b = z.object({ subject: z.string().trim().min(1).max(200), type: z.string().default("Company") }).safeParse(raw);
    if (!b.success) return err(422, "INVALID_CONFIG", "subject required");
    const res = await createInvestigation(b.data.subject, b.data.type);
    return Response.json(res, { status: 201 });
  } catch (e: any) {
    console.error("POST /investigations failed:", e);
    return err(500, "INTERNAL_ERROR", e.message || String(e));
  }
}
