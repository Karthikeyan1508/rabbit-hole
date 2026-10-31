"use client";
import { useEffect, useState } from "react";
import { api } from "./api";
import { Button } from "./ui/button";
import { Select } from "./ui/select";

const INTERVAL_OPTIONS = [
  { value: 6, label: "Every 6 hours" },
  { value: 24, label: "Daily (24 hours)" },
  { value: 168, label: "Weekly (7 days)" },
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
  const [enabled, setEnabled] = useState(false);
  const [hours, setHours] = useState(6);
  const [hook, setHook] = useState("");
  const [last, setLast] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api(`/investigations/${invId}/watch`)
      .then((w) => {
        const isWatchOn = w.hours > 0;
        setEnabled(isWatchOn);
        setHours(isWatchOn ? w.hours : 6);
        setHook(w.webhook ?? "");
        setLast(w.lastWatchAt);
      })
      .catch(() => {});
  }, [invId]);

  async function saveWatchConfig(on: boolean, h: number, webhookUrl = hook) {
    setSaving(true);
    setSaved(false);
    try {
      const w = await api(`/investigations/${invId}/watch`, {
        method: "PUT",
        body: JSON.stringify({ hours: on ? h : 0, webhook: on ? webhookUrl : null }),
      });
      setEnabled(w.hours > 0);
      setHours(w.hours > 0 ? w.hours : 6);
      setLast(w.lastWatchAt);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e: any) {
      onError(e.message || "Failed to update monitoring");
    } finally {
      setSaving(false);
    }
  }

  function handleToggle(newOn: boolean) {
    setEnabled(newOn);
    saveWatchConfig(newOn, hours, hook);
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
      {/* 1. On / Off Switch */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-[var(--ink)]">
          Continuous Monitoring
        </span>
        <div className="inline-flex rounded-lg border border-[var(--line2)] p-0.5 bg-[var(--soft)]">
          <button
            type="button"
            disabled={saving}
            onClick={() => handleToggle(false)}
            className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
              !enabled
                ? "bg-[var(--paper)] text-[var(--ink)] shadow-xs"
                : "text-[var(--mute)] hover:text-[var(--ink)]"
            }`}
          >
            Off
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => handleToggle(true)}
            className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
              enabled
                ? "bg-[var(--acc)] text-white shadow-xs"
                : "text-[var(--mute)] hover:text-[var(--ink)]"
            }`}
          >
            On
          </button>
        </div>
      </div>

      {/* 2. When ON: Show Slack Webhook URL + Interval Dropdown */}
      {enabled && (
        <div className="flex flex-col gap-2 mt-1">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-[var(--ink)]/70">
              Slack Webhook URL
            </label>
            <input
              placeholder="https://hooks.slack.com/services/..."
              value={hook}
              onChange={(e) => setHook(e.target.value)}
              onBlur={() => saveWatchConfig(true, hours, hook)}
              className="control-40 text-xs px-3 bg-[var(--paper)] border border-[var(--line2)] rounded-lg focus:border-[var(--acc)]"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-[var(--ink)]/70">
              Check Frequency
            </label>
            <Select
              value={hours}
              onChange={(val) => {
                setHours(val);
                saveWatchConfig(true, val, hook);
              }}
              options={INTERVAL_OPTIONS}
            />
          </div>
        </div>
      )}

      {/* Status info & Last check */}
      <div className="flex items-center justify-between text-[11px] text-[var(--mute)] px-0.5">
        <span>
          {enabled
            ? `Active · Scans every ${hours === 24 ? "day" : hours === 168 ? "week" : `${hours}h`}`
            : "Automated alerts disabled"}
        </span>
        {saved && <span className="text-emerald-600 font-semibold">✓ Saved</span>}
      </div>

      {last && (
        <div className="text-[10px] text-[var(--mute)] px-0.5">
          Last scan: {new Date(last).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })},{" "}
          {new Date(last).toLocaleDateString([], { month: "short", day: "numeric" })}
        </div>
      )}

      {/* 3. Check now button */}
      <Button
        full
        disabled={busy || checking}
        onClick={handleCheckNow}
        className="mt-1"
      >
        {checking ? "Checking & Notifying…" : "Check now & Send to Slack"}
      </Button>
    </div>
  );
}
