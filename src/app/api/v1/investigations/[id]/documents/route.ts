import { z } from "zod";
import { q } from "@/lib/db";
import { err, isUuid } from "@/lib/http";
import { pdfText } from "@/lib/pdftext";
import { normalize, sha256 } from "@/lib/verify";
import { createExpansion } from "@/lib/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PDF = 10 * 1024 * 1024;
const Body = z.object({ title: z.string().trim().min(1).max(200), text: z.string().min(50).max(200_000), targetId: z.string().refine(isUuid).optional() });

/** Own document as evidence: stored like a fetched page, then run through the same extract + verify pipeline.
 *  Accepts JSON {title, text} or multipart {title, file} where the file is a PDF (selectable text only, no OCR). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return err(404, "NOT_FOUND", "Investigation not found");
  const [inv] = await q("select root_subject from investigations where id=$1", [id]);
  if (!inv) return err(404, "NOT_FOUND", "Investigation not found");

  let raw: unknown;
  if ((req.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!form || !(file instanceof File)) return err(422, "INVALID_CONFIG", "Attach a PDF as 'file'");
    if (file.size > MAX_PDF) return err(422, "FILE_TOO_LARGE", "PDF must be under 10 MB");
    let text: string;
    try { text = await pdfText(new Uint8Array(await file.arrayBuffer())); } catch { return err(422, "NOT_A_PDF", "That file could not be read as a PDF"); }
    if (normalize(text).length < 50) return err(422, "NO_TEXT", "This PDF has no selectable text (scanned PDFs need OCR, which is not supported)");
    raw = { title: String(form.get("title") ?? file.name), text, targetId: form.get("targetId") || undefined };
  } else raw = await req.json().catch(() => null);

  const b = Body.safeParse(raw);
  if (!b.success) return err(422, "INVALID_CONFIG", "title and at least 50 characters of text are required");
  const target = b.data.targetId ?? (await q("select id from graph_nodes where investigation_id=$1 order by rowid limit 1", [id]))[0]?.id;
  if (!target) return err(422, "INVALID_CONFIG", "Investigation has no entity to attach to");

  const text = normalize(b.data.text).slice(0, 60_000);
  const hash = sha256(text);
  const [s] = await q(
    `insert into sources (canonical_url, title, publisher, content_hash, snapshot_text, retrieval_status) values ($1,$2,'upload',$3,$4,'upload')
     on conflict (canonical_url) do update set title=excluded.title returning id`, [`doc:${hash.slice(7, 23)}`, b.data.title, hash, text]);
  try {
    const { job } = await createExpansion(id, {
      target: { type: "entity", id: target }, config: { mode: "quick", docIds: [s.id] },
      question: `What does "${b.data.title}" state about ${inv.root_subject}? Extract every relationship and fact.`,
    });
    return Response.json({ expansionId: job.id, sourceId: s.id }, { status: 202 });
  } catch (e: any) { return err(e.status ?? 503, e.code ?? "WORKER_UNAVAILABLE", e.message); }
}
