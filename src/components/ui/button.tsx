import { cn } from "@/lib/utils";

type Variant = "secondary" | "primary" | "ghost" | "danger";

/** One button size everywhere (height comes from the global button rule); only the look varies. */
export function Button({ variant = "secondary", full, className, type = "button", ...props }:
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; full?: boolean }) {
  return <button type={type} {...props} className={cn(variant !== "secondary" && variant, full && "w-full", className)} />;
}
