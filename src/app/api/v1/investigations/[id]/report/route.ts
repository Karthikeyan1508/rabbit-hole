import { q } from "@/lib/db";
import { err, isUuid } from "@/lib/http";
import { confidence, scoreSource } from "@/lib/quality";
import { host } from "@/lib/urlguard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const pretty = (s: string) => s.toLowerCase().replace(/_/g, " ");

/** Due-diligence dossier: every supported claim with its quote, source and confidence. ?format=md downloads Markdown; default is a print-ready page. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return err(404, "NOT_FOUND", "Investigation not found");
  const [inv] = await q("select title, root_subject, version from investigations where id=$1", [id]);
  if (!inv) return err(404, "NOT_FOUND", "Investigation not found");

  const claims = await q(
    `select c.id, c.predicate, c.verification_status as status, c.value, c.valid_from, c.valid_to, a.label as subject, b.label as object
     from claims c join graph_nodes a on a.id=c.subject_node_id left join graph_nodes b on b.id=c.object_node_id
     where c.investigation_id=$1 order by a.label, c.predicate`, [id]);
  const ev = await q(
    `select e.claim_id, e.excerpt, s.canonical_url as url, s.title, s.retrieved_at as at from claim_evidence e
     join sources s on s.id=e.source_id join claims c on c.id=e.claim_id where c.investigation_id=$1`, [id]);
  const conflicts = await q(
    `select k.reason, a.predicate, n.label as subject from claim_conflicts k join claims a on a.id=k.claim_a_id join graph_nodes n on n.id=a.subject_node_id
     where a.investigation_id=$1`, [id]);
  const jobs = await q(
    "select question, status, created_at, json_extract(usage,'$.summary') as summary from expansion_jobs where investigation_id=$1 order by created_at", [id]);

  const rows = claims.map(c => {
    const e: any[] = ev.filter(x => x.claim_id === c.id).map(x => ({ ...x, ...scoreSource(x.url, [inv.root_subject, c.subject]) }));
    return { ...c, object: c.object ?? (c.value != null ? String(c.value) : ""), e, conf: confidence(e.map(x => x.score), new Set(e.map(x => host(x.url))).size) };
  });
  const unresolved = [...new Set(jobs.flatMap(j => j.summary?.unresolved ?? []))] as string[];
  const stamp = new Date().toISOString().slice(0, 10);
  const line = (c: (typeof rows)[number]) => `${c.subject} ${pretty(c.predicate)} ${c.object}`;

  if (new URL(req.url).searchParams.get("format") === "md") {
    const md = [
      `# Investigation dossier: ${inv.title}`, `Generated ${stamp} · ${rows.length} claims · graph v${inv.version}`, "",
      "## Findings",
      ...rows.flatMap(c => [`### ${line(c)}`, `Status: ${pretty(c.status)} · Confidence: ${c.conf.label} (${Math.round(c.conf.value * 100)}%)`,
        ...c.e.map((x: any) => `> "${x.excerpt}"\n> Source: [${x.title || host(x.url)}](${x.url}) (${x.kind}), retrieved ${String(x.at).slice(0, 10)}`), ""]),
      ...(conflicts.length ? ["## Potential conflicts", ...conflicts.map(k => `- ${k.subject} ${pretty(k.predicate)}: ${k.reason}`), ""] : []),
      ...(unresolved.length ? ["## Unresolved questions", ...unresolved.map(u => `- ${u}`), ""] : []),
      "## Research log", ...jobs.map(j => `- ${String(j.created_at).slice(0, 10)} · ${j.question} · ${j.status.toLowerCase()}`),
      "", "_Automated source-supported findings, not proof of objective truth._",
    ].join("\n");
    return new Response(md, { headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename="${inv.title.replace(/[^\w-]+/g, "_")}-dossier.md"` } });
  }

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Dossier: ${esc(inv.title)}</title><link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Familjen+Grotesk:wght@400..700&display=swap" rel="stylesheet"><style>
body{font:15px/1.55 "Familjen Grotesk","Segoe UI",system-ui,sans-serif;color:#0f1b2d;max-width:820px;margin:40px auto;padding:0 24px}
h1{font-size:28px;letter-spacing:-.02em;margin:0}h2{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#8a97ab;margin:36px 0 12px;border-bottom:1px solid #e3e8ef;padding-bottom:6px}
.meta{color:#5b6b82}.c{border:1px solid #e3e8ef;border-radius:10px;padding:12px 16px;margin:0 0 10px;break-inside:avoid}.c b{font-size:15px}
.t{display:inline-block;font-size:11px;padding:1px 8px;border-radius:6px;border:1px solid #e3e8ef;background:#f8fafc;color:#5b6b82;margin-right:6px}
.g{color:#0f8a5f;background:#e6f5ef;border-color:#b7e0d0}.w{color:#b45309;background:#fdf3e3;border-color:#f0d6a8}
blockquote{margin:8px 0 2px;border-left:3px solid #2457d6;background:#eaf0fd;padding:7px 12px;border-radius:0 8px 8px 0}
.s{font-size:12px;color:#5b6b82;margin-bottom:6px}a{color:#2457d6}button{float:right;padding:8px 16px;border:1px solid #cfd7e3;border-radius:8px;background:#fff;cursor:pointer}
@media print{button{display:none}body{margin:0}}</style></head><body>
<button onclick="print()">Print / Save as PDF</button>
<h1>${esc(inv.title)}</h1><p class="meta">Investigation dossier · generated ${stamp} · ${rows.length} claims · graph v${inv.version}</p>
<h2>Findings</h2>
${rows.map(c => `<div class="c"><b>${esc(line(c))}</b><div style="margin:4px 0 6px"><span class="t ${c.status === "CONFLICTING" ? "w" : "g"}">${esc(pretty(c.status))}</span><span class="t">confidence ${c.conf.label.toLowerCase()} · ${Math.round(c.conf.value * 100)}%</span></div>
${c.e.map((x: any) => `<blockquote>“${esc(x.excerpt)}”</blockquote><div class="s"><a href="${esc(x.url)}">${esc(x.title || host(x.url))}</a> · ${esc(x.kind)} · retrieved ${esc(String(x.at).slice(0, 10))}</div>`).join("")}</div>`).join("") || "<p class=meta>No supported claims yet.</p>"}
${conflicts.length ? `<h2>Potential conflicts</h2>${conflicts.map(k => `<div class="c"><span class="t w">conflict</span> ${esc(k.subject)} ${esc(pretty(k.predicate))}: ${esc(k.reason)}</div>`).join("")}` : ""}
${unresolved.length ? `<h2>Unresolved questions</h2><ul>${unresolved.map(u => `<li>${esc(u)}</li>`).join("")}</ul>` : ""}
<h2>Research log</h2><ul>${jobs.map(j => `<li>${esc(String(j.created_at).slice(0, 10))} · ${esc(j.question)} · ${esc(j.status.toLowerCase())}</li>`).join("")}</ul>
<p class="meta" style="margin-top:36px">Automated source-supported findings, not proof of objective truth. Every quote was matched against the stored page text.</p></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
