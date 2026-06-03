import { cn } from "@/lib/cn";
import type { RiskLevel } from "@/lib/types";
import { getRiskLevel } from "@/lib/scoring";

function strokeForLevel(level: RiskLevel): string {
  switch (level) {
    case "low":
      return "#059669";
    case "medium":
      return "#d97706";
    case "high":
      return "#dc2626";
    default:
      return "#9ca3af";
  }
}

export function ScoreCircle({
  score,
  label,
  size = 96,
}: {
  score: number | null;
  label?: string;
  size?: number;
}) {
  const level = getRiskLevel(score ?? undefined);
  const stroke = strokeForLevel(level);
  const radius = size / 2 - 8;
  const circumference = 2 * Math.PI * radius;
  const pct = score === null ? 0 : Math.max(0, Math.min(100, score));
  const offset = circumference - (pct / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="#e5e7eb"
            strokeWidth={7}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={stroke}
            strokeWidth={7}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{ transition: "stroke-dashoffset 0.8s ease" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="tnum font-display text-xl font-bold text-ink">
            {score === null ? "—" : score}
          </span>
          {score !== null && <span className="text-[10px] text-ink-muted">/ 100</span>}
        </div>
      </div>
      {label && <span className="text-xs font-medium text-ink-soft">{label}</span>}
    </div>
  );
}

export function ScoreBar({
  score,
  label,
  hint,
  className,
}: {
  score: number | null;
  label: string;
  hint?: string;
  className?: string;
}) {
  const level = getRiskLevel(score ?? undefined);
  const stroke = strokeForLevel(level);
  const pct = score === null ? 0 : Math.max(0, Math.min(100, score));

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-ink-soft">{label}</span>
        <span className="tnum text-sm font-bold text-ink">
          {score === null ? "—" : `${score}%`}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-ink/[0.06]">
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, backgroundColor: stroke, transition: "width 0.8s ease" }}
        />
      </div>
      {hint && <p className="text-xs text-ink-muted">{hint}</p>}
    </div>
  );
}
