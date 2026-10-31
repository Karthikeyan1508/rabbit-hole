import { q, tx } from "@/lib/db";
import { err, isUuid } from "@/lib/http";
import { fetchPages } from "@/lib/tinyfish";
import { canon, isSafeUrl } from "@/lib/urlguard";
import { locate, normalize, sha256 } from "@/lib/verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Re-fetch every web source behind a claim and check the saved quote is still on the page. Uploaded documents are skipped. */
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return err(404, "NOT_FOUND", "Claim not found");
  const [c] = await q("select investigation_id as inv, verification_status as status from claims where id=$1", [id]);
  if (!c) return err(404, "NOT_FOUND", "Claim not found");
  const ev = await q(
    "select e.id, e.excerpt, s.id as sid, s.canonical_url as url from claim_evidence e join sources s on s.id=e.source_id where e.claim_id=$1 and s.canonical_url not like 'doc:%'", [id]);
  const urls = [...new Set(ev.map(e => e.url as string))].filter(u => isSafeUrl(u));
  if (!urls.length) return err(422, "NOTHING_TO_CHECK", "This claim has no web sources to re-check");

  let pages: Awaited<ReturnType<typeof fetchPages>>;
  try { pages = await fetchPages(urls); } catch (e: any) { return err(502, "SOURCE_ACCESS_DENIED", String(e.message ?? e), true); }
  const text = new Map(pages.results.map(p => [canon(p.url), normalize(p.text).slice(0, 60_000)]));

  const results: { url: string; status: "unchanged" | "gone" | "unreachable" }[] = [];
  await tx(async () => {
    for (const e of ev) {
      const t = text.get(e.url);
      if (t === undefined) { results.push({ url: e.url, status: "unreachable" }); continue; }
      const at = locate(t, e.excerpt);
      if (!at) { results.push({ url: e.url, status: "gone" }); continue; }
      results.push({ url: e.url, status: "unchanged" });
      await q("update sources set snapshot_text=$2, content_hash=$3, retrieved_at=(strftime('%Y-%m-%dT%H:%M:%fZ','now')) where id=$1", [e.sid, t, sha256(t)]);
      await q("update claim_evidence set start_offset=$2, end_offset=$3 where id=$1", [e.id, at[0], at[1]]);
    }
    // unreachable pages prove nothing either way; only a page that loads without the quote counts against the claim
    const checked = results.filter(r => r.status !== "unreachable");
    const next = checked.length && checked.every(r => r.status === "gone") ? "OUTDATED" : checked.some(r => r.status === "unchanged") && c.status === "OUTDATED" ? "SOURCE_SUPPORTED" : c.status;
    if (next !== c.status) {
      const [{ version }] = await q("update investigations set version=version+1 where id=$1 returning version", [c.inv]);
      await q("update claims set verification_status=$2 where id=$1", [id, next]);
      await q("update graph_edges set status=$2, version=$3 where claim_id=$1", [id, next, version]);
      c.status = next;
    }
  });
  return Response.json({ claimId: id, status: c.status, results });
}
