import { createHash } from "node:crypto";

export const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
export const sha256 = (s: string) => "sha256:" + createHash("sha256").update(s).digest("hex");
export const keyOf = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Find a quote in a normalized snapshot: exact first, then case-insensitive. Returns offsets or null (citation rejected). */
export function locate(snapshot: string, quote: string): [number, number] | null {
  const n = normalize(quote);
  if (n.length < 8) return null;
  let i = snapshot.indexOf(n);
  if (i < 0) i = snapshot.toLowerCase().indexOf(n.toLowerCase());
  return i < 0 ? null : [i, i + n.length];
}

/** Same hostname repeating a claim is one voice; real independence is approximated by distinct hostnames. */
// shortcut: hostname, not publisher/ownership — syndicated press releases on different hosts still count as independent
export const independentCount = (hosts: string[]) => new Set(hosts).size;
