/** The agent's result comes back as an object, a JSON string, or JSON wrapped in {result: "..."}; unwrap to plain passages so quotes can match. */
export function agentText(r: unknown): string {
  const unwrap = (x: any): any => { if (typeof x === "string") { try { return unwrap(JSON.parse(x)); } catch { return x; } } return x; };
  const first: any = unwrap(r);
  const v = unwrap(first && typeof first === "object" && "result" in first ? first.result : first);
  const ps = v && typeof v === "object" && "passages" in v ? v.passages : v;
  if (Array.isArray(ps)) return ps.map(p => (typeof p === "string" ? p : JSON.stringify(p))).join("\n\n");
  return typeof ps === "string" ? ps : ps ? JSON.stringify(ps) : "";
}
