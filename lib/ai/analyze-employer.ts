import {
  BOOKING_WARNING,
  HIGH_RISK,
  MEDIUM_RISK,
  POSITIVE,
} from "@/lib/vacancy-parser";
import type {
  ExternalCompanySource,
  ExternalRating,
  ExternalReviewSignal,
  RiskLevel,
} from "@/lib/types";
import type {
  AiAnalysisResult,
  AiConfidenceLevel,
  AiDataLevel,
  ExternalSourceCandidate,
  ExtractedFact,
  SourceEvidence,
} from "./types";
import {
  getEmployerAiProviderName,
  runEmployerAiAnalysisPrompt,
} from "./ai-provider";
import {
  applySparseReputationGuard,
  completeSourceBreakdown,
} from "./risk-safety";
import { isSpecificReputationSource } from "@/lib/external/external-review-quality";
import { extractEvidenceFromSource } from "@/lib/external/evidence-extractor";

export interface AiReviewContext {
  id: string;
  roleCategory?: string | null;
  city?: string | null;
  year?: number | null;
  text?: string | null;
}

export interface AiOpenFactContext {
  sourceName: string;
  sourceUrl: string | null;
  vacancyTitle: string | null;
  city: string | null;
  salaryText: string | null;
  employmentType: string | null;
  schedule: string | null;
  rawExcerpt: string | null;
}

export interface AnalyzeEmployerContext {
  analysisType: "vacancy" | "company";
  company: {
    slug: string | null;
    name: string | null;
    city: string | null;
    industry: string | null;
  };
  vacancyText: string;
  vacancyUrl: string | null;
  fetchedText: string;
  roleContext: string | null;
  internalReviews: AiReviewContext[];
  openFacts: AiOpenFactContext[];
  externalRatings: ExternalRating[];
  externalSignals: ExternalReviewSignal[];
  externalCompanySources: ExternalCompanySource[];
  foundExternalSources: ExternalSourceCandidate[];
}

const DISCLAIMER =
  "AI-аналіз не є відгуком, не є гарантією безпеки і не впливає на рейтинг або кількість відгуків Прозора робота.";

function containsAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term.toLowerCase()));
}

function findLabels(text: string, items: { label: string; terms: string[] }[]): string[] {
  return items
    .filter((item) => item.terms.some((term) => text.includes(term.toLowerCase())))
    .map((item) => item.label);
}

function unique(items: Array<string | null | undefined>, limit: number): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const value = item?.replace(/\s+/g, " ").trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
    if (result.length >= limit) break;
  }
  return result;
}

function isSourceSummaryOpenFact(fact: AiOpenFactContext): boolean {
  const title = fact.vacancyTitle?.toLowerCase().trim() ?? "";
  const excerpt = fact.rawExcerpt?.toLowerCase() ?? "";
  return (
    title.startsWith("сторінка компанії на") ||
    title.startsWith("сторінка компанії у") ||
    excerpt.includes("компанія має сторінку") ||
    excerpt.includes("кількість відкритих вакансій у списку")
  );
}

function realOpenFacts(context: AnalyzeEmployerContext): AiOpenFactContext[] {
  return context.openFacts.filter((fact) => !isSourceSummaryOpenFact(fact));
}

function hasVacancyText(context: AnalyzeEmployerContext): boolean {
  return Boolean(context.vacancyText || context.fetchedText);
}

function hasReviewRatingOrDiscussionSource(context: AnalyzeEmployerContext): boolean {
  return context.foundExternalSources.some((source) =>
    ["review", "rating", "discussion"].includes(source.signal_type)
  );
}

function hasEmployerExperienceContext(context: AnalyzeEmployerContext): boolean {
  return (
    context.internalReviews.length > 0 ||
    context.externalRatings.length > 0 ||
    context.externalSignals.length > 0 ||
    context.externalCompanySources.some((source) => isSpecificReputationSource(source)) ||
    hasReviewRatingOrDiscussionSource(context)
  );
}

function isCompanyOpenFactsOnlyContext(context: AnalyzeEmployerContext): boolean {
  if (context.analysisType !== "company") return false;
  if (hasVacancyText(context)) return false;
  if (hasEmployerExperienceContext(context)) return false;
  const hasOpenContext = context.openFacts.length > 0 || context.foundExternalSources.length > 0;
  if (!hasOpenContext) return false;
  return context.foundExternalSources.every((source) =>
    ["company_page", "vacancy", "unknown"].includes(source.signal_type)
  );
}

