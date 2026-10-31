import { z } from "zod";
import { q } from "@/lib/db";
import { err, isUuid } from "@/lib/http";
import { ask } from "@/lib/llm";
import { host } from "@/lib/urlguard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Answer = z.object({ answer: z.string(), citations: z.array(z.number()).max(10) });

/** Answers only from the verified claims in this investigation; every citation maps back to a stored quote. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = z.object({ question: z.string().trim().min(1).max(500) }).safeParse(await req.json().catch(() => null));
  if (!isUuid(id) || !(await q("select 1 from investigations where id=$1", [id])).length) return err(404, "NOT_FOUND", "Investigation not found");
  if (!body.success) return err(422, "INVALID_CONFIG", "question required");

  // shortcut: newest 80 claims go in the prompt; switch to retrieval (search over claims) for larger graphs
  const facts = await q(
    `select c.id, c.predicate, c.verification_status as status, c.value, a.label as subject, b.label as object,
       (select e.excerpt from claim_evidence e where e.claim_id=c.id limit 1) as excerpt,
       (select s.canonical_url from claim_evidence e join sources s on s.id=e.source_id where e.claim_id=c.id limit 1) as url
     from claims c join graph_nodes a on a.id=c.subject_node_id left join graph_nodes b on b.id=c.object_node_id
     where c.investigation_id=$1 order by c.rowid desc limit 80`, [id]);
  if (!facts.length) return Response.json({ answer: "The graph has no verified facts yet. Investigate an entity first.", cited: [] });

  const lines = facts.map((f, i) => `[${i}] ${f.subject} ${f.predicate.toLowerCase().replace(/_/g, " ")} ${f.object ?? f.value} (${f.status.toLowerCase().replace(/_/g, " ")}, ${host(f.url)}) — "${String(f.excerpt).slice(0, 160)}"`);
  const r = await ask(Answer,
    'Answer the question using ONLY the numbered facts. Cite the fact numbers you used. If the facts do not answer it, say so plainly and cite nothing. Never add outside knowledge. Output {"answer": "...", "citations": [0]}.',
    `<source>\n${lines.join("\n")}\n</source>\nQuestion: ${body.data.question}`);
  const cited = [...new Set(r.citations)].filter(n => facts[n]).map(n => ({
    claimId: facts[n].id, text: `${facts[n].subject} ${facts[n].predicate.toLowerCase().replace(/_/g, " ")} ${facts[n].object ?? facts[n].value}`,
    excerpt: facts[n].excerpt, url: facts[n].url,
  }));
  return Response.json({ answer: r.answer, cited });
}
