import { cn } from "@/lib/cn";

type Tone = "neutral" | "brand" | "warning" | "danger" | "muted";

const tones: Record<Tone, string> = {
  neutral: "bg-ink/[0.05] text-ink-soft",
  brand: "bg-brand-50 text-brand-700 border border-brand-100",
  warning: "bg-amber-50 text-amber-700 border border-amber-100",
  danger: "bg-red-50 text-red-700 border border-red-100",
  muted: "bg-gray-100 text-gray-600",
};

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium",
        tones[tone],
        className
      )}
    >
      {children}
    </span>
  );
}