function dataLevel(context: AnalyzeEmployerContext): AiDataLevel {
  const concreteOpenFacts = realOpenFacts(context);
  const sourceSummaryFacts = context.openFacts.length - concreteOpenFacts.length;
  const textPresent = hasVacancyText(context);
  const vacancyText = `${context.vacancyText} ${context.fetchedText}`.toLowerCase();
  const hasConcreteVacancyData =
    /грн|₴|зарплат|ставк|бонус|kpi|офіційне|оформлен|договір|графік|5\/2|2\/2|позмін|місто|компані/.test(vacancyText);
  if (isCompanyOpenFactsOnlyContext(context)) {
    return context.openFacts.length > 0 || context.foundExternalSources.length > 0
      ? "partial"
      : "insufficient";
  }
  const score =
    context.internalReviews.length * 2 +
    concreteOpenFacts.length +
    context.externalRatings.length +
    context.externalSignals.length +
    context.externalCompanySources.filter((source) => isSpecificReputationSource(source)).length +
    context.foundExternalSources.filter((source) => source.signal_type !== "company_page").length +
    (hasConcreteVacancyData ? 2 : textPresent ? 1 : 0);
  if (
    score === 0 &&
    sourceSummaryFacts > 0 &&
    context.analysisType === "company" &&
    !textPresent
  ) {
    return "insufficient";
  }
  if (score >= 6) return "enough";
  if (score >= 2) return "partial";
  return "insufficient";
}

function confidenceFromContext(context: AnalyzeEmployerContext, level: AiDataLevel): AiConfidenceLevel {
  if (!hasEmployerExperienceContext(context)) {
    if (context.analysisType === "company" && !hasVacancyText(context)) {
      return realOpenFacts(context).length >= 2 ? "medium" : "low";
    }
    return level === "insufficient" ? "low" : "medium";
  }
  if (level === "enough") return "high";
  if (level === "partial") return "medium";
  return "low";
}

function riskFromScore(score: number, level: AiDataLevel, context: AnalyzeEmployerContext): RiskLevel {
  if (level === "insufficient") return "unknown";
  if (isCompanyOpenFactsOnlyContext(context)) return "unknown";
  if (score >= 55) return "high";
  if (score >= 25) return "medium";
  return "low";
}

function normalizeContextSafety(
  result: AiAnalysisResult,
  context: AnalyzeEmployerContext
): AiAnalysisResult {
  const openFactsOnlyCompany = isCompanyOpenFactsOnlyContext(context);
  const noEmployerEvidence = !hasEmployerExperienceContext(context);
  const concreteVacancyText = hasVacancyText(context) && context.vacancyText.trim().length > 0;
  const hasConcreteVacancyInfo = /грн|₴|зарплат|ставк|бонус|kpi|офіційне|оформлен|договір|графік|5\/2|2\/2|позмін|місто|компані/i.test(
    `${context.vacancyText} ${context.fetchedText}`
  );
  const confidenceCap: AiConfidenceLevel = openFactsOnlyCompany
    ? (realOpenFacts(context).length >= 2 ? "medium" : "low")
    : noEmployerEvidence && !concreteVacancyText
      ? "low"
      : result.confidence_level;

  if (openFactsOnlyCompany) {
    return {
      ...result,
      summary:
        "Є відкриті вакансії та сторінка компанії у відкритому джерелі, але немає достатньо відгуків працівників або підтверджених зовнішніх оцінок. Ризик неможливо оцінити повністю.",
      risk_level: "unknown",
      risk_score: null,
      confidence_level: confidenceCap,
      data_level: "partial",
      risks: ["Ризик неможливо оцінити через нестачу даних."],
      recommendations: unique([
        "Перевірте конкретну вакансію.",
        "Попросіть письмово підтвердити зарплату, графік і оформлення.",
        "Не робіть висновок лише на основі кількості вакансій.",
        "Залиште анонімний відгук після співбесіди або роботи.",
      ], 6),
      analysis_mode: result.analysis_mode,
      provider: result.provider,
    };
  }

  if (noEmployerEvidence && !hasConcreteVacancyInfo) {
    return {
      ...result,
      risk_level: "unknown",
      risk_score: null,
      confidence_level: "low",
      data_level: result.data_level === "enough" ? "partial" : result.data_level,
      risks: result.risks.length > 0 ? result.risks : ["Ризик неможливо оцінити через нестачу даних."],
      recommendations: unique([
        "Перевірте конкретну вакансію.",
        "Попросіть письмово підтвердити зарплату, графік і оформлення.",
        "Не робіть висновок лише на основі кількості вакансій.",
        "Залиште анонімний відгук після співбесіди або роботи.",
      ], 6),
      analysis_mode: result.analysis_mode,
      provider: result.provider,
    };
  }

  if (noEmployerEvidence && result.risk_level === "low") {
    return {
      ...result,
      risk_level: "unknown",
      risk_score: null,
      confidence_level: confidenceCap === "high" ? "medium" : confidenceCap,
      data_level: result.data_level === "enough" ? "partial" : result.data_level,
      recommendations: unique([
        "Перевірте конкретну вакансію.",
        "Попросіть письмово підтвердити зарплату, графік і оформлення.",
        "Не робіть висновок лише на основі кількості вакансій.",
        "Залиште анонімний відгук після співбесіди або роботи.",
      ], 6),
      analysis_mode: result.analysis_mode,
      provider: result.provider,
    };
  }

  return {
    ...result,
    confidence_level:
      result.confidence_level === "high" && noEmployerEvidence ? "medium" : confidenceCap ?? result.confidence_level,
  };
}

