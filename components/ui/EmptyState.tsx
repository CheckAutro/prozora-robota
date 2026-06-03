import { cn } from "@/lib/cn";

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-ink/15 bg-white/60 px-6 py-12 text-center",
        className
      )}
    >
      {icon && <div className="text-ink-muted">{icon}</div>}
      <h3 className="font-display text-base font-semibold text-ink">{title}</h3>
      {description && (
        <p className="max-w-sm text-sm text-ink-soft">{description}</p>
      )}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
