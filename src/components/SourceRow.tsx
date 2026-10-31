export type Src = { url: string; host: string; title?: string; kind?: string; state: "found" | "read" | "failed"; error?: string; via?: string; ok: number; bad: number };

/** One-line source entry: letter, title, domain, then only the tags that carry information. */
export function SourceRow({ s, running, finished }: { s: Src; running: boolean; finished: boolean }) {
  const doc = s.url.startsWith("doc:");
  const host = doc ? "uploaded document" : s.host;
  const body = (
    <>
      <span className="src-ico">{(s.title || host)[0]?.toUpperCase()}</span>
      <span className="src-title">{s.title || host}</span>
      <span className="src-host">{host}</span>
      <span className="src-tags">
        {s.state === "failed" && <span className="tag sm warn">{String(s.error ?? "unavailable").replace(/_/g, " ")}</span>}
        {s.state === "found" && <span className="tag sm">{running ? "queued" : "not read"}</span>}
        {s.via === "agent" && <span className="tag sm run">agent</span>}
        {s.kind && s.kind !== "web" && s.state === "read" && !s.ok && !s.bad && <span className="tag sm">{s.kind.replace("-", " ")}</span>}
        {s.ok > 0 && <span className="tag sm good">{s.ok} ✓</span>}
        {s.bad > 0 && <span className="tag sm bad">{s.bad} ✕</span>}
        {s.state === "read" && !s.ok && !s.bad && finished && <span className="tag sm">no claims</span>}
      </span>
    </>
  );
  const cls = `src-row${s.state === "failed" ? " failed" : ""}`;
  const tip = `${s.title ?? host}\n${s.url}${s.kind ? `\n${s.kind.replace("-", " ")} source` : ""}`;
  return doc ? <div className={cls} title={tip}>{body}</div> : <a className={cls} href={s.url} target="_blank" rel="noreferrer" title={tip}>{body}</a>;
}