function sourceBreakdownFromContext(context: AnalyzeEmployerContext) {
  return completeSourceBreakdown({
    internalReviews: context.internalReviews.length,
    openFacts: context.openFacts.length,
    externalRatings: context.externalRatings.length,
    externalReviewSignals: context.externalSignals.length,
    externalCompanySourceTypes: context.externalCompanySources.map((source) => source.sourceType),
    specificReviewSourcesCount: context.externalCompanySources.filter((source) => isSpecificReputationSource(source)).length,
    foundExternalSources: context.foundExternalSources.length,
    vacancyText: hasVacancyText(context),
  });
}

interface EvidencePackSourceDetail {
  source_name: string;
  source_type: string;
  extraction_status: string;
  useful: boolean;
  usefulness_score: number;
  rating?: string;
  reviews_count?: number;
  topics: string[];
  top_negative: string[];
  top_positive: string[];
  concrete_numbers: Array<{ label: string; value: string }>;
  note: string | null;
}

interface EvidencePack {
  has_reputation_evidence: boolean;
  useful_sources_count: number;
  generic_sources_count: number;
  total_extracted_facts: number;
  top_negative_signals: Array<{ category: string; text: string; severity: string; confidence: string }>;
  top_positive_signals: Array<{ category: string; text: string; confidence: string }>;
  concrete_numbers: Array<{ label: string; value: string; source: string }>;
  detected_topics: string[];
  source_details: EvidencePackSourceDetail[];
  analysis_note: string;
}

function buildEvidencePack(sources: ExternalCompanySource[]): EvidencePack {
  if (sources.length === 0) {
    return {
      has_reputation_evidence: false,
      useful_sources_count: 0,
      generic_sources_count: 0,
      total_extracted_facts: 0,
      top_negative_signals: [],
      top_positive_signals: [],
      concrete_numbers: [],
      detected_topics: [],
      source_details: [],
      analysis_note: "No external company sources available.",
    };
  }

  const extracted = sources.map((src) => ({ src, evidence: extractEvidenceFromSource(src) }));
  const useful = extracted.filter(({ evidence }) => evidence.useful_for_analysis);
  const generic = extracted.filter(({ evidence }) => !evidence.useful_for_analysis);

  const allNegFacts = useful.flatMap(({ evidence }) =>
    evidence.extracted_facts.filter((f) => f.polarity === "negative")
  );
  const allPosFacts = useful.flatMap(({ evidence }) =>
    evidence.extracted_facts.filter((f) => f.polarity === "positive")
  );

  const topNegative = allNegFacts
    .sort((a, b) => (b.severity === "high" ? 1 : 0) - (a.severity === "high" ? 1 : 0))
    .slice(0, 6)
    .map((f) => ({ category: f.category, text: f.text_uk, severity: f.severity, confidence: f.confidence }));

  const topPositive = allPosFacts.slice(0, 5).map((f) => ({
    category: f.category,
    text: f.text_uk,
    confidence: f.confidence,
  }));

  const allNumbers = useful.flatMap(({ src, evidence }) =>
    evidence.concrete_numbers.map((n) => ({ ...n, source: src.sourceName }))
  );

  const allTopics = [...new Set(useful.flatMap(({ evidence }) => evidence.detected_topics))];

  const sourceDetails: EvidencePackSourceDetail[] = extracted.map(({ src, evidence }) => {
    const ratingStr = src.ratingValue !== null
      ? `${src.ratingValue}/${src.ratingScale ?? 5}`
      : undefined;
    let note: string | null = null;
    if (evidence.extraction_status === "generic_only") {
      note = "Only placeholder text — no actual data. Do NOT use as reputation evidence.";
    } else if (evidence.extraction_status === "not_enough_text") {
      note = "No usable text in this source.";
    } else if (src.sourceType === "vacancy" || src.sourceType === "company_page") {
      note = "Open fact (vacancy/company page) — not independent employer reputation.";
    }
    return {
      source_name: src.sourceName,
      source_type: src.sourceType,
      extraction_status: evidence.extraction_status,
      useful: evidence.useful_for_analysis,
      usefulness_score: evidence.usefulness_score,
      rating: ratingStr,
      reviews_count: src.reviewsCount > 0 ? src.reviewsCount : undefined,
      topics: evidence.detected_topics.slice(0, 5),
      top_negative: evidence.extracted_facts
        .filter((f) => f.polarity === "negative")
        .slice(0, 3)
        .map((f) => f.text_uk),
      top_positive: evidence.extracted_facts
        .filter((f) => f.polarity === "positive")
        .slice(0, 3)
        .map((f) => f.text_uk),
      concrete_numbers: evidence.concrete_numbers.slice(0, 3).map((n) => ({ label: n.label, value: n.value })),
      note,
    };
  });

  const hasReputation = useful.some(({ src }) => isSpecificReputationSource(src));

  let analysisNote: string;
  if (useful.length === 0) {
    analysisNote =
      "ALL external sources are generic placeholders with no actual review or rating data. " +
      "Do NOT use these as reputation evidence. Return risk_level unknown, confidence_level low.";
  } else if (allNegFacts.some((f) => f.severity === "high")) {
    analysisNote = `${useful.length} useful source(s) found with ${allNegFacts.length} negative signal(s) including high-severity concerns.`;
  } else {
    analysisNote = `${useful.length} useful source(s) found. ${generic.length} generic/useless source(s) excluded from reputation evidence.`;
  }

  return {
    has_reputation_evidence: hasReputation,
    useful_sources_count: useful.length,
    generic_sources_count: generic.length,
    total_extracted_facts: allNegFacts.length + allPosFacts.length,
    top_negative_signals: topNegative,
    top_positive_signals: topPositive,
    concrete_numbers: allNumbers.slice(0, 8),
    detected_topics: allTopics.slice(0, 10),
    source_details: sourceDetails,
    analysis_note: analysisNote,
  };
}

