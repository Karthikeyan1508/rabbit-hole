"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "./api";
import { DocumentUpload } from "./DocumentUpload";
import Landing from "./Landing";
import { MonitoringPanel } from "./MonitoringPanel";
import { Section } from "./Section";
import { SourceRow } from "./SourceRow";
import { AnimatedTabs } from "./ui/animated-tabs";
import { Button } from "./ui/button";
import { Logo } from "./ui/logo";
import { Select } from "./ui/select";
import { Counter } from "./ui/counter";
import { Button as MovingButton } from "./ui/moving-border";
import { TextGenerateEffect } from "./ui/text-generate-effect";

const ForceGraph = dynamic(() => import("react-force-graph-2d"), { ssr: false });

type GNode = { id: string; type: string; label: string; verificationStatus?: string | null; fresh?: boolean; [k: string]: any };
type GLink = { id: string; source: any; target: any; relation: string; status: string; claimId: string | null };
type Job = { id: string; parent_id?: string | null; idempotency_key?: string | null; status: string; question: string; summary?: any; target_type: "entity" | "claim" | "edge"; target_id: string };
type Ev = { seq: number; type: string; data: any };
type Sel = { kind: "node" | "edge"; id: string } | null;
type Tab = "inspect" | "sources" | "review" | "timeline" | "result";
type Changes = { runs: { id: string; question: string; status: string; at: string; key?: string | null; added: { edgeId: string; fromLabel: string; relation: string; toLabel: string }[] }[]; dated: { id: string; from: string; to?: string | null; subject: string; predicate: string; object: string }[] };
type Review = { id: string; subject: string; predicate: string; object: string; excerpt: string; kind: string; url: string; title?: string };

const COLORS: Record<string, string> = { Company: "#2457d6", Product: "#14213d", Person: "#d97706", Event: "#6b7488", Claim: "#9aa1b1", Source: "#9aa1b1" };
const EVENTS = ["expansion.started", "plan.created", "search.completed", "source.discovered", "source.fetched", "source.failed", "browser.progress", "claim.extracted", "claim.verified", "conflict.detected", "graph.updated", "expansion.completed", "expansion.partial", "expansion.failed", "expansion.cancelled"];
const OBJECTIVES = ["Find competitors", "Explore products", "Discover partnerships", "Research funding", "Verify claims", "Custom question"];
const STAGES = ["Plan", "Search", "Read", "Extract", "Verify", "Commit"];
const STAGE_OF: Record<string, number> = { "plan.created": 0, "search.completed": 1, "source.discovered": 1, "source.fetched": 2, "source.failed": 2, "browser.progress": 2, "claim.extracted": 3, "claim.verified": 4, "graph.updated": 5 };
const DONE = /^expansion\.(completed|partial|failed|cancelled)$/;
const TERMINAL = ["COMPLETED", "PARTIAL", "FAILED", "CANCELLED"];
let fontCache = ""; // canvas text needs the real family name next/font generated, so read it from the page once
const canvasFont = () => fontCache ||= (typeof document !== "undefined" ? getComputedStyle(document.body).fontFamily : "") || "sans-serif";
const id = (x: any) => (typeof x === "object" ? x.id : x);
const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
const dotFor = (s: string) => (s === "COMPLETED" ? "good" : s === "FAILED" || s === "CANCELLED" ? "bad" : s === "PARTIAL" ? "warn" : "run");

function line(e: Ev): [string, string, string] {
  const d = e.data;
  switch (e.type) {
    case "expansion.started": return ["▶", "l-info", `started: ${d.question}`];
    case "plan.created": return ["◆", "l-info", d.queries.length ? `plan → ${d.queries.join("  ·  ")}` : "plan → read the uploaded document"];
    case "search.completed": return ["⌕", d.error ? "l-bad" : "l-dim", d.error ? `search failed: ${d.query}` : `searched "${d.query}" — ${d.results} results`];
    case "source.discovered": return ["◌", "l-dim", `found ${hostOf(d.url)}`];
    case "source.fetched": return ["●", "l-ok", `read ${d.url.startsWith("doc:") ? `“${d.title}” (uploaded)` : hostOf(d.url)} (${d.chars} chars)`];
    case "source.failed": return ["✕", "l-warn", `unavailable ${d.url ? hostOf(d.url) : ""} ${d.error ?? ""}`];
    case "browser.progress": return ["◈", "l-info", `browser agent ${d.status}${d.steps ? ` · ${d.steps} steps` : ""}`];
    case "claim.extracted": return ["·", "l-dim", d.error ? `extract failed: ${String(d.error).slice(0, 120)}` : `candidate: ${d.subject} ${d.predicate} ${d.object}`];
    case "claim.verified": return [d.accepted ? "✓" : "✕", d.accepted ? "l-ok" : "l-bad", `${d.accepted ? "accepted" : "rejected"}: ${d.subject ?? ""} ${d.predicate ?? ""} ${d.object ?? ""} — ${d.reason ?? d.error ?? ""}`];
    case "conflict.detected": return ["⚑", "l-warn", `${d.count} potential conflict(s) flagged`];
    case "graph.updated": return ["✦", "l-ok", `graph v${d.version}: +${d.newEntities} entities, +${d.newRelations} relations`];
    case "expansion.completed": return ["■", "l-ok", "completed"];
    case "expansion.partial": return ["■", "l-warn", "stopped at budget — partial results"];
    case "expansion.failed": return ["■", "l-bad", `failed: ${d.message ?? ""}`];
    default: return ["■", "l-warn", e.type.replace("expansion.", "")];
  }
}

