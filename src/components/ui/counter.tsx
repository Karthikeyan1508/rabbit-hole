"use client";
import { animate, useMotionValue, useTransform, motion } from "motion/react";
import { useEffect } from "react";

/** Counts up to `value` whenever it changes. */
export function Counter({ value, className }: { value: number; className?: string }) {
  const mv = useMotionValue(0);
  const text = useTransform(mv, v => Math.round(v).toString());
  useEffect(() => { const c = animate(mv, value, { duration: 0.8, ease: "easeOut" }); return () => c.stop(); }, [value, mv]);
  return <motion.b className={className}>{text}</motion.b>;
}
