import type {
  ExternalCompanySource,
  ExternalCompanySourceConfidence,
  ExternalRating,
  CompanyOpenFact,
} from "@/lib/types";
import type { PublishedCompanyReviewFacts } from "@/lib/company-service";
import type { CompanyOpenFactSummary } from "@/lib/company-open-facts-service";
import type { ExternalReviewSignalSummary } from "@/lib/external-review-signals-service";

export const CONFIDENCE_LABELS: Record<ExternalCompanySourceConfidence, string> = {
  low: "низька",
  medium: "середня",
  high: "висока",
};

export type CompactSourceCard = {
  id: string;
  sourceName: string;
  sourceUrl: string | null;
  sourceType: ExternalCompanySource["sourceType"];
  title: string | null;
  shortSummary: string;
  confidence: ExternalCompanySource["confidence"];
  collectedAt: string | null;
};

export function formatDate(value: string | null): string {
  if (!value) return "не вказано";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "не вказано";
  return date.toLocaleDateString("uk-UA");
}

export function shortText(value: string | null, limit = 240): string | null {
  const text = value?.replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > limit ? `${text.slice(0, limit - 1).trim()}…` : text;
}

export function isSourceSummaryFact(fact: CompanyOpenFact): boolean {
  const title = fact.vacancyTitle?.toLowerCase() ?? "";
  const excerpt = fact.rawExcerpt?.toLowerCase() ?? "";
  return (
    title.startsWith("сторінка компанії на") ||
    title.includes("сторінка компанії у джерелі") ||
    excerpt.includes("компанія має сторінку")
  );
}

export function getRealVacancyFacts(facts: CompanyOpenFact[]): CompanyOpenFact[] {
  return facts.filter((fact) => !isSourceSummaryFact(fact));
}

export function getSourceSummaryFacts(facts: CompanyOpenFact[]): CompanyOpenFact[] {
  return facts.filter(isSourceSummaryFact);
}