/* ---------- workspace ---------- */
export default function Workspace() {
  const [invId, setInvId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [err, setErr] = useState("");
  const [graph, setGraph] = useState<{ nodes: GNode[]; links: GLink[] }>({ nodes: [], links: [] });
  const ver = useRef(-1);
  const [sel, setSel] = useState<Sel>(null);
  const [evidence, setEvidence] = useState<any>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [log, setLog] = useState<Ev[]>([]);
  const [tab, setTab] = useState<Tab>("inspect");
  const [drawer, setDrawer] = useState<{ type: "entity" | "claim" | "edge"; id: string } | null>(null);
  const [objective, setObjective] = useState(OBJECTIVES[0]);
  const [custom, setCustom] = useState("");
  const [mode, setMode] = useState<"quick" | "deep">("quick");
  const [auto, setAuto] = useState(false);
  const [useAgent, setUseAgent] = useState(false);
  const [agentUrl, setAgentUrl] = useState("");
  const [qn, setQn] = useState("");
  const [allSrc, setAllSrc] = useState<any[]>([]);
  const [review, setReview] = useState<Review[]>([]);
  const [mergeTo, setMergeTo] = useState("");
  const [changes, setChanges] = useState<Changes>({ runs: [], dated: [] });
  const [filter, setFilter] = useState("");
  const [checking, setChecking] = useState(false);
  const [recheck, setRecheck] = useState<{ status: string; results: { url: string; status: string }[] } | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [onlyConflicts, setOnlyConflicts] = useState(false);
  const [open_, setOpen_] = useState(true);
  const [ans, setAns] = useState<{ answer: string; cited: { claimId: string; text: string; excerpt: string; url: string }[] } | "loading" | null>(null);
  const es = useRef<EventSource | null>(null);
  const graphRef = useRef<any>(null);
  const box = useRef<HTMLElement>(null);
  const logEnd = useRef<HTMLDivElement>(null);
  const fitted = useRef(false);
  const [size, setSize] = useState({ w: 600, h: 400 });

  useEffect(() => { // canvas follows its panel, not the window
    if (!box.current) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.floor(e.contentRect.width), h: Math.floor(e.contentRect.height) }));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, [invId]);

  useEffect(() => { // looser layout; the graph is dynamically imported, so wait until its ref exists
    const t = setInterval(() => {
      const g = graphRef.current;
      if (!g?.d3Force) return;
      clearInterval(t);
      g.d3Force("link")?.distance(130);
      g.d3Force("charge")?.strength(-380);
      fitted.current = false;
      g.d3ReheatSimulation?.();
    }, 200);
    return () => clearInterval(t);
  }, [invId]);

  useEffect(() => { logEnd.current?.scrollIntoView({ block: "end" }); }, [log.length, open_]);

  const refresh = useCallback(async (inv: string, highlight = false) => {
    const full = ver.current < 0;
    const g = await api(`/investigations/${inv}/graph?sinceVersion=${ver.current}`);
    ver.current = g.version;
    setTitle(g.rootSubject);
    setGraph(prev => {
      const nodes = [...prev.nodes]; // keep node object identity: the graph lib links edges to these exact objects
      nodes.forEach(n => { n.fresh = false; });
      const links = [...prev.links];
      for (const n of g.nodes) {
        const i = nodes.findIndex(x => x.id === n.id);
        if (i >= 0) Object.assign(nodes[i], n, { fresh: highlight }); else nodes.push({ ...n, fresh: highlight });
      }
      for (const e of g.edges) {
        const i = links.findIndex(x => x.id === e.id);
        if (i >= 0) Object.assign(links[i], { status: e.status }); else links.push(e);
      }
      return { nodes, links };
    });
    if (full || highlight) setTimeout(() => graphRef.current?.zoomToFit(500, 120), 1500); // re-frame after a reload or new findings: the old pan/zoom may point at empty space
    if (highlight) setTimeout(() => setGraph(p => { p.nodes.forEach(n => { n.fresh = false; }); return { ...p }; }), 9000);
    setJobs(await api(`/investigations/${inv}/expansions`));
    api(`/investigations/${inv}/review`).then(setReview).catch(() => {});
    api(`/investigations/${inv}/sources`).then(setAllSrc).catch(() => {});
    api(`/investigations/${inv}/changes`).then(setChanges).catch(() => {});
  }, []);

  useEffect(() => {
    const i = new URLSearchParams(location.search).get("i");
    if (i) open(i);
  }, []);

  async function open(inv: string) {
    setInvId(inv); ver.current = -1; fitted.current = false; setGraph({ nodes: [], links: [] }); setSel(null); setLog([]); setActive(null);
    history.replaceState(null, "", `?i=${inv}`);
    await refresh(inv);
    const js: Job[] = await api(`/investigations/${inv}/expansions`);
    const latest = js.find(j => !TERMINAL.includes(j.status)) ?? js[0]; // replay the latest run so its sources and log are visible
    if (latest) attach(inv, latest.id, !TERMINAL.includes(latest.status)); // open the Sources tab for a run that is still going
  }

  function home() { es.current?.close(); setInvId(null); history.replaceState(null, "", "/"); }

  function attach(inv: string, jobId: string, showTab = true) {
    es.current?.close();
    setActive(jobId); setLog([]);
    if (showTab) setTab("sources");
    const s = new EventSource(`/api/v1/expansions/${jobId}/events`); // browser resends Last-Event-ID on reconnect
    es.current = s;
    for (const t of EVENTS) s.addEventListener(t, (m: MessageEvent) => {
      const data = JSON.parse(m.data);
      setLog(l => (l.some(x => x.seq === data.sequence) ? l : [...l, { seq: data.sequence, type: t, data }]));
      if (t === "graph.updated") refresh(inv, true);
      if (DONE.test(t)) {
        s.close(); refresh(inv);
        setTimeout(async () => { // auto-expand: follow the child run the server just started
          const js: Job[] = await api(`/investigations/${inv}/expansions`).catch(() => []);
          const child = js.find(j => j.parent_id === jobId && !TERMINAL.includes(j.status));
          if (child) attach(inv, child.id, false);
        }, 2500);
      }
    });
  }

  async function start() {
    if (!invId || !drawer) return;
    const question = objective === "Custom question" ? custom : objective;
    try {
      const r = await api(`/investigations/${invId}/expansions`, {
        method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ target: drawer, question, config: { mode, maxDepth: auto ? 3 : 1, ...(useAgent ? { agent: true, ...(agentUrl.trim() ? { agentUrl: agentUrl.trim() } : {}) } : {}) } }),
      });
      setDrawer(null); setErr(""); setOpen_(true); attach(invId, r.expansionId);
    } catch (x: any) { setErr(x.message); }
  }

  async function askGraph(e: React.FormEvent) {
    e.preventDefault();
    if (!qn.trim()) return;
    setAns("loading");
    try { setAns(await api(`/investigations/${invId}/ask`, { method: "POST", body: JSON.stringify({ question: qn }) })); } catch (x: any) { setAns(null); setErr(x.message); }
  }

  async function reverify(claimId: string) {
    setChecking(true); setRecheck(null);
    try { const r = await api(`/claims/${claimId}/reverify`, { method: "POST" }); setRecheck(r); await refresh(invId!); setEvidence(await api(`/claims/${claimId}/evidence`)); }
    catch (e: any) { setErr(e.message); }
    setChecking(false);
  }
  const [decidingId, setDecidingId] = useState<string | null>(null);

  async function decide(item: Review, decision: "accept" | "reject") {
    if (decidingId === item.id) return;
    setDecidingId(item.id);
    // Optimistically remove from review list to prevent duplicate clicks
    setReview(prev => prev.filter(r => r.id !== item.id));
    try {
      await api(`/investigations/${invId}/review/${item.id}`, { method: "POST", body: JSON.stringify({ decision }) });
      await refresh(invId!, decision === "accept");
    } catch (e: any) {
      if (e.message !== "Review item not found") {
        setErr(e.message);
        // Restore review items if error was something else
        api(`/investigations/${invId}/review`).then(setReview).catch(() => {});
      }
    } finally {
      setDecidingId(null);
    }
  }
  async function mergeNode(keepId: string, mergeId: string) {
    try { await api(`/investigations/${invId}/nodes/merge`, { method: "POST", body: JSON.stringify({ keepId, mergeId }) }); setMergeTo(""); await open(invId!); } catch (e: any) { setErr(e.message); }
  }
  async function removeNode(nodeId: string) {
    if (!confirm("Remove this entity and every claim attached to it?")) return;
    try { await api(`/investigations/${invId}/nodes/${nodeId}`, { method: "DELETE" }); await open(invId!); } catch (e: any) { setErr(e.message); }
  }

  const cancel = () => active && api(`/expansions/${active}/cancel`, { method: "POST" }).catch(x => setErr(x.message));

  useEffect(() => {
    setEvidence(null); setRecheck(null);
    if (sel?.kind === "edge") {
      const cid = graph.links.find(l => l.id === sel.id)?.claimId;
      if (cid) api(`/claims/${cid}/evidence`).then(setEvidence).catch(() => {});
    }
  }, [sel?.kind, sel?.id]);

  const select = (s: Sel) => { setSel(s); setDrawer(null); if (s) setTab("inspect"); };

  /* derived from the persisted event log, so it survives reloads and reconnects */
  const liveSources = useMemo(() => {
    const m = new Map<string, any>();
    const get = (u: string) => { if (!m.has(u)) m.set(u, { url: u, host: hostOf(u), state: "found", ok: 0, bad: 0 }); return m.get(u); };
    for (const e of log) {
      const d = e.data;
      if (e.type === "source.discovered") { const s = get(d.url); s.title ||= d.title; s.kind = d.kind; }
      else if (e.type === "source.fetched") { const s = get(d.url); Object.assign(s, { state: "read", title: d.title || s.title, chars: d.chars, via: d.via }); }
      else if (e.type === "source.failed" && d.url) Object.assign(get(d.url), { state: "failed", error: d.error });
      else if (e.type === "claim.verified" && d.sourceUrl) get(d.sourceUrl)[d.accepted ? "ok" : "bad"]++;
    }
    return [...m.values()];
  }, [log]);

  // sources from every run of this investigation, with the running job's live updates on top
  const sources = useMemo(() => {
    const m = new Map<string, any>(allSrc.map(s => [s.url, s]));
    for (const s of liveSources) { const old = m.get(s.url); m.set(s.url, old ? { ...old, ...s, ok: Math.max(old.ok, s.ok), bad: Math.max(old.bad, s.bad) } : s); }
    const rank = (s: any) => (s.ok ? 0 : s.state === "read" ? 1 : s.state === "found" ? 2 : 3);
    return [...m.values()].sort((a, b) => rank(a) - rank(b));
  }, [allSrc, liveSources]);

  const counts = useMemo(() => {
    const c = { searches: 0, read: 0, failed: 0, candidates: 0, ok: 0, bad: 0 };
    for (const e of log) {
      if (e.type === "search.completed" && !e.data.error) c.searches++;
      else if (e.type === "source.fetched") c.read++;
      else if (e.type === "source.failed") c.failed++;
      else if (e.type === "claim.extracted" && !e.data.error) c.candidates++;
      else if (e.type === "claim.verified") e.data.accepted ? c.ok++ : c.bad++;
    }
    return c;
  }, [log]);

  const finished = log.some(e => DONE.test(e.type));
  const browser = useMemo(() => [...log].reverse().find(e => e.type === "browser.progress")?.data as { status: string; steps?: number; streamingUrl?: string | null; url?: string } | undefined, [log]);
  const stage = log.reduce((m, e) => Math.max(m, STAGE_OF[e.type] ?? -1), -1);

  // legend filters: hide entity types, or keep only conflicting relations and their endpoints
  const view = useMemo(() => {
    const keepLink = (l: GLink) => !onlyConflicts || l.status === "CONFLICTING";
    const touched = new Set(graph.links.filter(keepLink).flatMap(l => [id(l.source), id(l.target)]));
    const nodes = graph.nodes.filter(n => !hidden.has(n.type) && (!onlyConflicts || touched.has(n.id)));
    const ids = new Set(nodes.map(n => n.id));
    return { nodes, links: graph.links.filter(l => keepLink(l) && ids.has(id(l.source)) && ids.has(id(l.target))) };
  }, [graph, hidden, onlyConflicts]);

  if (!invId) return <Landing onOpen={open} />;

  const node = sel?.kind === "node" ? graph.nodes.find(n => n.id === sel.id) : null;
  const edge = sel?.kind === "edge" ? graph.links.find(l => l.id === sel.id) : null;
  const label = (x: any) => graph.nodes.find(n => n.id === id(x))?.label ?? "?";
  const activeJob = jobs.find(j => j.id === active);
  const running = !!active && !finished && !(activeJob && TERMINAL.includes(activeJob.status));
  const summary = activeJob?.summary ?? [...log].reverse().find(e => /completed|partial/.test(e.type))?.data;
  const shown = filter ? graph.nodes.filter(n => n.label.toLowerCase().includes(filter.toLowerCase())) : [];
  const types = [...new Set(graph.nodes.map(n => n.type))];

  return (
    <div className="app">
      <header className="top">
        <div className="logo" style={{ cursor: "pointer" }} onClick={home}><Logo /> RabbitHole</div>
        <span className="muted">/</span>
        <span className="title">{title}</span>
        <div className="stats">
          <span className="stat"><b>{graph.nodes.length}</b> entities</span>
          <span className="stat"><b>{graph.links.length}</b> verified relations</span>
        </div>
        <div className="spacer" />
        {running && <span className="tag run"><span className="dot run" />investigating…</span>}
        <button onClick={() => window.open(`/api/v1/investigations/${invId}/report`, "_blank")}>Export report</button>
        <a className="small" href={`/api/v1/investigations/${invId}/report?format=md`}>.md</a>
        <button className="ghost" onClick={home}>New investigation</button>
      </header>

      <div className="main">
        <aside className="side">
          <input placeholder="Search entities…" value={filter} onChange={e => setFilter(e.target.value)} />
          {filter && <div style={{ marginTop: 12 }}>{shown.map(n => <div key={n.id} className="row-item" onClick={() => { select({ kind: "node", id: n.id }); graphRef.current?.centerAt(n.x, n.y, 500); graphRef.current?.zoom(3, 500); }}>{n.label} <span className="tag">{n.type}</span></div>)}{!shown.length && <p className="muted small">No match.</p>}</div>}
          <Section title="Investigations">
            {jobs.length === 0 && <p className="muted small">None yet. Select a node and click <b>Investigate Deeper</b>.</p>}
            {jobs.map(j => (
              <div key={j.id} className={`row-item ${j.id === active ? "on" : ""}`} onClick={() => attach(invId, j.id)}>
                <span className={`dot ${dotFor(j.status)}`} />
                <div style={{ minWidth: 0 }}>
                  <div className="row-title">{j.question}</div>
                  <div className="muted small">{j.status.toLowerCase()}{j.summary ? ` · +${j.summary.newRelations ?? 0} relations` : ""}{j.idempotency_key?.startsWith("watch:") ? " · scheduled" : ""}</div>
                </div>
              </div>
            ))}
          </Section>
          <Section title="Monitoring"><MonitoringPanel invId={invId} busy={running} onError={setErr} onStarted={x => { setOpen_(true); attach(invId, x); }} /></Section>
          <Section title="Documents"><DocumentUpload invId={invId} busy={running} onError={setErr} onStarted={x => { setErr(""); setOpen_(true); attach(invId, x); }} /></Section>
        </aside>

        <section className="graph" ref={box}>
          <ForceGraph ref={graphRef} graphData={view} backgroundColor="#fbfcfe" width={size.w} height={size.h}
            cooldownTicks={120} onEngineStop={() => { if (!fitted.current && graph.nodes.length > 1) { fitted.current = true; graphRef.current?.zoomToFit(500, 120); } }}
            nodeLabel={(n: any) => `${n.label} (${n.type})`} linkLabel={(l: any) => l.relation}
            linkColor={(l: any) => (l.status === "CONFLICTING" ? "#d97706" : l.status === "CORROBORATED" ? "#2457d6" : "#aab0be")}
            linkDirectionalArrowLength={5} linkDirectionalArrowRelPos={0.92} linkCurvature={0.08}
            linkWidth={(l: any) => (sel?.kind === "edge" && sel.id === l.id ? 3 : 1.2)}
            linkCanvasObjectMode={() => "after"}
            linkCanvasObject={(l: any, ctx: CanvasRenderingContext2D, k: number) => {
              if (k < 1.3 || typeof l.source !== "object" || typeof l.target !== "object" || !Number.isFinite(l.source.x)) return;
              ctx.font = `${9 / k}px sans-serif`; ctx.fillStyle = "#6b7488"; ctx.textAlign = "center";
              ctx.fillText(String(l.relation).toLowerCase().replace(/_/g, " "), (l.source.x + l.target.x) / 2, (l.source.y + l.target.y) / 2 - 3 / k);
            }}
            nodeCanvasObject={(n: any, ctx: CanvasRenderingContext2D, k: number) => {
              if (!Number.isFinite(n.x)) return; // layout not computed yet
              const c = COLORS[n.type] ?? "#2457d6", r = n.fresh ? 7 : 6, on = sel?.kind === "node" && sel.id === n.id;
              if (on || n.fresh) { ctx.beginPath(); ctx.arc(n.x, n.y, r + 4, 0, 2 * Math.PI); ctx.strokeStyle = n.fresh ? "#d97706" : c; ctx.lineWidth = 1.5 / k; ctx.stroke(); }
              ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, 2 * Math.PI); ctx.fillStyle = c; ctx.fill();
              ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5 / k; ctx.stroke();
              const fs = 11 / k; ctx.font = `${on ? 600 : 500} ${fs}px ${canvasFont()}`;
              const w = ctx.measureText(n.label).width, y = n.y + r + 6 / k;
              ctx.fillStyle = "#ffffffe6"; ctx.fillRect(n.x - w / 2 - 4 / k, y - 1 / k, w + 8 / k, fs + 4 / k);
              ctx.fillStyle = "#14213d"; ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillText(n.label, n.x, y + 1 / k);
            }}
            nodePointerAreaPaint={(n: any, col: string, ctx: CanvasRenderingContext2D) => { if (!Number.isFinite(n.x)) return; ctx.fillStyle = col; ctx.beginPath(); ctx.arc(n.x, n.y, 9, 0, 2 * Math.PI); ctx.fill(); }}
            onNodeClick={(n: any) => select({ kind: "node", id: n.id })}
            onNodeRightClick={(n: any) => { graphRef.current?.centerAt(n.x, n.y, 500); graphRef.current?.zoom(3, 500); }}
            onLinkClick={(l: any) => select({ kind: "edge", id: l.id })}
            onBackgroundClick={() => setSel(null)} />
          <div className="gtools"><button onClick={() => graphRef.current?.zoomToFit(500, 120)}>Fit</button></div>
          {graph.nodes.length <= 1 && <div className="empty"><div>Click the node, then <b>Investigate Deeper</b> to grow the graph.</div></div>}
          <div className="legend">
            {types.map(t => <button key={t} className={`legend-item ${hidden.has(t) ? "off" : ""}`} style={{ ["--c" as any]: COLORS[t] ?? "#2457d6" }} title={hidden.has(t) ? "Show " + t : "Hide " + t}
              onClick={() => setHidden(h => { const n = new Set(h); n.has(t) ? n.delete(t) : n.add(t); return n; })}>{t}</button>)}
            <button className={`legend-item ${onlyConflicts ? "on" : ""}`} style={{ ["--c" as any]: "#d97706" }} title="Show only conflicting relations" onClick={() => setOnlyConflicts(o => !o)}>Conflicts only</button>
          </div>
        </section>

        <aside className="right">
          <div className="tabbar">
            <AnimatedTabs id="rt" value={tab} onChange={setTab} tabs={[
              { key: "inspect", label: "Inspector" },
              { key: "sources", label: "Sources", badge: sources.length },
              { key: "review", label: "Review", badge: review.length, hot: true },
              { key: "timeline", label: "Timeline" },
              { key: "result", label: "Result", disabled: !summary },
            ]} />
          </div>
          <div className="pane">
            {tab === "inspect" && <>
              {!sel && <div className="card"><h3 className="h">Overview</h3>
                <p className="muted">Select an entity to investigate it, or a relationship to see the evidence behind it.</p>
                <div className="kpis"><div className="kpi"><Counter value={graph.nodes.length} /><span>entities</span></div><div className="kpi"><Counter value={graph.links.length} /><span>relations</span></div><div className="kpi"><Counter value={jobs.length} /><span>runs</span></div></div></div>}
              {!sel && <div className="card"><h3 className="h">Ask the graph</h3>
                <form onSubmit={askGraph} style={{ display: "flex", gap: 6 }}>
                  <input value={qn} onChange={e => setQn(e.target.value)} placeholder="e.g. Who competes with us?" style={{ flex: 1, minWidth: 0 }} />
                  <button className="primary" disabled={ans === "loading" || !qn.trim()}>Ask</button>
                </form>
                <p className="muted small" style={{ marginTop: 6 }}>Answers use only verified facts in this graph.</p>
                {ans === "loading" && <p className="muted small">Reading the graph…</p>}
                {ans && ans !== "loading" && <div style={{ marginTop: 10 }}>
                  <TextGenerateEffect key={ans.answer} words={ans.answer} className="!font-normal !text-[15px] !leading-relaxed !tracking-normal !text-[var(--ink)]" />
                  {ans.cited.map(c => (
                    <div key={c.claimId} style={{ marginTop: 8 }}>
                      <div className="small"><b>{c.text}</b></div>
                      <div className="quote" style={{ margin: "4px 0" }}>“{c.excerpt}”</div>
                      <a className="small" href={c.url} target="_blank" rel="noreferrer">{hostOf(c.url)} ↗</a>
                    </div>
                  ))}
                </div>}
              </div>}
              {node && <>
                <h2 style={{ fontSize: 22, letterSpacing: "-.02em" }}>{node.label}</h2>
                <div className="row" style={{ marginTop: 6, flex: "none" }}><span className="tag" style={{ flex: "none", borderColor: COLORS[node.type], color: COLORS[node.type] }}>{node.type}</span>
                  {node.verificationStatus && <span className={`tag ${node.verificationStatus.split(",")[0]}`} style={{ flex: "none" }}>{node.verificationStatus.split(",")[0].replace(/_/g, " ").toLowerCase()}</span>}</div>
                <MovingButton borderRadius="0.9rem" duration={3500} containerClassName="h-10 w-full my-5" className="font-semibold text-[var(--acc)]" disabled={running} onClick={() => setDrawer({ type: "entity", id: node.id })}>Investigate Deeper</MovingButton>
                <div className="card" style={{ margin: "0 0 18px" }}>
                  <h3 className="h">Duplicate or junk?</h3>
                  <div style={{ display: "flex", gap: 10 }}>
                    <Select value={mergeTo} onChange={setMergeTo} placeholder="Merge into…" className="grow" options={graph.nodes.filter(n => n.id !== node.id).map(n => ({ value: n.id, label: n.label }))} />
                    <button disabled={!mergeTo} onClick={() => mergeNode(mergeTo, node.id)}>Merge</button>
                  </div>
                  <button className="danger" style={{ width: "100%", marginTop: 10 }} onClick={() => removeNode(node.id)}>Remove entity</button>
                </div>
                <h3 className="h">Relationships</h3>
                {graph.links.filter(l => id(l.source) === node.id || id(l.target) === node.id).map(l => (
                  <div key={l.id} className="item" onClick={() => select({ kind: "edge", id: l.id })}>
                    {label(l.source)} <b style={{ color: "var(--acc)" }}>{l.relation.toLowerCase().replace(/_/g, " ")}</b> {label(l.target)} <span className={`tag ${l.status}`}>{l.status.replace(/_/g, " ").toLowerCase()}</span>
                  </div>
                ))}
                {!graph.links.some(l => id(l.source) === node.id || id(l.target) === node.id) && <p className="muted small">No verified relationships yet.</p>}
              </>}
              {edge && <>
                <h3 className="h">Relationship</h3>
                <h2 style={{ fontSize: 18, lineHeight: 1.3 }}>{label(edge.source)} <span style={{ color: "var(--acc)" }}>{edge.relation.toLowerCase().replace(/_/g, " ")}</span> {label(edge.target)}</h2>
                <div style={{ margin: "8px 0 14px" }}><span className={`tag ${edge.status}`}>{edge.status.replace(/_/g, " ").toLowerCase()}</span>
                  {evidence?.confidence && <span className={`tag ${evidence.confidence.label === "High" ? "good" : evidence.confidence.label === "Low" ? "warn" : ""}`} style={{ marginLeft: 6 }}>confidence {evidence.confidence.label.toLowerCase()} · {Math.round(evidence.confidence.value * 100)}%</span>}</div>
                <h3 className="h">Evidence</h3>
                {!evidence && <p className="muted small">Loading…</p>}
                {evidence?.sources.map((s: any) => (
                  <div key={s.sourceId} className="card">
                    <div className="quote">“{s.excerpt}”</div>
                    <a href={s.url} target="_blank" rel="noreferrer">{s.title || hostOf(s.url)} ↗</a>
                    <div className="muted small">{hostOf(s.url)} · {String(s.kind).replace("-", " ")} · retrieved {new Date(s.retrievedAt).toLocaleString()} · <span className="l-ok">{s.supportVerdict}</span></div>
                  </div>
                ))}
                {evidence?.conflicts?.length > 0 && <div className="card l-warn">⚑ {evidence.conflicts[0].reason}</div>}
                <div className="row">
                  <button className="primary" disabled={running} onClick={() => setDrawer({ type: "edge", id: edge.id })}>Investigate connection</button>
                  {edge.claimId && <button disabled={running} onClick={() => { setObjective("Verify claims"); setDrawer({ type: "claim", id: edge.claimId! }); }}>Verify claim</button>}
                </div>
                {edge.claimId && <Button full className="mt-3" disabled={checking} onClick={() => reverify(edge.claimId!)}>{checking ? "Re-fetching sources…" : "Re-check sources are still live"}</Button>}
                {recheck && <div className="card" style={{ marginTop: 14 }}>
                  <h3 className="h">Re-check result</h3>
                  {recheck.results.map(r => <div key={r.url} className="small" style={{ margin: "6px 0" }}><span className={`tag sm ${r.status === "unchanged" ? "good" : "warn"}`}>{r.status === "unchanged" ? "quote still there" : r.status === "gone" ? "quote gone" : "unreachable"}</span> {hostOf(r.url)}</div>)}
                  {recheck.status === "OUTDATED" && <p className="l-warn small" style={{ marginTop: 8 }}>The quote is no longer on any live source, so this claim is marked outdated.</p>}
                </div>}
              </>}
              {err && <p className="l-bad small" style={{ marginTop: 10 }}>{err}</p>}
              {drawer && (
                <div className="drawer">
                  <h3 className="h">Investigate {drawer.type === "entity" ? "entity" : drawer.type}</h3>
                  <Select value={objective} onChange={setObjective} options={OBJECTIVES.map(o => ({ value: o, label: o }))} className="mb" />
                  {objective === "Custom question" && <textarea rows={3} value={custom} onChange={e => setCustom(e.target.value)} placeholder="What do you want to know?" />}
                  <div className="seg">
                    <button className={mode === "quick" ? "on" : ""} onClick={() => setMode("quick")}>Quick · 3 searches</button>
                    <button className={mode === "deep" ? "on" : ""} onClick={() => setMode("deep")}>Deep · 5 searches</button>
                  </div>
                  <label className="small" style={{ display: "flex", gap: 8, alignItems: "center", margin: "4px 0 8px" }}><input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} style={{ width: "auto" }} />Auto-expand: also investigate a newly found entity (up to 3 levels)</label>
                  <label className="small" style={{ display: "flex", gap: 8, alignItems: "center", margin: "4px 0 8px" }}><input type="checkbox" checked={useAgent} onChange={e => setUseAgent(e.target.checked)} style={{ width: "auto" }} />Also operate a website with a live TinyFish browser agent</label>
                  {useAgent && <input placeholder="Start page (optional, e.g. https://example.com/directory)" value={agentUrl} onChange={e => setAgentUrl(e.target.value)} style={{ marginBottom: 10 }} />}
                  <p className="muted small">Up to 12 sources and 2 browser runs per level. Public pages only, read-only.</p>
                  <div className="row"><button className="primary" disabled={objective === "Custom question" && !custom.trim()} onClick={start}>Start</button><button onClick={() => setDrawer(null)}>Cancel</button></div>
                </div>
              )}
            </>}

            {tab === "sources" && <>
              {!active && !sources.length && <p className="muted">Run an investigation to see the sources it consulted.</p>}
              {(active || sources.length > 0) && <>
                {browser?.streamingUrl && !finished && !["COMPLETED", "FAILED", "CANCELLED"].includes(browser.status) && (
                  <div className="card live">
                    <div className="live-h"><span><span className="dot run" />Live browser agent{browser.steps ? ` · step ${browser.steps}` : ""}</span><a className="small" href={browser.streamingUrl} target="_blank" rel="noreferrer">Open ↗</a></div>
                    <iframe src={browser.streamingUrl} title="TinyFish live browser" className="live-frame" allow="clipboard-read; clipboard-write" />
                    <p className="muted small" style={{ marginTop: 8 }}>{hostOf(browser.url ?? "")} · the agent finds passages, then every quote still has to match the page text.</p>
                  </div>
                )}
                <div className="kpis">
                  <div className="kpi"><Counter value={sources.filter(s => s.state === "read").length} /><span>sources read</span></div>
                  <div className="kpi"><Counter className="l-ok" value={sources.reduce((n, s) => n + s.ok, 0)} /><span>claims verified</span></div>
                  <div className="kpi"><Counter className="l-bad" value={sources.reduce((n, s) => n + s.bad, 0)} /><span>rejected</span></div>
                </div>
                {sources.length === 0 && <p className="muted small">{running ? "Searching public sources…" : "No sources were found."}</p>}
                {sources.map(s => <SourceRow key={s.url} s={s} running={running} finished={finished} />)}
              </>}
            </>}

            {tab === "review" && <>
              <p className="muted small" style={{ marginBottom: 16 }}>Claims backed only by low-trust pages (social posts, job listings) wait here. Accepting one adds it to the graph with its quote.</p>
              {review.length === 0 && <div className="card muted">Nothing waiting for review.</div>}
              {review.map(r => (
                <div key={r.id} className="card">
                  <b>{r.subject} <span style={{ color: "var(--acc)" }}>{r.predicate.toLowerCase().replace(/_/g, " ")}</span> {r.object}</b>
                  <div className="quote" style={{ margin: "12px 0" }}>“{r.excerpt}”</div>
                  <div className="small muted" style={{ marginBottom: 12 }}><a href={r.url} target="_blank" rel="noreferrer">{hostOf(r.url)} ↗</a> <span className="tag warn" style={{ marginLeft: 6 }}>{r.kind}</span></div>
                  <div className="row" style={{ marginTop: 0 }}>
                    <button className="primary" disabled={decidingId === r.id} onClick={() => decide(r, "accept")}>
                      {decidingId === r.id ? "Accepting..." : "Accept"}
                    </button>
                    <button disabled={decidingId === r.id} onClick={() => decide(r, "reject")}>
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </>}

            {tab === "timeline" && <>
              <h3 className="h">What each run added</h3>
              {changes.runs.length === 0 && <div className="card muted">No runs yet.</div>}
              {changes.runs.map(r => (
                <div key={r.id} className="card">
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}><b>{r.question}</b><span className={`tag ${r.status}`}>{r.status.toLowerCase()}</span></div>
                  <div className="muted small" style={{ margin: "4px 0 12px" }}>{new Date(r.at).toLocaleString()}{r.key?.startsWith("watch:") ? " · scheduled" : ""}</div>
                  {r.added.length === 0 && <p className="muted small">No new relations.</p>}
                  {r.added.map(a => <div key={a.edgeId} className="item" onClick={() => select({ kind: "edge", id: a.edgeId })}>{a.fromLabel} <b style={{ color: "var(--acc)" }}>{a.relation.toLowerCase().replace(/_/g, " ")}</b> {a.toLabel}</div>)}
                </div>
              ))}
              {changes.dated.length > 0 && <><h3 className="h" style={{ marginTop: 24 }}>Dated facts</h3>
                {changes.dated.map(d => <div key={d.id} className="item" style={{ cursor: "default" }}><span className="tag run">{d.from}{d.to ? " – " + d.to : ""}</span> {d.subject} {d.predicate.toLowerCase().replace(/_/g, " ")} {d.object}</div>)}</>}
            </>}

            {tab === "result" && summary && <>
              <h3 className="h">Last investigation</h3>
              <div className="kpis">
                <div className="kpi"><b className="l-ok">+{summary.newEntities ?? 0}</b><span>entities</span></div>
                <div className="kpi"><b className="l-ok">+{summary.newRelations ?? 0}</b><span>relations</span></div>
                <div className="kpi"><b className={summary.conflicts ? "l-warn" : ""}>{summary.conflicts ?? 0}</b><span>conflicts</span></div>
              </div>
              <div className="card small">{summary.sourcesConsulted ?? 0} sources read · {summary.sourcesFailed?.length ?? 0} unavailable · {summary.claimsRejected ?? 0} claims rejected</div>
              {summary.llmErrors > 0 && <div className="card small l-warn">The language model failed on {summary.llmErrors} step(s), usually a rate limit. Results may be incomplete; try again later or set a different LLM_MODEL.</div>}
              {summary.queued > 0 && <div className="card small">{summary.queued} claim(s) rest on low-trust pages and are waiting in <a href="#" onClick={e => { e.preventDefault(); setTab("review"); }}>Review</a>.</div>}
              {!summary.newRelations && !summary.queued && <div className="card l-warn">No new supported facts found. Try a narrower or different question.</div>}
              {summary.nextQuestions?.length > 0 && activeJob && <><h3 className="h" style={{ marginTop: 14 }}>Suggested next questions</h3>{summary.nextQuestions.map((nq: string, i: number) => (
                <div key={i} className="item" onClick={() => { setDrawer({ type: activeJob.target_type, id: activeJob.target_id }); setObjective("Custom question"); setCustom(nq); setTab("inspect"); }}>{nq} <span className="muted">→</span></div>
              ))}</>}
              {summary.unresolved?.length > 0 && <><h3 className="h">Unresolved questions</h3>{summary.unresolved.map((u: string, i: number) => <div key={i} className="item" style={{ cursor: "default" }}>{u}</div>)}</>}
            </>}
          </div>
        </aside>

        <section className={`activity ${open_ ? "" : "closed"}`}>
          <div className="ahead">
            <b style={{ fontSize: 13 }}>Agent activity</b>
            {activeJob && <span className={`tag ${running ? "run" : activeJob.status}`}>{running ? "running" : activeJob.status.toLowerCase()}</span>}
            {active && <div className="pipe">{STAGES.map((s, i) => <span key={s} className={finished || i < stage ? "done" : i === stage ? "cur" : ""}>{finished || i < stage ? "✓ " : ""}{s}</span>)}</div>}
            <div className="spacer" />
            {running && <button className="danger" onClick={cancel}>Cancel</button>}
            <button className="ghost" onClick={() => setOpen_(o => !o)}>{open_ ? "Collapse ▾" : "Expand ▴"}</button>
          </div>
          {open_ && <div className="alog">
            {log.length === 0 && <span className="muted">No active investigation.</span>}
            {log.map(e => { const [g, c, t] = line(e); return <div key={e.seq} className={c}><span className="n">{e.seq}</span><span className="g">{g}</span><span>{t}</span></div>; })}
            <div ref={logEnd} />
          </div>}
        </section>
      </div>
    </div>
  );
}
