const PRIVATE_V4 = /^(0\.|10\.|127\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/;

// shortcut: no DNS resolution, so a public name resolving to a private IP is not caught here;
// fetching runs on TinyFish infrastructure, so this is defence in depth
export function isSafeUrl(raw: string, allowed?: string[]): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return false;
  if (PRIVATE_V4.test(h) || h === "::1" || h === "::" || /^(fc|fd|fe80)/.test(h)) return false;
  if (allowed?.length && !allowed.some(d => h === d || h.endsWith("." + d))) return false;
  return true;
}

export function canon(raw: string): string {
  const u = new URL(raw);
  u.hash = "";
  for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid)/.test(k)) u.searchParams.delete(k);
  return u.toString().replace(/\/$/, "");
}

export const host = (raw: string) => new URL(raw).hostname.replace(/^www\./, "");
