import { cn } from "@/lib/cn";
import { getRiskColor } from "@/lib/scoring";
import type { RiskLevel } from "@/lib/types";

export function StatusPill({
  level,
  label,
  className,
}: {
  level: RiskLevel;
  label: string;
  className?: string;
}) {
  const c = getRiskColor(level);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold",
        c.bg,
        c.text,
        c.border,
        className
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", c.dot)} aria-hidden />
      {label}
    </span>
  );
}
