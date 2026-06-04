import { NextRequest, NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase/server";
import { getPublicExternalRatings } from "@/lib/external-ratings-service";
import {
  getPublicExternalReviewSignalSummary,
  type ExternalReviewSignalSummary,
} from "@/lib/external-review-signals-service";
import {
  getPublicCompanyOpenFactsSummary,
  upsertCompanyOpenFactFromVacancy,
} from "@/lib/company-open-facts-service";
import { slugifyCompanyName } from "@/lib/slugify";
import { upsertCompanyDiscoveryQueue } from "@/lib/company-discovery-service";
import {
  BOOKING_WARNING,
  COMPANY_ALIASES,
  HIGH_RISK,
  MANUAL_TEXT_MESSAGE,
  MEDIUM_RISK,
  POSITIVE,
  buildManualParseResult,
  detectVacancyInput,
  extractSalaryNumbers,
  hasAnyTerm,
  hasBookingWording,
  hasBonusFormula,
  hasBonusWording,
  hasClearSchedule,
  hasEmploymentWording,
  hasProbationWording,
  isShortCompanyName,
  normalizeLookupText,
  parseVacancyUrl,
  stripLegalSuffix,
  uniqueItems,
  vacancyText,
  type ParseResult,
  type ParsedVacancy,
} from "@/lib/vacancy-parser";
import { fromRow, type ReviewRow } from "@/lib/storage";
import type { Review, RiskLevel } from "@/lib/types";

interface CompanyRow {
  name: string;
  slug: string;
  city: string | null;
  industry: string | null;
}

interface CompanyMatchCandidate {
  slug: string;
  name: string;
  score: number;
  reason: string;
}

interface CompanyMatchResult {
  company: CompanyRow | null;
  candidates: CompanyMatchCandidate[];
}

type ProStatus = "clear" | "unclear" | "suspicious" | "risky";
type FinalVerdictLevel = "safe_to_apply" | "apply_with_caution" | "avoid";
type BriefTone = "positive" | "warning" | "danger" | "neutral";

interface FreeSummary {
  mainConclusion: string;
  riskLevelText: string;
  topWarnings: string[];
  topPositives: string[];
  missingInfo: string[];
  applyAdvice: string;
}

interface CompanyInsight {
  found: boolean;
  name: string | null;
  slug: string | null;
  industry: string | null;
  city: string | null;
  publishedReviewsCount: number;
  averageInternalRating: number | null;
  hasExternalRatings: boolean;
  summaryText: string;
}

interface ProPreviewSection {
  status: ProStatus;
  summary: string;
  questions: string[];
}

interface ProPreview {
  salary: ProPreviewSection;
  employment: ProPreviewSection;
  schedule: ProPreviewSection;
  booking: {
    mentioned: boolean;
    summary: string;
    questions: string[];
  };
  interviewQuestions: string[];
  documentChecklist: string[];
  finalVerdict: {
    level: FinalVerdictLevel;
    text: string;
  };
}

interface VacancyBriefStatus {
  label: string;
  tone: BriefTone;
  text: string;
}

interface VacancyBrief {
  salaryStatus: VacancyBriefStatus;
  employmentStatus: VacancyBriefStatus;
  scheduleStatus: VacancyBriefStatus;
  riskPhrases: string[];
  questionsToAsk: string[];
  shortVerdict: string;
}

async function loadCompanies(): Promise<CompanyRow[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!url || !key) return [];

  const client = getServerClient();
  const { data, error } = await client
    .from("companies")
    .select("name, slug, city, industry");

  if (error || !data) return [];
  return data as CompanyRow[];
}

function companyNamesForMatch(company: CompanyRow): string[] {
  return [
    company.name,
    stripLegalSuffix(company.name),
    company.slug,
    slugifyCompanyName(company.name),
    ...(COMPANY_ALIASES[company.slug] ?? []),
  ].filter(Boolean);
}

