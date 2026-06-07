import { cn } from "@/lib/cn";

type Tone = "neutral" | "brand" | "warning" | "danger" | "muted" | "source";

const tones: Record<Tone, string> = {
  neutral: "bg-ink/[0.05] text-ink-soft",
  brand:   "bg-brand-50 text-brand-700 border border-brand-100",
  warning: "bg-amber-50 text-amber-700 border border-amber-100",
  danger:  "bg-red-50 text-red-700 border border-red-100",
  muted:   "border border-ink/[0.1] bg-ink/[0.03] text-ink-muted",
  source:  "border border-ink/[0.1] bg-ink/[0.025] text-ink-soft",
};

export function Badge({
  children,
  tone = "neutral",
  dot,
  className,
}: {
  children: React.ReactNode;
  tone?: Tone;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold",
        tones[tone],
        className
      )}
    >
      {dot && (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-80" />
      )}
      {children}
    </span>
  );
}