function buildSystemPrompt(): string {
  return [
    "You analyze Ukrainian employer and vacancy context for job candidates.",
    "Return valid JSON only. Do not use Markdown.",
    "Never invent reviews, salaries, ratings, reputation, or facts.",
    "If data is insufficient, say insufficient data explicitly.",
    "AI analysis is not a review and does not affect ratings.",
    "Separate: 1) internal reviews, 2) open facts, 3) external ratings, 4) external signals, 5) vacancy text, 6) AI conclusion.",
    "Also consider verified external company sources separately from internal reviews.",
    "Do not classify company risk as low only because no negative data exists.",
    "ABSOLUTE RULE: If there are no internal reviews, no external ratings, no external review signals, and no verified review/rating sources with actual data, return risk_level unknown, risk_score null, confidence_level low.",
    "ABSOLUTE RULE: Generic review pages (source exists but no rating value, no review count, no specific negatives) are NOT reputation evidence.",
    "ABSOLUTE RULE: Work.ua and Robota.ua pages are vacancy/company open facts only — never basis for risk_level low.",
    "ABSOLUTE RULE: Never show confidence_level high unless there are internal reviews, external ratings with values, or multiple specific external review sources.",
    "Vacancy pages and company pages are open facts, not reputation evidence.",
    "Personalize interview questions and candidate_action_plan to the candidate's role context if provided.",
  ].join(" ");
}

function sourceLanguageFromAdminNote(value: string | null | undefined): "uk" | "ru" | "en" | "unknown" {
  const match = String(value ?? "").match(/Original language:\s*(uk|ru|en|unknown)/i);
  return match ? (match[1].toLowerCase() as "uk" | "ru" | "en" | "unknown") : "unknown";
}

