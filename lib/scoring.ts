import type { Company, RiskLevel } from "./types";

// --- Risk level from a 0..100 score ---------------------------------------
export function getRiskLevel(score: number | null | undefined): RiskLevel {
  if (score === null || score === undefined || Number.isNaN(score)) return "unknown";
  if (score <= 39) return "high";
  if (score <= 69) return "medium";
  return "low";
}

// --- Human label for the trust score --------------------------------------
export function getTrustLabel(score: number | null | undefined): string {
  if (score === null || score === undefined || Number.isNaN(score)) return "недостатньо даних";
  if (score <= 39) return "високий ризик";
  if (score <= 69) return "варто уточнити";
  return "можна розглядати";
}

// --- Human label for the booking score ------------------------------------
export function getBookingLabel(score: number | null | undefined): string {
  if (score === null || score === undefined || Number.isNaN(score)) return "недостатньо даних";
  if (score <= 29) return "не підтверджено";
  if (score <= 59) return "частково підтверджено";
  return "підтверджено відгуками";
}

// --- Tailwind colour token per risk level ---------------------------------
export interface RiskColorTokens {
  text: string;
  bg: string;
  border: string;
  dot: string;
}

export function getRiskColor(level: RiskLevel): RiskColorTokens {
  switch (level) {
    case "low":
      return {
        text: "text-emerald-700",
        bg: "bg-emerald-50",
        border: "border-emerald-200",
        dot: "bg-emerald-500",
      };
    case "medium":
      return {
        text: "text-amber-700",
        bg: "bg-amber-50",
        border: "border-amber-200",
        dot: "bg-amber-500",
      };
    case "high":
      return {
        text: "text-red-700",
        bg: "bg-red-50",
        border: "border-red-200",
        dot: "bg-red-500",
      };
    default:
      return {
        text: "text-gray-600",
        bg: "bg-gray-100",
        border: "border-gray-200",
        dot: "bg-gray-400",
      };
  }
}

export function getRiskLabel(level: RiskLevel): string {
  switch (level) {
    case "low":
      return "низький ризик";
    case "medium":
      return "середній ризик";
    case "high":
      return "високий ризик";
    default:
      return "недостатньо даних";
  }
}

// --- Aggregate trust score for a company ----------------------------------
// Weighted, readable formula. Each component contributes to a 0..100 score.
// Payment-delay risk is a penalty. Low review volume pulls the score toward
// "unknown" by blending with a neutral baseline.
export function calculateCompanyScore(company: Company): number {
  const {
    salaryMatchPercent,
    officialEmploymentPercent,
    bookingConfirmedPercent,
    internshipPaidPercent,
    paymentDelayRisk,
    verifiedReviewsCount,
    reviewsCount,
  } = company;

  // Weighted average of the positive signals (each already 0..100).
  const weighted =
    salaryMatchPercent * 0.3 + // honest salary matters most
    officialEmploymentPercent * 0.25 + // official paperwork
    bookingConfirmedPercent * 0.25 + // real military booking (бронювання)
    internshipPaidPercent * 0.2; // paid internship

  // Payment-delay penalty.
  const delayPenalty =
    paymentDelayRisk === "high" ? 18 : paymentDelayRisk === "medium" ? 8 : 0;

  let score = weighted - delayPenalty;

  // Confidence blending: few verified reviews -> pull toward neutral 50.
  // The more verified reviews, the more we trust the raw signal.
  const confidence = Math.min(1, verifiedReviewsCount / 8);
  score = score * confidence + 50 * (1 - confidence);

  // Tiny bonus for overall review volume (capped) — more eyes, more signal.
  const volumeBonus = Math.min(5, reviewsCount / 10);
  score += volumeBonus;

  return Math.max(0, Math.min(100, Math.round(score)));
}
