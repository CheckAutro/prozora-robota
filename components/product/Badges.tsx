import { StatusPill } from "@/components/ui/StatusPill";
import {
  getRiskLevel,
  getRiskLabel,
  getTrustLabel,
  getBookingLabel,
} from "@/lib/scoring";
import type { RiskLevel } from "@/lib/types";

export function RiskBadge({ level }: { level: RiskLevel }) {
  return <StatusPill level={level} label={getRiskLabel(level)} />;
}

export function TrustScoreBadge({ score }: { score: number | null }) {
  const level = getRiskLevel(score ?? undefined);
  return <StatusPill level={level} label={getTrustLabel(score)} />;
}

export function BookingScoreBadge({ score }: { score: number | null }) {
  // Booking maps onto risk colours via its own thresholds.
  let level: RiskLevel = "unknown";
  if (score !== null) {
    if (score <= 29) level = "high";
    else if (score <= 59) level = "medium";
    else level = "low";
  }
  return <StatusPill level={level} label={getBookingLabel(score)} />;
}
