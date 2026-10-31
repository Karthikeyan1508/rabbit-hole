"use client";
import { useEffect, useState } from "react";
import { api } from "./api";
import { Button } from "./ui/button";

const SCHEDULE_OPTIONS = [
  { value: 0, label: "Off", tooltip: "Disabled" },
  { value: 6, label: "6 Hours", tooltip: "Every 6 hours" },
  { value: 24, label: "Daily", tooltip: "Every 24 hours" },
  { value: 168, label: "Weekly", tooltip: "Every 7 days" },
];

export function MonitoringPanel({
  invId,
  busy,
  onStarted,
  onError,
}: {
  invId: string;
  busy: boolean;
  onStarted: (expansionId: string) => void;
  onError: (m: string) => void;
}) {
  const [hours, setHours] = useState(0);
  const [hook, setHook] = useState("");
  const [last, setLast] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api(`/investigations/${invId}/watch`)
      .then((w) => {
        setHours(w.hours);
        setHook(w.webhook ?? "");
        setLast(w.lastWatchAt);
      })
      .catch(() => {});
  }, [invId]);

  async function save(h: number, webhookUrl = hook) {
    setSaving(true);
    setSaved(false);
    try {
      const w = await api(`/investigations/${invId}/watch`, {
        method: "PUT",
        body: JSON.stringify({ hours: h, webhook: webhookUrl }),
      });
      setHours(w.hours);
      setLast(w.lastWatchAt);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e: any) {
      onError(e.message || "Failed to update watch schedule");
    } finally {
      setSaving(false);
    }
  }

  async function handleCheckNow() {
    setChecking(true);
    try {
      const res = await api(`/investigations/${invId}/watch`, { method: "POST" });
      onStarted(res.expansionId);
    } catch (e: any) {
      onError(e.message || "Failed to trigger live check");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="flex flex-col gap-2.5">
      {/* Segmented schedule bar (fits natural sidebar flow, no card container) */}
      <div className="flex items-center p-0.5 bg-[var(--soft)] rounded-lg border border-[var(--line)]">
        {SCHEDULE_OPTIONS.map((opt) => {
          const isSelected = hours === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              disabled={saving}
              onClick={() => {
                setHours(opt.value);
                save(opt.value);
              }}
              title={opt.tooltip}
              className={`flex-1 py-1.5 px-1 text-xs font-semibold rounded-md transition-all text-center ${
                isSelected
                  ? "bg-[var(--paper)] text-[var(--acc)] shadow-xs"
                  : "text-[var(--mute)] hover:text-[var(--ink)]"
              }`}
              style={{
                border: isSelected ? "1px solid var(--line2)" : "1px solid transparent",
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* Webhook input when watch is enabled */}
      {hours > 0 && (
        <div className="flex flex-col gap-1">
          <input
            placeholder="Slack webhook URL (https://...)"
            value={hook}
            onChange={(e) => setHook(e.target.value)}
            onBlur={() => save(hours, hook)}
            className="w-full text-xs"
          />
        </div>
      )}

      {/* Status info line */}
      <div className="flex items-center justify-between text-[11px] text-[var(--mute)] px-0.5">
        <span>
          {hours === 0
            ? "Automated alerts off"
            : hours === 6
            ? "Scans every 6h & sends to Slack"
            : hours === 24
            ? "Daily digest sent to Slack"
            : "Weekly digest sent to Slack"}
        </span>
        {saved && <span className="text-emerald-600 font-semibold">✓ Saved</span>}
      </div>

      {last && (
        <div className="text-[10px] text-[var(--mute)] px-0.5">
          Last checked: {new Date(last).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })},{" "}
          {new Date(last).toLocaleDateString([], { month: "short", day: "numeric" })}
        </div>
      )}

      {/* Clean button */}
      <Button
        full
        disabled={busy || checking}
        onClick={handleCheckNow}
      >
        {checking ? "Checking & Notifying…" : "Check now & Send to Slack"}
      </Button>
    </div>
  );
}
