"use client";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

/** Aceternity-style tab bar: the active pill glides between tabs via a shared layoutId. Badges show only when provided. */
export function AnimatedTabs<T extends string>({ tabs, value, onChange, id }: {
  tabs: { key: T; label: string; badge?: number; hot?: boolean; disabled?: boolean }[];
  value: T; onChange: (k: T) => void; id: string;
}) {
  return (
    <div className="flex gap-0.5 rounded-xl border border-[var(--line)] bg-[var(--soft)] p-1">
      {tabs.map(t => (
        <button key={t.key} disabled={t.disabled} onClick={() => onChange(t.key)}
          className={cn("at relative h-10 min-w-0 flex-auto rounded-lg !border-0 !bg-transparent px-2.5 text-[13px] font-medium whitespace-nowrap transition-colors",
            value === t.key ? "text-[var(--acc)]" : "text-[var(--mute)] hover:text-[var(--ink)]")}>
          {value === t.key && (
            <motion.span layoutId={`${id}-pill`} transition={{ type: "spring", bounce: 0.2, duration: 0.5 }}
              className="absolute inset-0 rounded-lg border border-[var(--line)] bg-white shadow-[0_1px_2px_rgba(20,33,61,.08)]" />
          )}
          <span className="relative z-10 inline-flex items-center gap-1.5">{t.label}
            {!!t.badge && <em className={cn("rounded-full px-1.5 text-[11px] leading-5 not-italic", t.hot ? "bg-[var(--amb-soft)] text-[var(--amb)]" : "bg-[var(--acc-soft)] text-[var(--acc)]")}>{t.badge}</em>}
          </span>
        </button>
      ))}
    </div>
  );
}
