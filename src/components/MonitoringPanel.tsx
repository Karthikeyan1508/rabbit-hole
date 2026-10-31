"use client";
import { useEffect, useState } from "react";
import { motion } from "motion/react";
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

  function handleToggle() {
    const nextState = !enabled;
    setEnabled(nextState);
    saveWatchConfig(nextState, hours, hook);
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
    <div className="flex flex-col gap-3">
      {/* 1. Aceternity-style Animated Switch */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-[var(--ink)]">
          Continuous Monitoring
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          disabled={saving}
          onClick={handleToggle}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
            enabled ? "bg-[var(--acc)]" : "bg-[var(--line2)]"
          }`}
        >
          <motion.span
            layout
            transition={{ type: "spring", stiffness: 500, damping: 30 }}
            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
              enabled ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>
      </div>

      {/* 2. When ON: Show Slack Webhook URL + Interval Dropdown */}
      {enabled && (
        <div className="flex flex-col gap-2.5 mt-0.5">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-[var(--ink)]">
              Slack Webhook URL
            </label>
            <input
              placeholder="https://hooks.slack.com/services/..."
              value={hook}
              onChange={(e) => setHook(e.target.value)}
              onBlur={() => saveWatchConfig(true, hours, hook)}
              className="control-40 text-sm px-3.5 bg-[var(--paper)] border border-[var(--line2)] rounded-lg focus:border-[var(--acc)] text-[var(--ink)] placeholder:text-[var(--mute)]"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-[var(--ink)]">
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
      <div className="flex items-center justify-between text-xs text-[var(--mute)] px-0.5">
        <span>
          {enabled
            ? `Active · Scans every ${hours === 24 ? "day" : hours === 168 ? "week" : `${hours} hours`}`
            : "Automated alerts disabled"}
        </span>
        {saved && <span className="text-emerald-600 font-semibold text-xs">✓ Saved</span>}
      </div>

      {last && (
        <div className="text-xs text-[var(--mute)] px-0.5">
          Last scan: {new Date(last).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })},{" "}
          {new Date(last).toLocaleDateString([], { month: "short", day: "numeric" })}
        </div>
      )}

      {/* 3. Check now button */}
      <Button
        full
        disabled={busy || checking}
        onClick={handleCheckNow}
        className="mt-0.5 text-sm font-semibold"
      >
        {checking ? "Checking & Notifying…" : "Check now & Send to Slack"}
      </Button>
    </div>
  );
}