function buildUserPrompt(context: AnalyzeEmployerContext): string {
  const evidencePack = buildEvidencePack(context.externalCompanySources);
  const controlledContext = {
    ...context,
    // Replace raw generic source objects with structured evidence pack
    externalCompanySources: undefined,
    external_evidence_pack: evidencePack,
    foundExternalSources: context.foundExternalSources.map((source) => ({
      source_name: source.source_name,
      source_url: source.source_url,
      source_language: source.source_language ?? "unknown",
      source_type: source.signal_type,
      confidence: source.confidence,
      short_summary_uk: source.snippet,
    })),
  };
  return JSON.stringify({
    schema: {
      summary: "string: overall situation in 2-3 sentences for a job candidate",
      risk_level: "low|medium|high|unknown",
      risk_score: "0..100 integer or null when data is insufficient — measures risk only, not employer quality",
      confidence_level: "low|medium|high — low unless there are real internal reviews or verified external ratings with values",
      data_level: "insufficient|partial|enough",
      final_verdict: "string: 1-2 sentences — what this employer looks like for a job candidate specifically",
      bottom_line: "string: 1-2 sentences — what the candidate should do as their next practical step",
      positive_signals: "string[]: concrete positive things found in the data (max 5)",
      risk_signals: "string[]: concrete red flags or concerns (max 6)",
      candidate_action_plan: "string[]: specific actions the candidate should take before/during/after interview (max 6)",
      source_evidence: [
        { source_name: "string", source_type: "reviews|rating|vacancy|company_page", what_found: "string max 80 chars", topics: "string[]", limitation: "string or null" }
      ],
      extracted_facts: [
        { category: "salary|schedule|management|culture|benefits|reviews|growth|other", fact: "string max 80 chars", evidence_strength: "confirmed|partial|inferred" }
      ],
      repeated_topics: "string[]: topics mentioned in multiple sources (max 5)",
      known_facts: "string[]",
      external_findings: "string[]",
      risks: "string[]",
      missing_data: "string[]",
      interview_questions: "string[8-12]: specific, practical questions for this employer/role — not generic",
      recommendations: "string[]",
      source_breakdown: {
        internal_reviews: "number",
        open_facts: "number",
        external_ratings: "number",
        external_signals: "number",
        external_company_sources: "number",
        external_company_sources_total: "number",
        external_review_sources: "number",
        external_rating_sources: "number",
        external_vacancy_sources: "number",
        external_company_page_sources: "number",
        reputation_sources_total: "number",
        specific_reputation_sources_total: "number",
        open_fact_sources_total: "number",
        found_external_sources: "number",
        vacancy_text: "boolean",
      },
      practical_score: "1..10 integer or null — practical overall rating for a candidate (not just risk)",
      disclaimer: "string",
    },
    rules: [
      "Do not copy external reviews as if they are ours.",
      "Do not invent reviews, salaries, ratings, or reputation.",
      "Do not claim official employment, salaries, delays, booking, or reputation unless present in context.",
      "CRITICAL: If data is insufficient, return risk_level unknown, confidence_level low, and risk_score null.",
      "CRITICAL: Do not classify company risk as low only because no negative data exists.",
      "CRITICAL: If there are no internal reviews, no external ratings, no external review signals, and no verified external review/rating sources with actual data, return risk_level unknown, risk_score null, confidence_level low.",
      "CRITICAL: Generic review pages (no rating_value, reviews_count=0, no specific negatives) are NOT reputation evidence — do not use them to lower risk.",
      "Vacancy pages and company pages are open facts, not reputation evidence.",
      "Work.ua and Robota.ua vacancy/company pages are open facts only — never the basis for risk_level low.",
      "Personalize interview_questions and candidate_action_plan to the candidate's role context if provided.",
      "source_evidence must only describe what was actually found — no invented details.",
      "extracted_facts: only include facts with real evidence (confirmed = from verified source, partial = inferred from limited data, inferred = logical but not confirmed).",
    ],
    context: controlledContext,
  });
}