function includesLookupPhrase(haystack: string, phrase: string): boolean {
  const normalizedPhrase = normalizeLookupText(phrase);
  if (!normalizedPhrase) return false;
  const escaped = normalizedPhrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|\\s)${escaped}(\\s|$)`, "i").test(haystack);
}

function scoreCompany(
  company: CompanyRow,
  parsed: ParsedVacancy,
  rawInput: string
): { score: number; reason: string } {
  const names = companyNamesForMatch(company);
  const normalizedNames = names.map(normalizeLookupText).filter(Boolean);
  const strippedNames = names.map(stripLegalSuffix).filter(Boolean);
  const slugNames = names.map(slugifyCompanyName).filter(Boolean);
  const extracted = parsed.companyName ? normalizeLookupText(parsed.companyName) : "";
  const extractedStripped = parsed.companyName ? stripLegalSuffix(parsed.companyName) : "";
  const extractedSlug = parsed.companyName ? slugifyCompanyName(parsed.companyName) : "";

  if (parsed.companyName) {
    if (normalizedNames.includes(extracted) || strippedNames.includes(extractedStripped)) {
      return { score: 1000, reason: "extracted-company-exact" };
    }
    if (extractedSlug && slugNames.includes(extractedSlug)) {
      return { score: 980, reason: "extracted-company-slug" };
    }
    if (
      extractedStripped.length > 4 &&
      strippedNames.some((name) => name.length > 4 && (extractedStripped.includes(name) || name.includes(extractedStripped)))
    ) {
      return { score: 900, reason: "extracted-company-contains" };
    }
    return { score: 0, reason: "extracted-company-mismatch" };
  }

  if (!rawInput.trim()) {
    return { score: 0, reason: "no-company-for-url" };
  }

  const normalizedRaw = normalizeLookupText(rawInput);
  const strippedRaw = stripLegalSuffix(rawInput);
  const rawSlug = slugifyCompanyName(rawInput);
  if (normalizedNames.includes(normalizedRaw) || strippedNames.includes(strippedRaw) || slugNames.includes(rawSlug)) {
    return { score: 850, reason: "manual-exact" };
  }

  const haystack = normalizeLookupText([rawInput, parsed.title].filter(Boolean).join(" "));
  for (const name of names) {
    const normalizedName = normalizeLookupText(name);
    if (!normalizedName) continue;
    if (isShortCompanyName(name)) continue;
    if (includesLookupPhrase(haystack, normalizedName)) {
      return { score: 650, reason: "manual-long-alias" };
    }
  }

  return { score: 0, reason: "no-confident-match" };
}

function matchCompany(companies: CompanyRow[], parsed: ParsedVacancy, rawInput: string): CompanyMatchResult {
  const scored = companies
    .map((company) => {
      const scoredCompany = scoreCompany(company, parsed, rawInput);
      return { company, ...scoredCompany };
    })
    .filter((item) => item.score >= 600)
    .sort((a, b) => b.score - a.score);
  const candidates = scored.slice(0, 5).map((item) => ({
    slug: item.company.slug,
    name: item.company.name,
    score: item.score,
    reason: item.reason,
  }));

  return {
    company: scored[0]?.company ?? null,
    candidates,
  };
}

async function loadReviewsSummary(companySlug: string) {
  const client = getServerClient();
  const { data, count, error } = await client
    .from("reviews")
    .select("*", { count: "exact" })
    .eq("company_slug", companySlug)
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .limit(20);

  if (error || !data) {
    return { reviewCount: 0, averageRating: null, riskSignals: [], recentReviews: [] };
  }

  const reviews: Review[] = data.map((row) => fromRow(row as unknown as ReviewRow));
  const values = reviews.flatMap((review) =>
    Object.values(review.ratings).filter((value): value is number => typeof value === "number" && !Number.isNaN(value))
  );
  const averageRating = values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
  const riskSignals: string[] = [];
  const labels: Record<keyof Review["ratings"], string> = {
    salary: "Є низькі оцінки зарплати у відгуках",
    schedule: "Є низькі оцінки графіку у відгуках",
    management: "Є низькі оцінки керівництва у відгуках",
    conditions: "Є низькі оцінки умов у відгуках",
    honesty: "Є низькі оцінки чесності вакансії у відгуках",
  };

  for (const key of Object.keys(labels) as (keyof Review["ratings"])[]) {
    const fieldValues = reviews
      .map((review) => review.ratings[key])
      .filter((value): value is number => typeof value === "number" && !Number.isNaN(value));
    if (fieldValues.length === 0) continue;
    const avg = fieldValues.reduce((sum, value) => sum + value, 0) / fieldValues.length;
    if (avg <= 2) riskSignals.push(labels[key]);
  }

  return {
    reviewCount: count ?? reviews.length,
    averageRating,
    riskSignals,
    recentReviews: reviews.slice(0, 3).map((review) => ({
      id: review.id,
      roleCategory: review.roleCategory,
      city: review.city,
      year: review.year,
      text: review.text,
    })),
  };
}

function findTerms(text: string, items: { label: string; terms: string[] }[]): string[] {
  const found: string[] = [];
  for (const item of items) {
    if (item.terms.some((term) => text.includes(term.toLowerCase()))) {
      found.push(item.label);
    }
  }
  return [...new Set(found)];
}

function analyzeRisk(parsed: ParsedVacancy, reviewRiskSignals: string[]) {
  const text = parsed.descriptionText.toLowerCase();
  const high = findTerms(text, HIGH_RISK);
  const medium = findTerms(text, MEDIUM_RISK);
  const positives = findTerms(text, POSITIVE);
  const warnings = ["бронювання", "бронь", "відстрочка"].some((term) => text.includes(term))
    ? [BOOKING_WARNING]
    : [];
  const factors = [...high, ...medium, ...reviewRiskSignals];
  let riskScore = Math.min(100, high.length * 30 + medium.length * 8 + reviewRiskSignals.length * 6);
  riskScore = Math.max(0, riskScore - positives.length * 6);

  let riskLevel: RiskLevel = "unknown";
  if (parsed.descriptionText.length >= 40 || factors.length > 0 || positives.length > 0) {
    riskLevel = riskScore >= 55 ? "high" : riskScore >= 25 ? "medium" : "low";
  }

  return {
    riskScore,
    riskLevel,
    factors,
    positives,
    warnings,
    criticalWarnings: high,
  };
}

function buildMissingInfo(parsed: ParsedVacancy, matchedCompany: CompanyRow | null): string[] {
  const text = vacancyText(parsed);
  const missing: string[] = [];

  if (!parsed.salaryText) {
    missing.push("Не вказано зарплату або її фіксовану частину.");
  }
  if (!matchedCompany) {
    missing.push("Компанію не вдалося надійно визначити.");
  }
  if (!hasEmploymentWording(text)) {
    missing.push("Не вказано, чи є офіційне оформлення.");
  }
  if (!hasClearSchedule(text) && !hasAnyTerm(text, ["ненормований графік", "плаваючий графік", "24/7", "без вихідних"])) {
    missing.push("Не вказано чіткий графік.");
  }
  if (!hasProbationWording(text)) {
    missing.push("Не описано умови випробувального терміну.");
  }
  if (hasBonusWording(text) && !hasBonusFormula(text)) {
    missing.push("Не описано формулу бонусів або KPI.");
  }

  return missing;
}

function buildFreeSummary(
  parsed: ParsedVacancy,
  matchedCompany: CompanyRow | null,
  risk: ReturnType<typeof analyzeRisk>
): FreeSummary {
  const riskLevelText: Record<RiskLevel, string> = {
    low: "Низький ризик",
    medium: "Середній ризик",
    high: "Високий ризик",
    unknown: "Недостатньо даних",
  };
  const mainConclusion =
    risk.riskLevel === "high"
      ? "У вакансії є суттєві ризики. Варто уважно перевірити умови перед контактом з роботодавцем."
      : risk.riskLevel === "medium"
        ? "Є кілька моментів, які потрібно уточнити перед відгуком."
        : risk.riskLevel === "unknown"
          ? "Даних недостатньо для повної оцінки. Варто вставити більше тексту вакансії або уточнити умови напряму."
          : "Вакансія виглядає відносно безпечно, але умови варто уточнити на співбесіді.";
  const applyAdvice =
    risk.riskLevel === "high"
      ? "Краще не передавати документи і не погоджуватися на умови без письмового підтвердження."
      : risk.riskLevel === "medium"
        ? "Відгукуватися можна, але спочатку поставити уточнюючі питання."
        : risk.riskLevel === "unknown"
          ? "Спершу зберіть базові умови: оплату, оформлення, графік і юридичну назву компанії."
          : "Можна відгукуватися, але уточнити оплату, оформлення та графік.";
  const topWarnings = uniqueItems([
    ...risk.criticalWarnings,
    ...risk.factors.filter((factor) => !risk.criticalWarnings.includes(factor)),
    ...risk.warnings,
  ]).slice(0, 4);
  const topPositives = uniqueItems(risk.positives).slice(0, 3);

  return {
    mainConclusion,
    riskLevelText: riskLevelText[risk.riskLevel],
    topWarnings: topWarnings.length ? topWarnings : ["Критичних формулювань у тексті не знайдено."],
    topPositives: topPositives.length ? topPositives : ["Позитивні умови в тексті не визначені автоматично."],
    missingInfo: buildMissingInfo(parsed, matchedCompany),
    applyAdvice,
  };
}

function buildCompanyInsight(
  matchedCompany: CompanyRow | null,
  internalReviews: Awaited<ReturnType<typeof loadReviewsSummary>>,
  externalRatingsCount: number
): CompanyInsight {
  if (!matchedCompany) {
    return {
      found: false,
      name: null,
      slug: null,
      industry: null,
      city: null,
      publishedReviewsCount: 0,
      averageInternalRating: null,
      hasExternalRatings: false,
      summaryText: "Компанію не знайдено в базі. Можна залишити перший відгук або вставити більше тексту вакансії для точнішого пошуку.",
    };
  }

  const reviewsText = internalReviews.reviewCount > 0
    ? "На Прозора робота є опубліковані відгуки про цю компанію."
    : "На Прозора робота ще немає опублікованих відгуків про цю компанію.";
  const externalText = externalRatingsCount > 0
    ? "Також є довідкові оцінки з відкритих джерел."
    : "Публічних підтверджених зовнішніх оцінок поки немає.";

  return {
    found: true,
    name: matchedCompany.name,
    slug: matchedCompany.slug,
    industry: matchedCompany.industry,
    city: matchedCompany.city,
    publishedReviewsCount: internalReviews.reviewCount,
    averageInternalRating: internalReviews.averageRating,
    hasExternalRatings: externalRatingsCount > 0,
    summaryText: `${reviewsText} ${externalText}`,
  };
}

function buildSalaryPreview(parsed: ParsedVacancy): ProPreviewSection {
  const text = vacancyText(parsed);
  const salary = parsed.salaryText;
  const questions = ["Яка фіксована ставка?"];

  if (hasBonusWording(text)) {
    questions.push("Як розраховується бонус або KPI?", "Коли і як виплачують бонус?");
  }

  if (!salary) {
    return {
      status: "unclear",
      summary: "Недостатньо даних про зарплату або фіксовану частину.",
      questions: uniqueItems(questions),
    };
  }

  const suspicious = hasAnyTerm(text, ["виплати щодня", "швидкий дохід", "зарплата тільки %", "тільки %", "лише відсоток", "лише %"]);
  const salaryNumbers = extractSalaryNumbers(salary);
  const [minSalary, maxSalary] = salaryNumbers.length >= 2
    ? [Math.min(...salaryNumbers), Math.max(...salaryNumbers)]
    : [null, null];
  const wideRange = Boolean(minSalary && maxSalary && (maxSalary / minSalary >= 1.7 || maxSalary - minSalary >= 30000));
  const summaryParts = [
    hasBonusWording(text)
      ? "Зарплата містить бонусну або KPI-частину, тому потрібно уточнити фіксовану ставку."
      : "Зарплата вказана у компактному форматі.",
    wideRange ? "Діапазон зарплати широкий, потрібно уточнити реальну фіксовану частину." : "",
    suspicious ? "У тексті є формулювання про швидкі або щоденні виплати, це варто перевірити письмово." : "",
  ].filter(Boolean);

  return {
    status: suspicious ? "suspicious" : "clear",
    summary: summaryParts.join(" "),
    questions: uniqueItems(questions),
  };
}

function buildEmploymentPreview(parsed: ParsedVacancy): ProPreviewSection {
  const text = vacancyText(parsed);
  const risky = hasAnyTerm(text, ["оформлення не потрібне", "без оформлення", "без офіційного оформлення", "неофіційно"]);
  const clear = Boolean(parsed.mentionsOfficialEmployment || parsed.employmentType) ||
    hasAnyTerm(text, ["офіційне працевлаштування", "офіційне оформлення", "трудовий договір"]);

  return {
    status: risky ? "risky" : clear ? "clear" : "unclear",
    summary: risky
      ? "У тексті є ризикові формулювання щодо оформлення."
      : clear
        ? `У вакансії згадується оформлення: ${parsed.employmentType ?? "офіційне працевлаштування"}.`
        : "Недостатньо даних про офіційне оформлення.",
    questions: [
      "Чи є офіційне оформлення з першого дня?",
      "Який тип договору?",
      "Чи оплачують випробувальний термін?",
    ],
  };
}

function buildSchedulePreview(parsed: ParsedVacancy): ProPreviewSection {
  const text = vacancyText(parsed);
  const risky = hasAnyTerm(text, ["ненормований графік", "24/7", "без вихідних", "понаднормово", "сверхурочно"]);
  const clear = Boolean(parsed.schedule) || hasClearSchedule(text);

  return {
    status: risky ? "risky" : clear ? "clear" : "unclear",
    summary: risky
      ? "У тексті є ознаки підвищеного навантаження або нечіткого графіку."
      : clear
        ? `Графік або тип зайнятості описаний у тексті${parsed.schedule ? `: ${parsed.schedule}` : ""}.`
        : "Недостатньо даних про графік і навантаження.",
    questions: [
      "Який точний графік?",
      "Як оплачуються понаднормові?",
      "Чи є нічні зміни або робота у вихідні?",
    ],
  };
}

function externalReviewSignalQuestions(
  summary: ExternalReviewSignalSummary | null
): string[] {
  if (!summary || summary.signalCount === 0) return [];

  const topics = new Set(summary.topSignals.map((signal) => signal.topic));
  return uniqueItems([
    topics.has("schedule") || topics.has("workload")
      ? "У відкритих джерелах згадують навантаження. Який фактичний графік і як оплачуються понаднормові?"
      : null,
    topics.has("payment_delay")
      ? "Чи були затримки виплат і як фіксуються умови оплати?"
      : null,
    topics.has("employment")
      ? "Чи є офіційне оформлення з першого дня?"
      : null,
    topics.has("management")
      ? "Як організована комунікація з керівником і хто ухвалює рішення щодо графіку та бонусів?"
      : null,
  ].filter(Boolean) as string[]);
}

function buildProPreview(
  parsed: ParsedVacancy,
  matchedCompany: CompanyRow | null,
  risk: ReturnType<typeof analyzeRisk>,
  externalReviewSignalSummary: ExternalReviewSignalSummary | null
): ProPreview {
  const text = vacancyText(parsed);
  const salary = buildSalaryPreview(parsed);
  const employment = buildEmploymentPreview(parsed);
  const schedule = buildSchedulePreview(parsed);
  const bookingMentioned = hasBookingWording(text);
  const interviewQuestions: string[] = [];

  if (salary.status !== "clear" || hasBonusWording(text)) {
    interviewQuestions.push(...salary.questions);
  }
  if (employment.status !== "clear") {
    interviewQuestions.push(...employment.questions);
  }
  if (schedule.status !== "clear") {
    interviewQuestions.push(...schedule.questions);
  }
  if (!hasProbationWording(text)) {
    interviewQuestions.push("Які умови випробувального терміну і як вони оплачуються?");
  }
  if (bookingMentioned) {
    interviewQuestions.push("Чи дають письмове підтвердження бронювання або відстрочки?");
  }
  if (!matchedCompany) {
    interviewQuestions.push("Чи можете надати повну юридичну назву компанії?");
  }
  interviewQuestions.push(...externalReviewSignalQuestions(externalReviewSignalSummary));
  interviewQuestions.push("Які умови будуть зафіксовані письмово до початку роботи?");

  const documentChecklist = [
    "Трудовий договір або наказ про прийняття",
    "Умови оплати",
    "Графік роботи",
    "Посадова інструкція",
    "Правила бонусів / KPI, якщо є бонуси",
    "Умови випробувального терміну",
    ...(bookingMentioned
      ? [
          "Підстава бронювання",
          "Наказ",
          "Строк дії",
          "Підтвердження відповідності посади критеріям",
        ]
      : []),
  ];
  const missingSalaryOrEmployment = salary.status === "unclear" || employment.status === "unclear" || employment.status === "risky";
  const insufficientDetailedData =
    salary.status === "unclear" &&
    employment.status === "unclear" &&
    schedule.status === "unclear" &&
    risk.factors.length === 0 &&
    risk.criticalWarnings.length === 0;
  let verdictLevel: FinalVerdictLevel = "safe_to_apply";
  if (insufficientDetailedData) {
    verdictLevel = "apply_with_caution";
  } else if (risk.riskLevel === "high" || risk.criticalWarnings.length >= 2) {
    verdictLevel = "avoid";
  } else if (risk.riskLevel === "medium" || risk.riskLevel === "unknown" || (!matchedCompany && missingSalaryOrEmployment)) {
    verdictLevel = "apply_with_caution";
  }

  const bookingSummary = bookingMentioned
    ? "Бронювання потрібно перевіряти документально."
    : insufficientDetailedData
      ? "Недостатньо даних про бронювання або відстрочку."
      : "Бронювання або відстрочка не згадуються у тексті вакансії.";

  return {
    salary,
    employment,
    schedule,
    booking: {
      mentioned: bookingMentioned,
      summary: bookingSummary,
      questions: bookingMentioned
        ? [
            "На якій підставі надається бронювання?",
            "На який строк?",
            "Чи дають письмове підтвердження?",
            "Чи відповідає посада критеріям бронювання?",
          ]
        : ["Чи передбачає посада бронювання або відстрочку, якщо це важливо для вас?"],
    },
    interviewQuestions: uniqueItems(interviewQuestions).slice(0, 8),
    documentChecklist: uniqueItems(documentChecklist),
    finalVerdict: {
      level: verdictLevel,
      text: verdictLevel === "avoid"
        ? "Умови варто перевірити особливо уважно. Не передавайте документи і не погоджуйтеся на роботу без письмового підтвердження ключових умов."
        : insufficientDetailedData
          ? "Недостатньо даних для детального висновку. Нижче — що потрібно уточнити."
        : verdictLevel === "apply_with_caution"
          ? "Відгукуватися можна обережно: спершу уточніть оплату, оформлення, графік і зафіксуйте важливі домовленості письмово."
          : "Можна відгукуватися, але це не гарантія безпеки. Підтвердіть оплату, оформлення і графік письмово до старту.",
    },
  };
}

function briefToneFromProStatus(status: ProStatus): BriefTone {
  if (status === "clear") return "positive";
  if (status === "risky" || status === "suspicious") return "danger";
  return "warning";
}

function buildVacancyBrief(
  parsed: ParsedVacancy,
  risk: ReturnType<typeof analyzeRisk>,
  proPreview: ProPreview,
  matchedCompany: CompanyRow | null,
  externalReviewSignalSummary: ExternalReviewSignalSummary | null
): VacancyBrief {
  const text = vacancyText(parsed);
  const bonusMentioned = hasBonusWording(text);
  const needsSalaryQuestion = !parsed.salaryText || bonusMentioned || proPreview.salary.status !== "clear";
  const riskPhrases = uniqueItems([
    ...risk.criticalWarnings,
    ...risk.factors.filter((factor) => !risk.criticalWarnings.includes(factor)),
    ...risk.warnings,
  ]).slice(0, 3);

  const salaryStatus: VacancyBriefStatus = !parsed.salaryText
    ? {
        label: "Зарплата не визначена",
        tone: "warning",
        text: "Недостатньо даних про суму або фіксовану частину.",
      }
    : bonusMentioned
      ? {
          label: "Є бонусна / KPI частина",
          tone: "warning",
          text: "Потрібно уточнити фіксовану частину, формулу бонусів і строки виплати.",
        }
      : proPreview.salary.status === "suspicious"
        ? {
            label: "Потрібно уточнити фіксовану частину",
            tone: "danger",
            text: proPreview.salary.summary,
          }
      : {
          label: "Зарплата вказана",
          tone: "positive",
          text: parsed.salaryText,
        };

  const employmentStatus: VacancyBriefStatus =
    proPreview.employment.status === "risky"
      ? {
          label: "Є ризик неофіційного оформлення",
          tone: "danger",
          text: proPreview.employment.summary,
        }
      : proPreview.employment.status === "clear"
        ? {
            label: "Офіційне оформлення згадується",
            tone: "positive",
            text: proPreview.employment.summary,
          }
        : {
            label: "Оформлення не вказано",
            tone: "warning",
            text: proPreview.employment.summary,
          };

  const scheduleStatus: VacancyBriefStatus =
    proPreview.schedule.status === "risky"
      ? {
          label: "Є ознаки ненормованого графіку",
          tone: "danger",
          text: proPreview.schedule.summary,
        }
      : proPreview.schedule.status === "clear"
        ? {
            label: "Графік вказаний",
            tone: "positive",
            text: proPreview.schedule.summary,
          }
        : {
            label: "Графік не визначено",
            tone: "warning",
            text: proPreview.schedule.summary,
          };

  const questions = uniqueItems([
    ...(needsSalaryQuestion ? ["Яка фіксована ставка?"] : []),
    ...(bonusMentioned ? ["Як рахуються бонуси / KPI?"] : []),
    "Чи є офіційне оформлення з першого дня?",
    ...(proPreview.schedule.status !== "clear" ? ["Який точний графік?"] : []),
    "Чи оплачуються понаднормові?",
    "Які умови випробувального терміну?",
    ...(proPreview.booking.mentioned
      ? ["Якщо є бронювання: яка підстава, строк і письмове підтвердження?"]
      : []),
    ...(!matchedCompany ? ["Яка повна юридична назва компанії?"] : []),
    ...externalReviewSignalQuestions(externalReviewSignalSummary),
  ]).slice(0, 5);

  const shortVerdict =
    risk.riskLevel === "high"
      ? "Є суттєві ризики. Не передавайте документи і не погоджуйтеся без письмового підтвердження умов."
      : risk.riskLevel === "medium"
        ? "Є моменти, які потрібно уточнити до відгуку або співбесіди."
        : risk.riskLevel === "unknown"
          ? "Даних недостатньо для повної оцінки. Варто вставити більше тексту або уточнити базові умови."
          : "Вакансія виглядає відносно нормально, але ключові умови варто підтвердити письмово.";

  return {
    salaryStatus,
    employmentStatus: {
      ...employmentStatus,
      tone: briefToneFromProStatus(proPreview.employment.status),
    },
    scheduleStatus: {
      ...scheduleStatus,
      tone: briefToneFromProStatus(proPreview.schedule.status),
    },
    riskPhrases: riskPhrases.length ? riskPhrases : ["Критичних формулювань не знайдено."],
    questionsToAsk: questions,
    shortVerdict,
  };
}

export async function POST(req: NextRequest) {
  let body: { input?: unknown };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const input = typeof body.input === "string" ? body.input.trim() : "";
  if (input.length < 2) {
    return NextResponse.json({ error: "input is required" }, { status: 422 });
  }

  const detected = detectVacancyInput(input);
  const sourceHost = detected.url?.hostname.replace(/^www\./, "") ?? null;
  let parseResult: ParseResult = buildManualParseResult(input);
  let parsed = parseResult.parsed;
  let fallbackReason: string | null = null;
  let fetchStatus: number | null = null;
  const warnings: string[] = [];

  function manualTextResponse(message: string, status = 200) {
    const payload = {
      ok: false,
      needsManualText: true,
      inputType: detected.inputType,
      message,
      fallbackReason: message,
      ...(process.env.NODE_ENV === "development"
        ? {
            debug: {
              sourceHost,
              parsedFrom: parseResult.parsedFrom,
              fetchStatus,
              rawTitle: parseResult.rawTitle,
              rawCompany: parseResult.rawCompany,
              rawCity: parseResult.rawCity,
              rawSalary: parseResult.rawSalary,
              cleanedSalary: parseResult.cleanedSalary,
              mainTextPreview: parseResult.mainTextPreview,
              companyMatchCandidates: [],
            },
          }
        : {}),
    };
    return NextResponse.json(payload, { status });
  }

  if (detected.url && (detected.inputType === "work.ua URL" || detected.inputType === "robota.ua URL")) {
    const urlResult = await parseVacancyUrl(detected.url);
    fallbackReason = urlResult.fallbackReason;
    fetchStatus = urlResult.fetchStatus;
    parseResult = urlResult.parseResult;

    if (urlResult.ok) {
      parsed = parseResult.parsed;
      if (!parsed.title && !parsed.companyName && !parsed.city && !parsed.salaryText) {
        return manualTextResponse(MANUAL_TEXT_MESSAGE);
      }
    } else {
      return manualTextResponse(fallbackReason ?? MANUAL_TEXT_MESSAGE);
    }
  } else if (detected.url) {
    fallbackReason = "Автоматичне зчитування підтримується тільки для Work.ua та Robota.ua. Скопіюйте текст вакансії вручну.";
    parseResult = {
      ...parseResult,
      parsed: {
        ...parsed,
        source: "URL",
        sourceUrl: detected.url.toString(),
      },
      parsedFrom: "unsupported-domain",
    };
    return manualTextResponse(fallbackReason);
  }

  if (fallbackReason) warnings.push(fallbackReason);

  const companies = await loadCompanies();
  const matchInput = detected.url ? "" : input;
  const companyMatch = matchCompany(companies, parsed, matchInput);
  const matchedCompany = companyMatch.company;
  let openFactSave:
    | { attempted: false }
    | {
        attempted: true;
        ok: boolean;
        error?: string;
        missingTable?: boolean;
        autoPublished: boolean;
        status: "verified" | "needs_verification";
        isPublic: boolean;
      } = { attempted: false };
  let discoverySave:
    | { attempted: false }
    | { attempted: true; ok: boolean; error?: string; missingTable?: boolean; created?: boolean } = { attempted: false };
  const internalReviews = matchedCompany
    ? await loadReviewsSummary(matchedCompany.slug)
    : { reviewCount: 0, averageRating: null, riskSignals: [], recentReviews: [] };
  const externalRatings = matchedCompany
    ? await getPublicExternalRatings(matchedCompany.slug)
    : [];
  const externalReviewSignals = matchedCompany
    ? await getPublicExternalReviewSignalSummary(matchedCompany.slug)
    : null;
  const companyOpenFacts = matchedCompany
    ? await getPublicCompanyOpenFactsSummary(matchedCompany.slug)
    : null;
  const baseRisk = analyzeRisk(parsed, internalReviews.riskSignals);
  const risk = {
    ...baseRisk,
    warnings: [...baseRisk.warnings, ...warnings],
  };
  const proPreview = buildProPreview(parsed, matchedCompany, risk, externalReviewSignals);
  const analysis = {
    freeSummary: buildFreeSummary(parsed, matchedCompany, risk),
    companyInsight: buildCompanyInsight(matchedCompany, internalReviews, externalRatings.length),
    proPreview,
    vacancyBrief: buildVacancyBrief(parsed, risk, proPreview, matchedCompany, externalReviewSignals),
  };

  const topCompanyCandidate = companyMatch.candidates[0];
  const shouldSaveOpenFact =
    detected.url &&
    (detected.inputType === "work.ua URL" || detected.inputType === "robota.ua URL") &&
    matchedCompany &&
    topCompanyCandidate &&
    topCompanyCandidate.slug === matchedCompany.slug &&
    topCompanyCandidate.score >= 900 &&
    Boolean(parsed.title || parsed.salaryText || parsed.city || parsed.descriptionText);
  const trustedVacancySource =
    parsed.sourceUrl &&
    (parsed.source === "Work.ua" || parsed.source === "Robota.ua") &&
    (detected.inputType === "work.ua URL" || detected.inputType === "robota.ua URL");
  const hasMinimumTrustedFacts = Boolean(
    parsed.title &&
    (parsed.city || parsed.salaryText || parsed.descriptionText || parsed.schedule || parsed.employmentType)
  );
  const shouldAutoPublishOpenFact = Boolean(
    shouldSaveOpenFact &&
    trustedVacancySource &&
    matchedCompany?.slug &&
    matchedCompany?.name &&
    hasMinimumTrustedFacts
  );
  const openFactStatus = shouldAutoPublishOpenFact ? "verified" : "needs_verification";
  const openFactIsPublic = shouldAutoPublishOpenFact;

  const shouldQueueDiscoveredCompany = Boolean(
    detected.url &&
    (detected.inputType === "work.ua URL" || detected.inputType === "robota.ua URL") &&
    !matchedCompany &&
    parsed.companyName &&
    parsed.sourceUrl &&
    (parsed.source === "Work.ua" || parsed.source === "Robota.ua")
  );

  if (shouldQueueDiscoveredCompany && parsed.companyName) {
    const result = await upsertCompanyDiscoveryQueue({
      discovered_name: parsed.companyName,
      suggested_slug: slugifyCompanyName(parsed.companyName),
      source_name: parsed.source,
      source_url: parsed.sourceUrl,
      city: parsed.city,
      industry: null,
      description: parsed.companyDescription,
      matched_existing_slug: null,
      match_confidence: "low",
      status: "needs_review",
      is_imported: false,
      raw_excerpt: parsed.descriptionText.slice(0, 1500),
    });
    discoverySave = result.ok
      ? { attempted: true, ok: true, created: result.created }
      : { attempted: true, ok: false, error: result.error, missingTable: result.missingTable };
    if (!result.ok && process.env.NODE_ENV === "development") {
      console.warn("[check-vacancy] company_discovery_queue save skipped:", result.error);
    }
  }

  if (shouldSaveOpenFact && matchedCompany) {
    const result = await upsertCompanyOpenFactFromVacancy({
      company_slug: matchedCompany.slug,
      company_name: matchedCompany.name,
      source_name: parsed.source,
      source_url: parsed.sourceUrl,
      vacancy_title: parsed.title,
      city: parsed.city,
      salary_text: parsed.salaryText,
      employment_type: parsed.employmentType,
      schedule: parsed.schedule,
      experience: parsed.experience,
      education: parsed.education,
      company_description: parsed.companyDescription,
      vacancy_description: parsed.descriptionText.slice(0, 6000),
      requirements: parsed.requirements,
      responsibilities: parsed.responsibilities,
      conditions: parsed.conditions,
      benefits: parsed.benefits,
      skills: parsed.skills,
      mentions_official_employment: parsed.mentionsOfficialEmployment,
      mentions_booking: parsed.mentionsBooking,
      mentions_probation: parsed.mentionsProbation,
      mentions_bonus: parsed.mentionsBonus,
      raw_excerpt: parsed.descriptionText.slice(0, 2000),
      status: openFactStatus,
      is_public: openFactIsPublic,
    });
    openFactSave = result.ok
      ? {
          attempted: true,
          ok: true,
          autoPublished: shouldAutoPublishOpenFact,
          status: openFactStatus,
          isPublic: openFactIsPublic,
        }
      : {
          attempted: true,
          ok: false,
          error: result.error,
          missingTable: result.missingTable,
          autoPublished: shouldAutoPublishOpenFact,
          status: openFactStatus,
          isPublic: openFactIsPublic,
        };
    if (!result.ok && process.env.NODE_ENV === "development") {
      console.warn("[check-vacancy] company_open_facts save skipped:", result.error);
    }
  }

  return NextResponse.json({
    ok: true,
    inputType: detected.inputType,
    parsedVacancy: parsed,
    matchedCompany,
    internalReviews,
    externalRatings,
    externalReviewSignals,
    companyOpenFacts,
    risk,
    analysis,
    fallbackReason,
    ...(process.env.NODE_ENV === "development"
      ? {
          debug: {
            sourceHost,
            parsedFrom: parseResult.parsedFrom,
            fetchStatus,
            rawTitle: parseResult.rawTitle,
            rawCompany: parseResult.rawCompany,
            rawCity: parseResult.rawCity,
            rawSalary: parseResult.rawSalary,
            cleanedSalary: parseResult.cleanedSalary,
            mainTextPreview: parseResult.mainTextPreview,
            companyMatchCandidates: companyMatch.candidates,
            openFactSave,
            discoverySave,
            companyDiscoverySaved: discoverySave.attempted ? discoverySave.ok : false,
            companyDiscoveryCreated: discoverySave.attempted && discoverySave.ok ? Boolean(discoverySave.created) : false,
            openFactSaved: openFactSave.attempted ? openFactSave.ok : false,
            openFactAutoPublished: openFactSave.attempted ? openFactSave.autoPublished : false,
            openFactStatus: openFactSave.attempted ? openFactSave.status : null,
            openFactIsPublic: openFactSave.attempted ? openFactSave.isPublic : false,
          },
        }
      : {}),
  });
}
