import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "motion/react";

import { useState } from "react";
import type { ReactNode } from "react";

export const HoverEffect = ({
  items,
  className,
  compact,
}: {
  items: {
    title: string;
    description: string;
    link: string;
    icon?: ReactNode;
  }[];
  className?: string;
  compact?: boolean; // one-line rows instead of tall tiles
}) => {
  let [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  return (
    <div
      className={cn(
        "grid grid-cols-1 md:grid-cols-2  lg:grid-cols-3  py-10",
        className
      )}
    >
      {items.map((item, idx) => (
        <a
          href={item?.link}
          key={item?.link}
          className={cn("relative group block h-full w-full no-underline hover:no-underline", compact ? "p-1" : "p-2")}
          onMouseEnter={() => setHoveredIndex(idx)}
          onMouseLeave={() => setHoveredIndex(null)}
        >
          <AnimatePresence>
            {hoveredIndex === idx && (
              <motion.span
                className="absolute inset-0 h-full w-full bg-[var(--acc-soft)] block  rounded-3xl"
                layoutId="hoverBackground"
                initial={{ opacity: 0 }}
                animate={{
                  opacity: 1,
                  transition: { duration: 0.15 },
                }}
                exit={{
                  opacity: 0,
                  transition: { duration: 0.15, delay: 0.2 },
                }}
              />
            )}
          </AnimatePresence>
          <Card pad={compact ? "px-4 py-3" : "p-5"}>
            <div className={compact ? "flex items-center gap-3" : ""}>
              {item.icon && <div className={cn("grid shrink-0 place-items-center rounded-lg bg-[var(--acc-soft)] text-[var(--acc)]", compact ? "h-8 w-8" : "mb-3 h-9 w-9")}>{item.icon}</div>}
              <div className="min-w-0">
                <CardTitle className={compact ? "truncate" : ""}>{item.title}</CardTitle>
                <CardDescription className={compact ? "!mt-0 truncate text-xs" : ""}>{item.description}</CardDescription>
              </div>
            </div>
          </Card>
        </a>
      ))}
    </div>
  );
};

export const Card = ({
  className,
  children,
  pad = "p-5",
}: {
  className?: string;
  children: React.ReactNode;
  pad?: string;
}) => {
  return (
    <div
      className={cn(
        "rounded-2xl h-full w-full overflow-hidden bg-white border border-[var(--line)] group-hover:border-[var(--acc-line)] relative z-20",
        className
      )}
    >
      <div className="relative z-50">
        <div className={pad}>{children}</div>
      </div>
    </div>
  );
};
export const CardTitle = ({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) => {
  return (
    <h4 className={cn("text-[var(--ink)] font-semibold text-[15px] leading-snug", className)}>
      {children}
    </h4>
  );
};
export const CardDescription = ({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) => {
  return (
    <p
      className={cn(
        "mt-1.5 text-[var(--mute)] leading-relaxed text-[13px]",
        className
      )}
    >
      {children}
    </p>
  );
};