function buildFallbackAnalysis(context: AnalyzeEmployerContext, fallbackReason: string): AiAnalysisResult {
  const text = [
    context.vacancyText,
    context.fetchedText,
    ...context.openFacts.map((fact) => `${fact.vacancyTitle ?? ""} ${fact.salaryText ?? ""} ${fact.employmentType ?? ""} ${fact.schedule ?? ""} ${fact.rawExcerpt ?? ""}`),
    ...context.externalSignals.map((signal) => signal.summary),
  ].join(" ").toLowerCase();
  const highRisks = findLabels(text, HIGH_RISK);
  const mediumRisks = findLabels(text, MEDIUM_RISK);
  const positives = findLabels(text, POSITIVE);
  const bookingWarning = containsAny(text, ["бронювання", "бронь", "відстрочка"]) ? [BOOKING_WARNING] : [];
  const riskScore = Math.max(
    0,
    Math.min(100, highRisks.length * 28 + mediumRisks.length * 8 + context.externalSignals.filter((s) => s.sentiment === "negative").length * 8 - positives.length * 5)
  );
  const level = dataLevel(context);
  const textPresent = hasVacancyText(context);
  const insufficientData = level === "insufficient";
  const openFactsOnlyCompany = isCompanyOpenFactsOnlyContext(context);
  const shouldUseUnknownRisk = insufficientData || openFactsOnlyCompany;
  const risks = unique([...highRisks, ...mediumRisks, ...bookingWarning], 8);
  const missing = unique([
    context.company.name ? null : "Не визначено компанію.",
    context.internalReviews.length === 0 ? "Недостатньо відгуків користувачів Прозора робота." : null,
    context.externalRatings.length === 0 ? "Немає підтверджених зовнішніх оцінок." : null,
    context.externalSignals.length === 0 ? "Немає підтверджених зовнішніх сигналів." : null,
    !/грн|₴|salary|зарплат/i.test(text) ? "Недостатньо даних про зарплату." : null,
    !/офіційне|оформлення|договір|employment/i.test(text) ? "Недостатньо даних про оформлення." : null,
    !/графік|schedule|5\/2|2\/2|позмін/i.test(text) ? "Недостатньо даних про графік." : null,
  ], 8);

  const knownFacts = unique([
    context.company.name ? `Компанія: ${context.company.name}.` : null,
    context.company.industry ? `Сфера: ${context.company.industry}.` : null,
    context.company.city ? `Місто компанії: ${context.company.city}.` : null,
    context.internalReviews.length > 0 ? `Є ${context.internalReviews.length} опублікованих відгуків Прозора робота в контексті.` : null,
    context.openFacts.length > 0 ? `Є ${context.openFacts.length} підтверджених відкритих фактів з вакансій.` : null,
    context.externalRatings.length > 0 ? `Є ${context.externalRatings.length} підтверджених зовнішніх оцінок.` : null,
    context.externalSignals.length > 0 ? `Є ${context.externalSignals.length} підтверджених зовнішніх сигналів.` : null,
    textPresent ? "Є текст вакансії для аналізу." : null,
  ], 8);

  const externalFindings = unique([
    ...context.externalRatings.map((rating) =>
      `${rating.sourceName}: ${rating.ratingValue !== null ? `${rating.ratingValue} / ${rating.ratingScale ?? 5}` : "оцінка не вказана"}.`
    ),
    ...context.externalSignals.map((signal) => `${signal.sourceName}: ${signal.summary}`),
    ...context.foundExternalSources.map((source) => `${source.source_name}: ${source.title}`),
  ], 8);

  const summary =
    openFactsOnlyCompany
      ? "Є відкриті вакансії та сторінка компанії у відкритому джерелі, але немає достатньо відгуків працівників або підтверджених зовнішніх оцінок. Ризик неможливо оцінити повністю."
      : insufficientData
      ? "Недостатньо даних для повної оцінки. Варто перевірити зарплату, оформлення, графік і джерела письмово."
      : riskScore >= 55
        ? "Є суттєві ризикові сигнали у доступних даних. Перед контактом з роботодавцем потрібно перевірити умови письмово."
        : riskScore >= 25
          ? "Є кілька моментів, які потрібно уточнити перед відгуком або співбесідою."
          : "У доступних даних не знайдено критичних формулювань, але ключові умови все одно потрібно підтвердити письмово.";

  const bottomLine =
    shouldUseUnknownRisk
      ? "Перевірте конкретну вакансію і попросіть письмово підтвердити зарплату, графік і оформлення."
      : riskScore >= 55
        ? "Є серйозні застереження. Підтвердьте ключові умови письмово до будь-якого зобов'язання."
        : riskScore >= 25
          ? "Є окремі питання. Уточніть умови на співбесіді та зафіксуйте їх письмово."
          : "Критичних ризиків не виявлено, але умови все одно потрібно підтвердити письмово.";

  const finalVerdict =
    context.company.name
      ? `${context.company.name}: ${summary}`
      : summary;

  const positiveSignals = unique([
    ...positives,
    ...context.externalRatings
      .filter((r) => r.ratingValue !== null && (r.ratingValue / (r.ratingScale ?? 5)) >= 0.7)
      .map((r) => `${r.sourceName}: оцінка ${r.ratingValue}/${r.ratingScale ?? 5}`),
    ...context.externalSignals
      .filter((s) => s.sentiment === "positive")
      .map((s) => s.summary.slice(0, 80)),
  ], 5);

  const riskSignals = unique([
    ...highRisks,
    ...mediumRisks,
    ...bookingWarning,
    ...context.externalSignals
      .filter((s) => s.sentiment === "negative")
      .map((s) => s.summary.slice(0, 80)),
  ], 6);

  const candidateActionPlan = unique([
    "Попросіть письмово підтвердити зарплату, графік і оформлення.",
    containsAny(text, ["бронювання", "бронь", "відстрочка"]) ? "Уточніть умови бронювання і попросіть письмове підтвердження." : null,
    "Не передавайте оригінали документів до підписання договору.",
    "Залиште анонімний відгук після співбесіди або роботи.",
  ], 6);

  const sourceEvidence: SourceEvidence[] = [
    ...context.externalRatings.slice(0, 3).map((r) => ({
      source_name: r.sourceName,
      source_type: "rating",
      what_found: r.ratingValue !== null
        ? `Оцінка роботодавця: ${r.ratingValue}/${r.ratingScale ?? 5}`
        : "Джерело є, але оцінка без числового значення",
      topics: ["оцінка роботодавця"],
      limitation: r.reviewsCount > 0 ? null : "Кількість відгуків не вказана",
    })),
    ...context.externalSignals.slice(0, 3).map((s) => ({
      source_name: s.sourceName,
      source_type: "reviews",
      what_found: s.summary.slice(0, 80),
      topics: [s.topic],
      limitation: null,
    })),
  ].slice(0, 5);

  const extractedFacts: ExtractedFact[] = context.openFacts
    .filter((f) => !isSourceSummaryOpenFact(f) && (f.salaryText ?? f.schedule ?? f.employmentType))
    .slice(0, 5)
    .map((f) => ({
      category: (f.salaryText ? "salary" : f.schedule ? "schedule" : "other") as ExtractedFact["category"],
      fact: [f.salaryText, f.schedule, f.employmentType, f.city].filter(Boolean).join(" · "),
      evidence_strength: "confirmed" as const,
    }));

  return {
    summary,
    risk_level: riskFromScore(riskScore, level, context),
    risk_score: shouldUseUnknownRisk ? null : riskScore,
    confidence_level: confidenceFromContext(context, level),
    data_level: level,
    analysis_mode: "fallback",
    provider: null,
    fallback_reason: fallbackReason,
    known_facts: knownFacts.length ? knownFacts : ["Недостатньо перевірених фактів."],
    external_findings: externalFindings.length ? externalFindings : ["Підтверджених зовнішніх джерел у контексті немає."],
    risks: risks.length
      ? risks
      : shouldUseUnknownRisk
        ? ["Ризик неможливо оцінити через нестачу даних."]
        : ["Критичних ризикових формулювань у доступному контексті не знайдено."],
    missing_data: missing,
    interview_questions: unique([
      "Яка фіксована ставка і як вона фіксується письмово?",
      "Чи є офіційне оформлення з першого дня?",
      "Який точний графік і як оплачуються понаднормові?",
      "Які умови випробувального терміну?",
      "Які бонуси або KPI і як вони розраховуються?",
      containsAny(text, ["бронювання", "бронь", "відстрочка"]) ? "Яка підстава, строк і письмове підтвердження бронювання?" : null,
      context.company.name ? null : "Яка повна юридична назва компанії?",
    ], 10),
    recommendations: unique([
      !hasEmployerExperienceContext(context) ? "Перевірте конкретну вакансію." : null,
      !hasEmployerExperienceContext(context) ? "Попросіть письмово підтвердити зарплату, графік і оформлення." : "Попросіть письмово підтвердити оплату, графік, оформлення і бонуси.",
      !hasEmployerExperienceContext(context) ? "Не робіть висновок лише на основі кількості вакансій." : "Не передавайте документи до підтвердження ключових умов.",
      "Порівнюйте відкриті вакансії з фактичними умовами на співбесіді.",
      !hasEmployerExperienceContext(context) ? "Залиште анонімний відгук після співбесіди або роботи." : "Якщо даних недостатньо, залиште або попросіть анонімний відгук працівників.",
    ], 6),
    source_breakdown: sourceBreakdownFromContext(context),
    disclaimer: DISCLAIMER,
    final_verdict: finalVerdict,
    bottom_line: bottomLine,
    positive_signals: positiveSignals,
    risk_signals: riskSignals,
    candidate_action_plan: candidateActionPlan,
    source_evidence: sourceEvidence,
    extracted_facts: extractedFacts,
    repeated_topics: [],
    practical_score: null,
  };
}

function coerceStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  return unique(value.map((item) => (typeof item === "string" ? item : null)), 10);
}

function coerceResult(value: unknown, fallback: AiAnalysisResult): AiAnalysisResult {
  if (!value || typeof value !== "object") return fallback;
  const record = value as Record<string, unknown>;
  const riskLevel = ["low", "medium", "high", "unknown"].includes(String(record.risk_level))
    ? record.risk_level as RiskLevel
    : fallback.risk_level;
  const confidenceLevel = ["low", "medium", "high"].includes(String(record.confidence_level))
    ? record.confidence_level as AiConfidenceLevel
    : fallback.confidence_level;
  const level = ["insufficient", "partial", "enough"].includes(String(record.data_level))
    ? record.data_level as AiDataLevel
    : fallback.data_level;
  const score = typeof record.risk_score === "number"
    ? Math.max(0, Math.min(100, Math.trunc(record.risk_score)))
    : fallback.risk_score;
  const forceUnknownRisk = fallback.risk_level === "unknown" && fallback.risk_score === null;
  const normalizedRiskLevel = forceUnknownRisk || level === "insufficient" ? "unknown" : riskLevel;
  const normalizedLevel = forceUnknownRisk ? fallback.data_level : level;
  const normalizedConfidence = forceUnknownRisk
    ? fallback.confidence_level
    : level === "insufficient"
      ? "low"
      : confidenceLevel;

  function coerceSourceEvidence(value: unknown, fallback: SourceEvidence[]): SourceEvidence[] {
    if (!Array.isArray(value)) return fallback;
    return value
      .filter((item): item is Record<string, unknown> => item && typeof item === "object")
      .slice(0, 5)
      .map((item) => ({
        source_name: typeof item.source_name === "string" ? item.source_name.slice(0, 80) : "",
        source_type: typeof item.source_type === "string" ? item.source_type : "unknown",
        what_found: typeof item.what_found === "string" ? item.what_found.slice(0, 120) : "",
        topics: Array.isArray(item.topics) ? item.topics.filter((t): t is string => typeof t === "string").slice(0, 5) : [],
        limitation: typeof item.limitation === "string" ? item.limitation.slice(0, 80) : null,
      }))
      .filter((item) => item.source_name && item.what_found);
  }

  function coerceExtractedFacts(value: unknown, fallback: ExtractedFact[]): ExtractedFact[] {
    const VALID_CATEGORIES = new Set(["salary", "schedule", "management", "culture", "benefits", "reviews", "growth", "other"]);
    const VALID_STRENGTH = new Set(["confirmed", "partial", "inferred"]);
    if (!Array.isArray(value)) return fallback;
    return value
      .filter((item): item is Record<string, unknown> => item && typeof item === "object")
      .slice(0, 8)
      .map((item) => ({
        category: (VALID_CATEGORIES.has(String(item.category)) ? item.category : "other") as ExtractedFact["category"],
        fact: typeof item.fact === "string" ? item.fact.slice(0, 120) : "",
        evidence_strength: (VALID_STRENGTH.has(String(item.evidence_strength)) ? item.evidence_strength : "inferred") as ExtractedFact["evidence_strength"],
      }))
      .filter((item) => item.fact);
  }

  const practicalScore = typeof record.practical_score === "number"
    ? Math.max(1, Math.min(10, Math.round(record.practical_score)))
    : null;

  return {
    summary: forceUnknownRisk
      ? fallback.summary
      : typeof record.summary === "string" && record.summary.trim() ? record.summary.trim() : fallback.summary,
    risk_level: normalizedRiskLevel,
    risk_score: normalizedRiskLevel === "unknown" || normalizedLevel === "insufficient" ? null : score,
    confidence_level: normalizedConfidence,
    data_level: normalizedLevel,
    analysis_mode: record.analysis_mode === "ai" ? "ai" : "fallback",
    provider: typeof record.provider === "string" && record.provider.trim() ? record.provider.trim() : null,
    known_facts: coerceStringArray(record.known_facts, fallback.known_facts),
    external_findings: coerceStringArray(record.external_findings, fallback.external_findings),
    risks: coerceStringArray(record.risks, fallback.risks),
    missing_data: coerceStringArray(record.missing_data, fallback.missing_data),
    interview_questions: coerceStringArray(record.interview_questions, fallback.interview_questions),
    recommendations: coerceStringArray(record.recommendations, fallback.recommendations),
    source_breakdown: fallback.source_breakdown,
    disclaimer: DISCLAIMER,
    final_verdict: typeof record.final_verdict === "string" && record.final_verdict.trim()
      ? record.final_verdict.trim().slice(0, 300)
      : fallback.final_verdict,
    bottom_line: typeof record.bottom_line === "string" && record.bottom_line.trim()
      ? record.bottom_line.trim().slice(0, 200)
      : fallback.bottom_line,
    positive_signals: coerceStringArray(record.positive_signals, fallback.positive_signals),
    risk_signals: coerceStringArray(record.risk_signals, fallback.risk_signals),
    candidate_action_plan: coerceStringArray(record.candidate_action_plan, fallback.candidate_action_plan),
    source_evidence: coerceSourceEvidence(record.source_evidence, fallback.source_evidence),
    extracted_facts: coerceExtractedFacts(record.extracted_facts, fallback.extracted_facts),
    repeated_topics: coerceStringArray(record.repeated_topics, fallback.repeated_topics),
    practical_score: forceUnknownRisk ? null : practicalScore,
  };
}

