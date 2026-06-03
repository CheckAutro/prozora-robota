import { cn } from "@/lib/cn";
import { Info } from "lucide-react";

export function MetricCard({
  label,
  value,
  hint,
  accent,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  accent?: "brand" | "amber" | "red" | "gray";
  className?: string;
}) {
  const accentColor =
    accent === "amber"
      ? "text-amber-700"
      : accent === "red"
      ? "text-red-700"
      : accent === "gray"
      ? "text-gray-600"
      : "text-brand-700";
  return (
    <div
      className={cn(
        "rounded-xl border border-ink/[0.06] bg-white p-4 shadow-card",
        className
      )}
    >
      <p className="text-xs font-medium text-ink-muted">{label}</p>
      <p className={cn("mt-1 font-display text-lg font-bold tnum", accentColor)}>{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-soft">{hint}</p>}
    </div>
  );
}

export function ExplanationBlock({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex gap-3 rounded-xl border border-brand-100 bg-brand-50/60 p-4 text-sm text-ink-soft",
        className
      )}
    >
      <Info className="h-5 w-5 shrink-0 text-brand-600" />
      <div className="leading-relaxed">{children}</div>
    </div>
  );
}
