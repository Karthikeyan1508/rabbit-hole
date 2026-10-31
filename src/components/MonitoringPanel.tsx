"use client";
import { useEffect, useState } from "react";
import { api } from "./api";
import { Button } from "./ui/button";
import { Select } from "./ui/select";

const EVERY = [{ value: 0, label: "Off" }, { value: 6, label: "Every 6 hours" }, { value: 24, label: "Daily" }, { value: 168, label: "Weekly" }];

/** Schedule re-checks of the root entity and an optional Slack-style webhook; "Check now" runs one immediately. */
export function MonitoringPanel({ invId, busy, onStarted, onError }: {
  invId: string; busy: boolean; onStarted: (expansionId: string) => void; onError: (m: string) => void;
}) {
  const [hours, setHours] = useState(0);
  const [hook, setHook] = useState("");
  const [last, setLast] = useState<string | null>(null);

  useEffect(() => {
    api(`/investigations/${invId}/watch`).then(w => { setHours(w.hours); setHook(w.webhook ?? ""); setLast(w.lastWatchAt); }).catch(() => {});
  }, [invId]);

  async function save(h: number, webhook = hook) {
    try { const w = await api(`/investigations/${invId}/watch`, { method: "PUT", body: JSON.stringify({ hours: h, webhook }) }); setHours(w.hours); setLast(w.lastWatchAt); }
    catch (e: any) { onError(e.message); }
  }
  async function checkNow() {
    try { onStarted((await api(`/investigations/${invId}/watch`, { method: "POST" })).expansionId); } catch (e: any) { onError(e.message); }
  }

  return (
    <div className="stack">
      <Select value={hours} onChange={h => { setHours(h); save(h); }} options={EVERY} />
      {hours > 0 && <input placeholder="Slack webhook URL (optional)" value={hook} onChange={e => setHook(e.target.value)} onBlur={() => save(hours)} />}
      <p className="muted small">{hours ? "Re-checks for new or changed facts" : "Get alerted when new facts appear"}{last ? ` · last ${new Date(last).toLocaleString()}` : ""}</p>
      <Button full disabled={busy} onClick={checkNow}>Check now</Button>
    </div>
  );
}
