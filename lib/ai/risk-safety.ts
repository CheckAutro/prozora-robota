import type { AiAnalysisResult, AiDataLevel, AiSourceBreakdown } from "./types";

const SPARSE_SUMMARY =
  "Є відкриті факти або сторінки компанії у відкритих джерелах, але немає достатньо відгуків працівників чи підтверджених зовнішніх оцінок. Ризик неможливо оцінити повністю.";

const SPARSE_RISK = "Ризик неможливо оцінити через нестачу репутаційних даних.";

const REQUIRED_MISSING = [
  "Недостатньо відгуків користувачів Прозора робота.",
  "Немає підтверджених зовнішніх оцінок.",
  "Немає підтверджених зовнішніх відгуків або сигналів.",
];

export function completeSourceBreakdown(input: {
  internalReviews: number;
  openFacts: number;
  externalRatings: number;
  externalReviewSignals: number;
  externalCompanySourceTypes: string[];
  foundExternalSources: number;
  vacancyText: boolean;
}): AiSourceBreakdown {
  const externalReviewSources = input.externalCompanySourceTypes.filter((type) => type === "reviews").length;
  const externalRatingSources = input.externalCompanySourceTypes.filter((type) => type === "rating").length;
  const externalVacancySources = input.externalCompanySourceTypes.filter((type) => type === "vacancy").length;
  const externalCompanyPageSources = input.externalCompanySourceTypes.filter((type) => type === "company_page").length;
  const externalCompanySourcesTotal = input.externalCompanySourceTypes.length;

  return {
    internal_reviews: input.internalReviews,
    open_facts: input.openFacts,
    external_ratings: input.externalRatings,
    external_signals: input.externalReviewSignals,
    external_company_sources: externalCompanySourcesTotal,
    external_company_sources_total: externalCompanySourcesTotal,
    external_review_sources: externalReviewSources,
    external_rating_sources: externalRatingSources,
    external_vacancy_sources: externalVacancySources,
    external_company_page_sources: externalCompanyPageSources,
    reputation_sources_total:
      input.internalReviews +
      input.externalRatings +
      input.externalReviewSignals +
      externalReviewSources +
      externalRatingSources,
    open_fact_sources_total: input.openFacts + externalVacancySources + externalCompanyPageSources,
    found_external_sources: input.foundExternalSources,
    vacancy_text: input.vacancyText,
  };
}

export function normalizeSourceBreakdown(value: Partial<AiSourceBreakdown> | null | undefined): AiSourceBreakdown {
  const numberValue = (key: keyof AiSourceBreakdown): number => {
    const raw = value?.[key];
    return typeof raw === "number" && Number.isFinite(raw) ? Math.max(0, Math.trunc(raw)) : 0;
  };
  const externalCompanySourcesTotal = numberValue("external_company_sources_total") || numberValue("external_company_sources");
  const externalReviewSources = numberValue("external_review_sources");
  const externalRatingSources = numberValue("external_rating_sources");
  const externalVacancySources = numberValue("external_vacancy_sources");
  const externalCompanyPageSources = numberValue("external_company_page_sources");
  const internalReviews = numberValue("internal_reviews");
  const openFacts = numberValue("open_facts");
  const externalRatings = numberValue("external_ratings");
  const externalSignals = numberValue("external_signals");

  return {
    internal_reviews: internalReviews,
    open_facts: openFacts,
    external_ratings: externalRatings,
    external_signals: externalSignals,
    external_company_sources: externalCompanySourcesTotal,
    external_company_sources_total: externalCompanySourcesTotal,
    external_review_sources: externalReviewSources,
    external_rating_sources: externalRatingSources,
    external_vacancy_sources: externalVacancySources,
    external_company_page_sources: externalCompanyPageSources,
    reputation_sources_total:
      numberValue("reputation_sources_total") ||
      internalReviews + externalRatings + externalSignals + externalReviewSources + externalRatingSources,
    open_fact_sources_total:
      numberValue("open_fact_sources_total") ||
      openFacts + externalVacancySources + externalCompanyPageSources,
    found_external_sources: numberValue("found_external_sources"),
    vacancy_text: Boolean(value?.vacancy_text),
  };
}

export function hasReputationEvidence(breakdown: Partial<AiSourceBreakdown> | null | undefined): boolean {
  return normalizeSourceBreakdown(breakdown).reputation_sources_total > 0;
}

function unique(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const text = item.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

function sparseDataLevel(breakdown: AiSourceBreakdown): AiDataLevel {
  return breakdown.open_fact_sources_total > 0 || breakdown.external_company_sources_total > 0 || breakdown.found_external_sources > 0
    ? "partial"
    : "insufficient";
}

export function applySparseReputationGuard(
  analysis: AiAnalysisResult,
  breakdownValue: Partial<AiSourceBreakdown> | null | undefined
): AiAnalysisResult {
  const breakdown = normalizeSourceBreakdown(breakdownValue);
  if (hasReputationEvidence(breakdown) || breakdown.vacancy_text) {
    return {
      ...analysis,
      source_breakdown: breakdown,
      risk_score: analysis.risk_level === "unknown" ? null : analysis.risk_score,
    };
  }

  return {
    ...analysis,
    summary: SPARSE_SUMMARY,
    risk_level: "unknown",
    risk_score: null,
    confidence_level: "low",
    data_level: sparseDataLevel(breakdown),
    risks: [SPARSE_RISK],
    missing_data: unique([...analysis.missing_data, ...REQUIRED_MISSING]),
    recommendations: unique([
      "Перевірте конкретну вакансію.",
      "Попросіть письмово підтвердити зарплату, графік і оформлення.",
      "Не робіть висновок лише на основі кількості вакансій.",
      "Залиште анонімний відгук після співбесіди або роботи.",
      ...analysis.recommendations,
    ]).slice(0, 8),
    source_breakdown: breakdown,
  };
}
