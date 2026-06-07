import type { ExternalCompanySourceConfidence, ExternalCompanySourceType } from "@/lib/types";
import { readExternalSourceUrl, type SafeSourceFetchStatus } from "./source-fetcher";
import {
  detectSourceLanguage,
  inferSourceTypeFromContent,
  normalizeExternalSourceForPublic,
  sanitizeText,
  sourceNameFromUrl,
} from "./source-normalizer";

export interface ExternalSourceEnrichmentInput {
  sourceUrl: string;
  sourceName?: string | null;
  sourceType?: ExternalCompanySourceType | null;
}

export interface ExternalSourceEnrichmentResult {
  status: SafeSourceFetchStatus;
  sourceUrl: string;
  sourceName: string;
  sourceType: ExternalCompanySourceType;
  title: string | null;
  description: string | null;
  shortSummary: string;
  positivePoints: string[];
  negativePoints: string[];
  neutralFacts: string[];
  ratingValue: number | null;
  ratingScale: number | null;
  reviewsCount: number;
  confidence: ExternalCompanySourceConfidence;
  sourceExcerpt: string | null;
  adminNote: string | null;
  warning: string | null;
}

function compactText(value: string | null | undefined, limit = 800): string {
  return sanitizeText(value ?? "", limit);
}

function detectPoints(text: string): { positive: string[]; negative: string[]; neutral: string[] } {
  const lower = text.toLowerCase();
  const positive: string[] = [];
  const negative: string[] = [];
  const neutral: string[] = [];

  if (/офіцій|оформл|contract|договір/.test(lower)) positive.push("Згадується офіційне оформлення.");
  if (/ставка|salary|зарплат|оплата/.test(lower)) neutral.push("У джерелі згадується оплата або зарплата.");
  if (/бронюван|відстроч/.test(lower)) neutral.push("Є згадка про бронювання або відстрочку.");
  if (/позитив|добре|вигідн|прозор|команда/.test(lower)) positive.push("Є позитивна згадка про умови або команду.");
  if (/затрим|штраф|негатив|важк|поган|плинність|перевантаж|конфлікт/.test(lower)) negative.push("Є ризикова або негативна згадка.");
  return { positive, negative, neutral };
}

function extractRating(text: string): { ratingValue: number | null; ratingScale: number | null; reviewsCount: number } {
  const compact = text.replace(/\s+/g, " ");
  const ratingMatch = compact.match(/(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)/);
  const countMatch = compact.match(/(\d[\d\s]*)\s+(відгук|відгуки|відгуків|reviews?|оцінок)/i);
  const ratingValue = ratingMatch ? Number(ratingMatch[1].replace(",", ".")) : null;
  const ratingScale = ratingMatch ? Number(ratingMatch[2].replace(",", ".")) : null;
  const reviewsCount = countMatch ? Number(countMatch[1].replace(/\s+/g, "")) : 0;
  return {
    ratingValue: Number.isFinite(ratingValue as number) ? ratingValue : null,
    ratingScale: Number.isFinite(ratingScale as number) ? ratingScale : null,
    reviewsCount: Number.isFinite(reviewsCount) ? reviewsCount : 0,
  };
}

function confidenceFromText(text: string, status: SafeSourceFetchStatus): ExternalCompanySourceConfidence {
  if (status !== "success") return "low";
  if (/відгук|відгуки|оцінк|рейтинг|reviews?|rating/.test(text.toLowerCase())) return "high";
  if (text.trim().length > 250) return "medium";
  return "low";
}

export async function enrichExternalCompanySourceUrl(
  input: ExternalSourceEnrichmentInput
): Promise<ExternalSourceEnrichmentResult> {
  const normalizedName = input.sourceName?.trim() || sourceNameFromUrl(input.sourceUrl);
  const fetchResult = await readExternalSourceUrl(input.sourceUrl, {
    allowAnyPublicHost: true,
    timeoutMs: 8000,
    maxBytes: 1024 * 1024,
  });

  const sourceText = [fetchResult.title, fetchResult.description, fetchResult.text].filter(Boolean).join(" ");
  const sourceType = input.sourceType ?? inferSourceTypeFromContent(fetchResult.title ?? null, fetchResult.description ?? null, input.sourceUrl);
  const points = detectPoints(sourceText || input.sourceUrl);
  const rating = sourceType === "rating" || sourceType === "reviews"
    ? extractRating(sourceText)
    : { ratingValue: null, ratingScale: null, reviewsCount: 0 };
  const sourceLanguage = detectSourceLanguage({
    title: fetchResult.title ?? null,
    snippet: `${fetchResult.description ?? ""} ${fetchResult.text ?? ""}`,
    sourceUrl: input.sourceUrl,
  });
  const normalized = normalizeExternalSourceForPublic({
    title: fetchResult.title ?? null,
    snippet: `${fetchResult.description ?? ""} ${fetchResult.text ?? ""}`,
    sourceUrl: input.sourceUrl,
    sourceType,
    sourceLanguage,
  });
  const short = fetchResult.status === "success"
    ? normalized.ukrainianShortSummary
    : compactText(`${normalized.ukrainianTitle} — ${fetchResult.reason ?? fetchResult.status}`, 300);
  const adminNotes = [
    `Original language: ${normalized.sourceLanguage}`,
    fetchResult.status === "success" ? null : `Fetch blocked/captcha/timeout: ${fetchResult.reason ?? fetchResult.status}`,
  ].filter(Boolean);

  return {
    status: fetchResult.status,
    sourceUrl: fetchResult.url,
    sourceName: normalizedName,
    sourceType,
    title: normalized.ukrainianTitle || fetchResult.title || null,
    description: fetchResult.description ?? null,
    shortSummary: short,
    positivePoints: normalized.positivePointsUk.length ? normalized.positivePointsUk : points.positive,
    negativePoints: normalized.negativePointsUk.length ? normalized.negativePointsUk : points.negative,
    neutralFacts: normalized.neutralFactsUk.length ? normalized.neutralFactsUk : points.neutral,
    ratingValue: rating.ratingValue,
    ratingScale: rating.ratingScale,
    reviewsCount: rating.reviewsCount,
    confidence: confidenceFromText(sourceText || short, fetchResult.status),
    sourceExcerpt: fetchResult.text ? fetchResult.text.slice(0, 800) : null,
    adminNote: adminNotes.join("; ") || null,
    warning: fetchResult.status === "success" ? null : fetchResult.reason ?? fetchResult.status,
  };
}
