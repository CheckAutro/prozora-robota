import { cn } from "@/lib/cn";

export function MetricTile({
  label,
  value,
  sub,
  accent = false,
  className,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col rounded-xl border px-3 py-2.5",
        accent
          ? "border-brand-200 bg-brand-50/70"
          : "border-ink/[0.07] bg-ink/[0.025]",
        className
      )}
    >
      <p className="text-[0.6875rem] font-medium uppercase tracking-wide text-ink-muted">
        {label}
      </p>
      <p
        className={cn(
          "mt-0.5 text-xl font-bold leading-none tabular-nums",
          accent ? "text-brand-700" : "text-ink"
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-ink-muted">{sub}</p>}
    </div>
  );
}
