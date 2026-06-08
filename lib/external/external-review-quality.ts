import type { ExternalCompanySource } from "@/lib/types";

export type ExternalReviewQuality = "specific" | "partial" | "generic";

// Exact generic phrases produced by normalizeExternalSourceForPublic.
// A source whose every sentence matches one of these is considered generic.
const GENERIC_PHRASES: readonly string[] = [
  "є зовнішні відгуки працівників про компанію",
  "у джерелі згадується зовнішня оцінка компанії",
  "у джерелі згадуються вакансії або робота в компанії",
  "є зовнішнє джерело, яке потребує ручної перевірки модератором",
  "є зовнішнє джерело про компанію, яке потребує модерації",
  "є зовнішнє джерело про компанію, яке потребує модерації.",
  "у джерелі згадується зарплата або оплата",
  "у джерелі згадується управління або керівництво",
  "у джерелі згадуються умови або графік роботи",
  "є згадка про оформлення або договірні умови",
  "є позитивна згадка про умови, команду або переваги",
  "є негативна згадка або скарга",
  "є зовнішні відгуки про компанію",
  "company reviews are available",
  "there are reviews about the company",
  "джерело містить сторінку з відгуками або згадками про роботу в компанії",
];

// Concrete work topic patterns for detection
export const EXTERNAL_REVIEW_TOPIC_PATTERNS: Array<{ topic: string; pattern: RegExp }> = [
  { topic: "зарплата", pattern: /зарплат|salary|оплат|виплат|грн|₴|\d+\s*(тис|k\b)/i },
  { topic: "оформлення", pattern: /офіційне оформлення|трудова угода|трудовий договір/i },
  { topic: "графік", pattern: /5\/2|2\/2|позмін|графік\s/i },
  { topic: "затримки виплат", pattern: /затримк|не платять|борг зарплат|невиплат/i },
  { topic: "керівництво", pattern: /керівниц|начальств|management/i },
  { topic: "колектив", pattern: /команда|колектив|team/i },
  { topic: "навантаження", pattern: /понаднормов|навантаженн|overload|overtime/i },
  { topic: "штрафи", pattern: /штраф/i },
  { topic: "бронювання", pattern: /брон[юь]ванн|відстрочк/i },
  { topic: "кар'єра", pattern: /кар.єр|career|підвищенн/i },
  { topic: "співбесіда", pattern: /співбесід|interview/i },
];

function normalizeForMatch(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim().replace(/[.!?;]$/, "");
}

function isGenericPhrase(text: string): boolean {
  const n = normalizeForMatch(text);
  return GENERIC_PHRASES.some((phrase) => n === phrase || n.includes(phrase));
}

export function isGenericExternalSummary(source: ExternalCompanySource): boolean {
  const allTexts = [
    source.shortSummary,
    ...source.positivePoints,
    ...source.negativePoints,
    ...source.neutralFacts,
  ].filter(Boolean);

  if (allTexts.length === 0) return true;
  return allTexts.every((t) => isGenericPhrase(t));
}

export function detectExternalReviewTopics(source: ExternalCompanySource): string[] {
  const text = [
    source.shortSummary,
    ...source.positivePoints,
    ...source.negativePoints,
    ...source.neutralFacts,
    source.sourceExcerpt ?? "",
  ].join(" ");

  return EXTERNAL_REVIEW_TOPIC_PATTERNS
    .filter(({ pattern }) => pattern.test(text))
    .map(({ topic }) => topic);
}

export interface ExternalReviewSourceQuality {
  quality: ExternalReviewQuality;
  hasConcreteWorkSignals: boolean;
  topics: string[];
  isGenericOnly: boolean;
}

export function getExternalReviewSourceQuality(
  source: ExternalCompanySource
): ExternalReviewSourceQuality {
  const isGenericOnly = isGenericExternalSummary(source);
  const topics = detectExternalReviewTopics(source);

  const hasConcreteWorkSignals =
    source.reviewsCount > 0 ||
    source.ratingValue !== null ||
    topics.length >= 2 ||
    source.negativePoints.some((p) => !isGenericPhrase(p));

  let quality: ExternalReviewQuality;
  if (hasConcreteWorkSignals && !isGenericOnly) {
    quality = "specific";
  } else if (hasConcreteWorkSignals || (!isGenericOnly && topics.length >= 1)) {
    quality = "partial";
  } else if (topics.length >= 1) {
    quality = "partial";
  } else {
    quality = "generic";
  }

  return { quality, hasConcreteWorkSignals, topics, isGenericOnly };
}

// Used by risk guard: counts as strong reputation evidence if it has actual review/rating data
// Generic auto-published backfill entries (reviewsCount=0, ratingValue=null, no specific negatives) do NOT count.
export function isSpecificReputationSource(source: ExternalCompanySource): boolean {
  if (!["reviews", "rating"].includes(source.sourceType)) return false;
  if (source.reviewsCount > 0) return true;
  if (source.ratingValue !== null) return true;
  // Has negative points that go beyond the generic "Є негативна згадка або скарга."
  if (source.negativePoints.some((p) => !isGenericPhrase(p))) return true;
  return false;
}

export const GENERIC_SUMMARY_FALLBACK =
  "Джерело містить сторінку з відгуками або згадками про роботу в компанії, але без достатньо конкретного узагальнення. Деталі варто перевірити за посиланням.";

export const QUALITY_LABELS: Record<ExternalReviewQuality, string> = {
  specific: "конкретне джерело",
  partial: "часткові дані",
  generic: "мало конкретики",
};
