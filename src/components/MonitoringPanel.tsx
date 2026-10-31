"use client";
import { useEffect, useState } from "react";
import { api } from "./api";
import { Button } from "./ui/button";

const SCHEDULE_OPTIONS = [
  { value: 0, label: "Off", desc: "No automated monitoring" },
  { value: 6, label: "Every 6 hours", desc: "Checks for updates in the past 6 hours" },
  { value: 24, label: "Daily (24h)", desc: "Daily summary of all changes" },
  { value: 168, label: "Weekly", desc: "Weekly comprehensive digest" },
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
  const [saveSuccess, setSaveSuccess] = useState(false);

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
    setSaveSuccess(false);
    try {
      const w = await api(`/investigations/${invId}/watch`, {
        method: "PUT",
        body: JSON.stringify({ hours: h, webhook: webhookUrl }),
      });
      setHours(w.hours);
      setLast(w.lastWatchAt);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (e: any) {
      onError(e.message || "Failed to update monitoring schedule");
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

  const selectedOpt = SCHEDULE_OPTIONS.find((o) => o.value === hours) || SCHEDULE_OPTIONS[0];

  return (
    <div className="flex flex-col gap-3 p-3 bg-white/80 border border-[var(--line)] rounded-xl shadow-xs">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wider text-[var(--ink)]/70">
          Automated Watch
        </span>
        {hours > 0 ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Active
          </span>
        ) : (
          <span className="text-[11px] text-[var(--mute)]">Disabled</span>
        )}
      </div>

      {/* Interval Selector Buttons */}
      <div className="grid grid-cols-2 gap-1.5">
        {SCHEDULE_OPTIONS.map((opt) => {
          const isSelected = hours === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                setHours(opt.value);
                save(opt.value);
              }}
              disabled={saving}
              className={`control-40 px-2.5 text-xs font-semibold rounded-lg border transition-all text-left flex flex-col justify-center ${
                isSelected
                  ? "bg-[var(--acc)] text-white border-[var(--acc)] shadow-xs"
                  : "bg-white text-[var(--ink)]/80 border-[var(--line2)] hover:bg-[var(--soft)] hover:border-[var(--dim)]"
              }`}
            >
              <span className="truncate leading-tight">{opt.label}</span>
            </button>
          );
        })}
      </div>

      <p className="text-[11px] text-[var(--mute)] leading-relaxed">
        {selectedOpt.desc}
      </p>

      {/* Slack Webhook Input */}
      {hours > 0 && (
        <div className="flex flex-col gap-1 mt-1">
          <label className="text-[11px] font-medium text-[var(--ink)]/70">
            Slack Webhook Destination
          </label>
          <input
            placeholder="https://hooks.slack.com/services/..."
            value={hook}
            onChange={(e) => setHook(e.target.value)}
            onBlur={() => save(hours, hook)}
            className="control-40 text-xs px-3 bg-white border border-[var(--line2)] rounded-lg focus:border-[var(--acc)]"
          />
          <span className="text-[10px] text-[var(--mute)]">
            Dispatches rich Slack Block Kit reports with sources & stats.
          </span>
        </div>
      )}

      {/* Last checked indicator */}
      {last && (
        <div className="text-[10px] text-[var(--mute)] flex items-center justify-between border-t border-[var(--line)] pt-2 mt-1">
          <span>Last run:</span>
          <span className="font-medium text-[var(--ink)]/80">
            {new Date(last).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })},{" "}
            {new Date(last).toLocaleDateString([], { month: 'short', day: 'numeric' })}
          </span>
        </div>
      )}

      {/* Action Trigger */}
      <Button
        full
        disabled={busy || checking}
        onClick={handleCheckNow}
        className="mt-1 font-semibold"
      >
        {checking ? "Scanning & Notifying..." : "Check now & Send to Slack"}
      </Button>

      {saveSuccess && (
        <span className="text-[10px] text-emerald-600 text-center font-medium">
          ✓ Schedule updated
        </span>
      )}
    </div>
  );
}