export async function analyzeEmployer(context: AnalyzeEmployerContext): Promise<AiAnalysisResult> {
  const fallbackReasonUnavailable = "provider_unavailable";
  const fallbackReasonFailure = "provider_error_or_invalid_json";
  const fallback = buildFallbackAnalysis(context, fallbackReasonUnavailable);
  const providerName = getEmployerAiProviderName();
  if (!providerName) return applySparseReputationGuard(fallback, fallback.source_breakdown);

  const raw = await runEmployerAiAnalysisPrompt({
    systemPrompt: buildSystemPrompt(),
    userPrompt: buildUserPrompt(context),
    schemaName: "employer_analysis_v1",
  });

  if (!raw || typeof raw !== "object") {
    const failureFallback = buildFallbackAnalysis(context, fallbackReasonFailure);
    return applySparseReputationGuard(failureFallback, failureFallback.source_breakdown);
  }

  const coerced = coerceResult(raw, fallback);
  const normalized = normalizeContextSafety(
    {
      ...coerced,
      analysis_mode: "ai",
      provider: providerName,
    },
    context
  );

  const guarded = applySparseReputationGuard(normalized, normalized.source_breakdown);

  if (guarded.risk_level === "unknown" && guarded.risk_score !== null) {
    return {
      ...guarded,
      risk_score: null,
    };
  }

  return guarded;
}
