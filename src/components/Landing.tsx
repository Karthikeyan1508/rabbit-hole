"use client";
import { useEffect, useState } from "react";
import { api } from "./api";
import { BackgroundBeams } from "./ui/background-beams";
import { HoverEffect } from "./ui/card-hover-effect";
import { FlipWords } from "./ui/flip-words";
import { Logo } from "./ui/logo";
import { PlaceholdersAndVanishInput } from "./ui/placeholders-and-vanish-input";
import { Spotlight } from "./ui/spotlight";

const ago = (iso?: string) => {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso ?? "")) / 60000));
  return !iso || Number.isNaN(m) ? "" : m < 1 ? "just now" : m < 60 ? m + "m ago" : m < 1440 ? Math.round(m / 60) + "h ago" : Math.round(m / 1440) + "d ago";
};

export default function Landing({ onOpen }: { onOpen: (id: string) => void }) {
  const [subject, setSubject] = useState("");
  const [err, setErr] = useState("");
  const [recent, setRecent] = useState<any[]>([]);
  const [bulk, setBulk] = useState(false);
  const [list, setList] = useState("");
  const [msg, setMsg] = useState("");
  useEffect(() => {
    const load = () => api("/investigations").then(setRecent).catch(() => {});
    load();
    const t = setInterval(load, 6000); // picks up bulk investigations as they appear and finish
    return () => clearInterval(t);
  }, []);
  async function runBulk() {
    const subjects = list.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
    try { const r = await api("/bulk", { method: "POST", body: JSON.stringify({ subjects }) }); setMsg(`Started ${r.started.length} investigations. They run one at a time; open any below as it finishes.`); setList(""); setBulk(false); setErr(""); }
    catch (x: any) { setErr(x.message); }
  }
  async function go(s: string) {
    try { onOpen((await api("/investigations", { method: "POST", body: JSON.stringify({ subject: s }) })).id); } catch (x: any) { setErr(x.message); }
  }
  return (
    <div className="landing relative overflow-hidden">
      <BackgroundBeams className="opacity-70" />
      <Spotlight className="-top-40 left-0 md:-top-20 md:left-60" fill="#2457d6" />
      <div className="box relative z-10">
        <div className="logo"><Logo size={32} /> RabbitHole</div>
        <h1>Click anything.<br />Follow the <FlipWords words={["evidence", "claims", "sources", "connections"]} className="!px-0 text-[var(--acc)]" /></h1>
        <p className="sub">Turn any company, claim or relationship into a verified, source-backed knowledge graph.</p>
        <PlaceholdersAndVanishInput
          placeholders={["Investigate a company…", "Map a competitor landscape…", "Verify a claim about a startup…", "Who partners with whom?"]}
          onChange={e => setSubject(e.target.value)}
          onSubmit={e => { e.preventDefault(); if (subject.trim()) go(subject.trim()); }} />
        {err && <p className="l-bad small" style={{ marginTop: 12 }}>{err}</p>}
        <div className="chips">{["Stripe", "Anthropic", "TinyFish", "Notion"].map(s => <button key={s} className="chip" onClick={() => go(s)}>{s}</button>)}</div>
        <div className="bulk">
          {!bulk && <button className="chip" onClick={() => setBulk(true)}>Investigate many at once</button>}
          {bulk && (
            <div className="stack" style={{ textAlign: "left" }}>
              <textarea rows={5} placeholder={"One company per line (max 20)\nStripe\nNotion\nLinear"} value={list} onChange={e => setList(e.target.value)} />
              <div className="btn-row"><button className="primary" disabled={!list.trim()} onClick={runBulk}>Start all</button><button onClick={() => setBulk(false)}>Cancel</button></div>
            </div>
          )}
          {msg && <p className="muted small" style={{ marginTop: 12 }}>{msg}</p>}
        </div>
        <HoverEffect className="!py-10 -mx-2 md:!grid-cols-3 text-left" items={[
          { icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>, title: "Investigate", description: "Pick any node and ask a question.", link: "#1" },
          { icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 4 6v6c0 5 3.4 8 8 9 4.6-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/></svg>, title: "Verify", description: "Every quote is matched to its source text.", link: "#2" },
          { icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="8" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="m8 7 8 1M7 8l4 8M17 10l-4 6"/></svg>, title: "Expand", description: "Only supported facts reach the graph.", link: "#3" },
        ]} />
        {recent.length > 0 && <div className="recent"><h3 className="h">Recent investigations</h3>
          <div className="recent-list">
            {recent.slice(0, 5).map(r => (
              <a key={r.id} className="recent-row" href={"?i=" + r.id}>
                <span className="recent-ico">{String(r.title)[0]?.toUpperCase()}</span>
                <span className="recent-name">{r.title}</span>
                <span className="recent-meta">{r.version ? r.version + (r.version === 1 ? " update" : " updates") : "new"} · {ago(r.created_at)}</span>
                <svg className="recent-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
              </a>
            ))}
          </div>
        </div>}
      </div>
    </div>
  );
}