export function extractOpenVacanciesCount(rawExcerpt: string | null): number | null {
  const match = rawExcerpt?.match(/Кількість відкритих вакансій у списку:\s*(\d+)/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

export function openFactSummaryText(fact: CompanyOpenFact): string {
  const count = extractOpenVacanciesCount(fact.rawExcerpt);
  if (isSourceSummaryFact(fact)) {
    return count !== null
      ? `Компанія має сторінку у відкритому джерелі. Вакансій у відкритому джерелі: ${count}. Це не кількість відгуків.`
      : "Компанія має сторінку у відкритому джерелі.";
  }
  const parts = [
    fact.city ? `Місто: ${fact.city}` : null,
    fact.salaryText ? `зарплата: ${fact.salaryText}` : null,
    fact.schedule ? `графік: ${fact.schedule}` : null,
    fact.employmentType ? `оформлення: ${fact.employmentType}` : null,
  ].filter(Boolean);
  return parts.length > 0
    ? parts.join(" · ")
    : shortText(fact.rawExcerpt, 160) ?? "Є дані з відкритої вакансії.";
}

export function dedupeSentences(value: string): string {
  const sentences = value
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const sentence of sentences) {
    const key = sentence.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(sentence);
  }
  return result.join(" ");
}

export function sourceIdentityKey(card: CompactSourceCard): string {
  if (card.sourceUrl) {
    return `url:${card.sourceUrl.replace(/[#?].*$/, "").replace(/\/+$/, "").toLowerCase()}`;
  }
  return [card.sourceName, card.sourceType, card.title ?? "", card.shortSummary]
    .join("|")
    .toLowerCase();
}

export function isUselessDuplicateTitle(title: string | null, summary: string): boolean {
  if (!title) return true;
  const normalizedTitle = title.trim().toLowerCase();
  const normalizedSummary = summary.trim().toLowerCase();
  return !normalizedTitle || normalizedSummary.includes(normalizedTitle);
}

export function externalSourceTypeLabel(type: string): string {
  if (type === "reviews") return "відгуки";
  if (type === "rating") return "оцінка";
  if (type === "vacancy") return "вакансія";
  if (type === "company_page") return "сторінка компанії";
  if (type === "article") return "стаття";
  return "джерело";
}

export function getExternalCompanyRatingSources(
  sources: ExternalCompanySource[]
): ExternalCompanySource[] {
  return sources.filter((source) => source.sourceType === "rating");
}

export function getExternalCompanyOpenSources(
  sources: ExternalCompanySource[]
): ExternalCompanySource[] {
  return sources.filter((source) => source.sourceType !== "rating");
}

export function isWorkOrRobotaDomain(sourceUrl: string | null, sourceName: string): boolean {
  const url = (sourceUrl ?? "").toLowerCase();
  const name = sourceName.toLowerCase();
  return (
    url.includes("work.ua") || url.includes("robota.ua") ||
    name.includes("work.ua") || name.includes("robota.ua")
  );
}

export function getExternalCompanyReviewSources(
  sources: ExternalCompanySource[]
): ExternalCompanySource[] {
  return sources.filter(
    (s) => s.sourceType === "reviews" && !isWorkOrRobotaDomain(s.sourceUrl, s.sourceName)
  );
}

export function getExternalCompanyNonReviewOpenSources(
  sources: ExternalCompanySource[]
): ExternalCompanySource[] {
  return sources.filter(
    (s) =>
      s.sourceType === "vacancy" ||
      s.sourceType === "company_page" ||
      s.sourceType === "article" ||
      s.sourceType === "other"
  );
}

export function getCompactOpenSourceCards(
  externalCompanySources: ExternalCompanySource[],
  openFacts: CompanyOpenFact[]
): CompactSourceCard[] {
  const cards: CompactSourceCard[] = [
    ...getExternalCompanyNonReviewOpenSources(externalCompanySources).map((source) => ({
      id: `external-${source.id}`,
      sourceName: source.sourceName,
      sourceUrl: source.sourceUrl,
      sourceType: source.sourceType,
      title: source.title,
      shortSummary:
        shortText(dedupeSentences(source.shortSummary), 180) ??
        "Є підтверджене відкрите джерело.",
      confidence: source.confidence,
      collectedAt: source.collectedAt,
    })),
    ...openFacts.map((fact) => ({
      id: `open-fact-${fact.id}`,
      sourceName: fact.sourceName,
      sourceUrl: fact.sourceUrl,
      sourceType: isSourceSummaryFact(fact)
        ? ("company_page" as const)
        : ("vacancy" as const),
      title: isSourceSummaryFact(fact)
        ? `Сторінка компанії: ${fact.sourceName}`
        : fact.vacancyTitle ?? "Відкрита вакансія",
      shortSummary: openFactSummaryText(fact),
      confidence: "medium" as const,
      collectedAt: fact.collectedAt,
    })),
  ];

  const seen = new Set<string>();
  return cards.filter((card) => {
    const key = sourceIdentityKey(card);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function getCompactSourceBreakdown({
  facts,
  externalRatings,
  externalCompanySources,
  openFacts,
  openFactSummary,
  externalReviewSignalSummary,
}: {
  facts: PublishedCompanyReviewFacts;
  externalRatings: ExternalRating[];
  externalCompanySources: ExternalCompanySource[];
  openFacts: CompanyOpenFact[];
  openFactSummary: CompanyOpenFactSummary;
  externalReviewSignalSummary: ExternalReviewSignalSummary;
}) {
  const ratingSources = getExternalCompanyRatingSources(externalCompanySources);
  // Only count non-Work.ua/Robota.ua reviews as reputation evidence
  const reviewSources = getExternalCompanyReviewSources(externalCompanySources);
  const vacancySources = externalCompanySources.filter((s) => s.sourceType === "vacancy");
  const companyPageSources = externalCompanySources.filter(
    (s) => s.sourceType === "company_page"
  );
  const totalExternalSources =
    getCompactOpenSourceCards(externalCompanySources, openFacts).length +
    ratingSources.length +
    reviewSources.length;
  const reputationSourcesTotal =
    facts.reviewCount +
    externalRatings.length +
    externalReviewSignalSummary.signalCount +
    reviewSources.length +
    ratingSources.length;
  const openFactSourcesTotal =
    openFactSummary.factsCount + vacancySources.length + companyPageSources.length;

  return {
    totalExternalSources,
    ratingSourcesCount: externalRatings.length + ratingSources.length,
    reviewSourcesCount: reviewSources.length,
    vacancySourcesCount: vacancySources.length + getRealVacancyFacts(openFacts).length,
    companyPageSourcesCount: companyPageSources.length + getSourceSummaryFacts(openFacts).length,
    reputationSourcesTotal,
    openFactSourcesTotal,
  };
}

export function getCompanyDataLevel(
  facts: PublishedCompanyReviewFacts,
  externalRatingsCount: number,
  openFactsCount: number,
  externalReviewSignalsCount: number,
  externalCompanySourcesCount: number
): "Поки недостатньо даних" | "Є часткові дані" | "Є достатньо даних" {
  if (
    facts.reviewCount === 0 &&
    externalRatingsCount === 0 &&
    openFactsCount === 0 &&
    externalReviewSignalsCount === 0 &&
    externalCompanySourcesCount === 0
  ) {
    return "Поки недостатньо даних";
  }
  if (
    facts.reviewCount >= 5 ||
    (facts.reviewCount >= 2 &&
      (externalRatingsCount >= 2 ||
        openFactsCount >= 2 ||
        externalReviewSignalsCount >= 2 ||
        externalCompanySourcesCount >= 2))
  ) {
    return "Є достатньо даних";
  }
  return "Є часткові дані";
}

export function dataLevelLabel(
  level: ReturnType<typeof getCompanyDataLevel>
): string {
  if (level === "Поки недостатньо даних") return "Недостатньо даних";
  if (level === "Є часткові дані") return "Часткові дані";
  return "Достатньо даних";
}
