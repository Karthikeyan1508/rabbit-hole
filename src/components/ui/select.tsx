"use client";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type Option<T> = { value: T; label: string };

/** Custom dropdown replacing the native <select>: styled list, check on the selected row, closes on outside click or Escape. */
export function Select<T extends string | number>({ value, onChange, options, placeholder = "Select…", disabled, className }: {
  value: T | ""; onChange: (v: T) => void; options: Option<T>[]; placeholder?: string; disabled?: boolean; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const current = options.find(o => o.value === value);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  return (
    <div ref={box} className={cn("sel-wrap", className)}>
      <button type="button" className="sel" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <span className={cn("sel-label", !current && "sel-empty")}>{current?.label ?? placeholder}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={cn("sel-chev", open && "sel-chev-open")}><path d="m6 9 6 6 6-6" /></svg>
      </button>
      <AnimatePresence>
        {open && (
          <motion.ul role="listbox" className="sel-menu" initial={{ opacity: 0, y: -4, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.12 }}>
            {options.map(o => (
              <li key={String(o.value)} role="option" aria-selected={o.value === value} className={cn("sel-opt", o.value === value && "sel-opt-on")}
                onClick={() => { onChange(o.value); setOpen(false); }}>
                <span>{o.label}</span>
                {o.value === value && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5L20 7" /></svg>}
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
