import {
  BOOKING_WARNING,
  HIGH_RISK,
  MEDIUM_RISK,
  POSITIVE,
} from "@/lib/vacancy-parser";
import type { ExternalRating, ExternalReviewSignal, RiskLevel } from "@/lib/types";
import type {
  AiAnalysisResult,
  AiConfidenceLevel,
  AiDataLevel,
  ExternalSourceCandidate,
} from "./types";

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
  internalReviews: AiReviewContext[];
  openFacts: AiOpenFactContext[];
  externalRatings: ExternalRating[];
  externalSignals: ExternalReviewSignal[];
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

function buildFallbackAnalysis(context: AnalyzeEmployerContext): AiAnalysisResult {
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

  return {
    summary,
    risk_level: riskFromScore(riskScore, level, context),
    risk_score: shouldUseUnknownRisk ? null : riskScore,
    confidence_level: confidenceFromContext(context, level),
    data_level: level,
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
    ], 8),
    recommendations: unique([
      !hasEmployerExperienceContext(context) ? "Перевірте конкретну вакансію." : null,
      !hasEmployerExperienceContext(context) ? "Попросіть письмово підтвердити зарплату, графік і оформлення." : "Попросіть письмово підтвердити оплату, графік, оформлення і бонуси.",
      !hasEmployerExperienceContext(context) ? "Не робіть висновок лише на основі кількості вакансій." : "Не передавайте документи до підтвердження ключових умов.",
      "Порівнюйте відкриті вакансії з фактичними умовами на співбесіді.",
      !hasEmployerExperienceContext(context) ? "Залиште анонімний відгук після співбесіди або роботи." : "Якщо даних недостатньо, залиште або попросіть анонімний відгук працівників.",
    ], 6),
    source_breakdown: {
      internal_reviews: context.internalReviews.length,
      open_facts: context.openFacts.length,
      external_ratings: context.externalRatings.length,
      external_signals: context.externalSignals.length,
      found_external_sources: context.foundExternalSources.length,
      vacancy_text: textPresent,
    },
    disclaimer: DISCLAIMER,
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

  return {
    summary: forceUnknownRisk
      ? fallback.summary
      : typeof record.summary === "string" && record.summary.trim() ? record.summary.trim() : fallback.summary,
    risk_level: normalizedRiskLevel,
    risk_score: normalizedRiskLevel === "unknown" || normalizedLevel === "insufficient" ? null : score,
    confidence_level: normalizedConfidence,
    data_level: normalizedLevel,
    known_facts: coerceStringArray(record.known_facts, fallback.known_facts),
    external_findings: coerceStringArray(record.external_findings, fallback.external_findings),
    risks: coerceStringArray(record.risks, fallback.risks),
    missing_data: coerceStringArray(record.missing_data, fallback.missing_data),
    interview_questions: coerceStringArray(record.interview_questions, fallback.interview_questions),
    recommendations: coerceStringArray(record.recommendations, fallback.recommendations),
    source_breakdown: fallback.source_breakdown,
    disclaimer: DISCLAIMER,
  };
}

async function callAi(context: AnalyzeEmployerContext, fallback: AiAnalysisResult): Promise<AiAnalysisResult | null> {
  const apiKey = process.env.AI_API_KEY ?? process.env.OPENAI_API_KEY ?? "";
  if (!apiKey) return null;

  const apiUrl = process.env.AI_API_URL ?? (process.env.OPENAI_API_KEY ? "https://api.openai.com/v1/chat/completions" : "");
  if (!apiUrl) return null;

  const model = process.env.AI_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You analyze Ukrainian employer/vacancy context. Return only strict JSON matching the requested schema. Never invent reviews, ratings, salaries, reputation, or facts. If data is missing, say insufficient data. AI analysis is not a review and does not affect ratings.",
          },
          {
            role: "user",
            content: JSON.stringify({
              schema: {
                summary: "string",
                risk_level: "low|medium|high|unknown",
                risk_score: "0..100 integer or null when data is insufficient, risk/completeness only, not employer rating",
                confidence_level: "low|medium|high",
                data_level: "insufficient|partial|enough",
                known_facts: "string[]",
                external_findings: "string[]",
                risks: "string[]",
                missing_data: "string[]",
                interview_questions: "string[]",
                recommendations: "string[]",
                disclaimer: "string",
              },
              rules: [
                "Do not copy external reviews as if they are ours.",
                "Separate internal reviews, open facts, external ratings, external signals, found sources, and vacancy text.",
                "Do not claim official employment, salaries, delays, booking, or reputation unless present in context.",
                "If data is insufficient, return risk_level unknown, confidence_level low, and risk_score null.",
              ],
              context,
            }),
          },
        ],
      }),
    });
    if (!response.ok) return null;
    const payload = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) return null;
    return coerceResult(JSON.parse(content), fallback);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function analyzeEmployer(context: AnalyzeEmployerContext): Promise<AiAnalysisResult> {
  const fallback = buildFallbackAnalysis(context);
  const aiResult = await callAi(context, fallback);
  return aiResult ?? fallback;
}
