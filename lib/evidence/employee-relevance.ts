/**
 * Employee/employer relevance gate.
 *
 * Determines whether a source, snippet, or extracted text is genuinely about
 * employment, working conditions, employer reputation, or similar employer/employee
 * topics — as opposed to customer complaints, product reviews, or consumer content.
 *
 * This is a DETERMINISTIC first-pass filter. It does not call AI.
 * Use it before auto-publishing external sources or running AI enrichment.
 */

export type EmployeeRelevanceCategory =
  | "employee_review"
  | "employer_profile"
  | "vacancy"
  | "interview"
  | "salary"
  | "work_conditions"
  | "customer_complaint"
  | "consumer_review"
  | "product_service_review"
  | "unknown";

export interface EmployeeRelevanceResult {
  isEmployeeRelevant: boolean;
  confidence: "high" | "medium" | "low";
  reason: string;
  matchedSignals: string[];
  rejectedSignals: string[];
  category: EmployeeRelevanceCategory;
}

export interface EmployeeRelevanceInput {
  url?: string | null;
  sourceName?: string | null;
  sourceType?: string | null;
  title?: string | null;
  snippet?: string | null;
  summary?: string | null;
  bullets?: string[];
}

// ── Known domain classifications ──────────────────────────────────────────────

const EMPLOYEE_DOMAINS: ReadonlySet<string> = new Set([
  "dou.ua",
  "djinni.co",
  "indeed.com",
  "glassdoor.com",
  "vnutri.org",
  "pravda-sotrudnikov.com",
  "neorabote.net",
  "orabote.net",
  "depratsiuiesh.com.ua",
  "vidhuk.ua",
]);

// Domains that are primarily consumer/customer complaint portals.
// Sources from these domains are consumer evidence by default unless
// the text explicitly discusses employee/employer topics.
const CONSUMER_DOMAINS: ReadonlySet<string> = new Set([
  "banker.ua",           // bank customer complaints
  "minfin.com.ua",       // financial product/bank reviews
  "finance.ua",          // banking & financial consumer reviews
  "otzovik.com",         // general product reviews
  "irecommend.ru",
  "otzoviu.com",
  "otpusti.com",
  "skazhivsem.ua",
  "otzyvy.com",
  "trustpilot.com",
  "yelp.com",
]);

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

// ── Signal definitions ────────────────────────────────────────────────────────
// Weight 3 = strong / unambiguous phrase
// Weight 2 = moderately specific phrase or strong single word
// Weight 1 = single word that is suggestive but could appear in other contexts

interface Signal {
  text: string;
  weight: number;
}

const EMPLOYEE_SIGNALS: ReadonlyArray<Signal> = [
  // Strong multi-word phrases
  { text: "відгуки працівників", weight: 3 },
  { text: "відгуки сотрудників", weight: 3 },
  { text: "відгуки співробітників", weight: 3 },
  { text: "відгуки про роботодавця", weight: 3 },
  { text: "відгуки роботодавця", weight: 3 },
  { text: "відгуки про роботу в", weight: 3 },
  { text: "отзывы сотрудников", weight: 3 },
  { text: "отзывы работников", weight: 3 },
  { text: "отзывы о работодателе", weight: 3 },
  { text: "employer reviews", weight: 3 },
  { text: "employee reviews", weight: 3 },
  { text: "умови праці", weight: 3 },
  { text: "умови роботи", weight: 3 },
  { text: "робочі умови", weight: 3 },
  { text: "working conditions", weight: 3 },
  { text: "work conditions", weight: 3 },
  { text: "офіційне оформлення", weight: 3 },
  { text: "офіційне працевлаштування", weight: 3 },
  { text: "трудовий договір", weight: 3 },
  { text: "трудова угода", weight: 3 },
  { text: "графік роботи", weight: 2 },
  { text: "затримка зарплати", weight: 3 },
  { text: "зарплату затримують", weight: 3 },
  { text: "не платять зарплату", weight: 3 },
  { text: "задержка зарплаты", weight: 3 },
  { text: "salary delay", weight: 3 },
  { text: "умови випробувального", weight: 2 },
  { text: "бронювання від", weight: 2 },
  { text: "military deferral", weight: 2 },
  // Strong single words
  { text: "роботодавець", weight: 2 },
  { text: "работодатель", weight: 2 },
  { text: "employer", weight: 2 },
  { text: "employee", weight: 2 },
  { text: "workplace", weight: 2 },
  { text: "стажування", weight: 2 },
  { text: "стажировка", weight: 2 },
  { text: "internship", weight: 2 },
  { text: "рекрутинг", weight: 2 },
  { text: "recruitment", weight: 2 },
  { text: "вакансія", weight: 2 },
  { text: "вакансії", weight: 2 },
  { text: "вакансій", weight: 2 },
  { text: "vacancy", weight: 2 },
  { text: "співбесіда", weight: 2 },
  { text: "співбесіди", weight: 2 },
  { text: "собеседование", weight: 2 },
  { text: "interview", weight: 2 },
  // Moderate single words
  { text: "працівник", weight: 1 },
  { text: "працівники", weight: 1 },
  { text: "працівниці", weight: 1 },
  { text: "співробітник", weight: 1 },
  { text: "співробітники", weight: 1 },
  { text: "сотрудник", weight: 1 },
  { text: "сотрудники", weight: 1 },
  { text: "зарплата", weight: 1 },
  { text: "зарплати", weight: 1 },
  { text: "зарплату", weight: 1 },
  { text: "зарплат", weight: 1 },
  { text: "salary", weight: 1 },
  { text: "wages", weight: 1 },
  { text: "кар'єра", weight: 1 },
  { text: "карьера", weight: 1 },
  { text: "career", weight: 1 },
  { text: "керівництво", weight: 1 },
  { text: "руководство", weight: 1 },
  { text: "колектив", weight: 1 },
  { text: "коллектив", weight: 1 },
  { text: "звільнення", weight: 1 },
  { text: "увольнение", weight: 1 },
  { text: "оформлення", weight: 1 },
  { text: "працевлаштування", weight: 1 },
  { text: "трудоустройство", weight: 1 },
  { text: "бронювання", weight: 1 },
  { text: "понаднормові", weight: 1 },
  { text: "overtime", weight: 1 },
  { text: " hr ", weight: 1 },
  { text: "\nhr\n", weight: 1 },
  { text: "hr-", weight: 1 },
];

const CONSUMER_SIGNALS: ReadonlyArray<Signal> = [
  // Strong multi-word consumer phrases
  { text: "відгуки клієнтів", weight: 3 },
  { text: "відгуки покупців", weight: 3 },
  { text: "скарга клієнта", weight: 3 },
  { text: "жалоба клиента", weight: 3 },
  { text: "customer complaint", weight: 3 },
  { text: "consumer complaint", weight: 3 },
  { text: "customer review", weight: 3 },
  { text: "consumer review", weight: 3 },
  { text: "обслуговування клієнтів", weight: 3 },
  { text: "customer service", weight: 3 },
  { text: "повернення товару", weight: 3 },
  { text: "возврат товара", weight: 3 },
  { text: "проблема з карткою", weight: 3 },
  { text: "проблема с картой", weight: 3 },
  { text: "банківські послуги", weight: 3 },
  { text: "banking services", weight: 3 },
  { text: "обслуговування у відділенні", weight: 3 },
  { text: "відділення банку", weight: 2 },
  { text: "bank branch", weight: 2 },
  { text: "банківська картка", weight: 2 },
  { text: "кредитна картка", weight: 2 },
  { text: "credit card", weight: 2 },
  { text: "інтернет-магазин", weight: 2 },
  { text: "интернет-магазин", weight: 2 },
  { text: "online store", weight: 2 },
  { text: "доставка товару", weight: 2 },
  { text: "доставка замовлення", weight: 2 },
  { text: "відгуки про товар", weight: 2 },
  // Moderate single words
  { text: "клієнт", weight: 1 },
  { text: "клиент", weight: 1 },
  { text: "customer", weight: 1 },
  { text: "покупець", weight: 1 },
  { text: "покупатель", weight: 1 },
  { text: "buyer", weight: 1 },
  { text: "споживач", weight: 1 },
  { text: "потребитель", weight: 1 },
  { text: "consumer", weight: 1 },
  { text: "банкомат", weight: 1 },
  { text: "atm", weight: 1 },
  { text: "депозит", weight: 1 },
  { text: "deposit", weight: 1 },
  { text: "гарантія", weight: 1 },
  { text: "warranty", weight: 1 },
  { text: "повернення", weight: 1 },
  { text: "возврат", weight: 1 },
  { text: "замовлення", weight: 1 },
  { text: "заказ", weight: 1 },
];

// ── URL path signals ──────────────────────────────────────────────────────────

const EMPLOYEE_URL_PATTERNS: ReadonlyArray<{ pattern: RegExp; weight: number; label: string }> = [
  { pattern: /\/companies\/[^/]+\/reviews/i, weight: 3, label: "url:company/reviews" },
  { pattern: /\/cmp\/[^/]+\/reviews/i, weight: 3, label: "url:cmp/reviews" },
  { pattern: /\/employer-reviews\//i, weight: 3, label: "url:employer-reviews" },
  { pattern: /\/відгуки-про-роботодавця/i, weight: 3, label: "url:відгуки-роботодавця" },
  { pattern: /\/відгуки-сотрудників|відгуки-працівників/i, weight: 3, label: "url:відгуки-працівників" },
  { pattern: /\/otzyvy-sotrudnikov/i, weight: 3, label: "url:otzyvy-sotrudnikov" },
  { pattern: /\/vidguki-robochogo|vidguki-sotrudnikov/i, weight: 2, label: "url:vidguki-sotrudnikov" },
  { pattern: /\/jobs\/\d+|\/vacancy\/|\/вакансі[яї]/i, weight: 2, label: "url:vacancy" },
  { pattern: /\/reviews\/?$/i, weight: 1, label: "url:reviews-path" },
];

const CONSUMER_URL_PATTERNS: ReadonlyArray<{ pattern: RegExp; weight: number; label: string }> = [
  { pattern: /\/bank\/[^/]+\/vidguki|\/bank\/[^/]+\/review/i, weight: 4, label: "url:bank/vidguki" },
  { pattern: /\/banks\/[^/]+\/review/i, weight: 4, label: "url:banks/review" },
  { pattern: /\/credit\/|\/deposit\/|\/кредит\/|\/депозит\//i, weight: 3, label: "url:credit-deposit" },
  { pattern: /\/product\/[^/]+\/review|\/товар\/[^/]+\/відгук/i, weight: 3, label: "url:product/review" },
  { pattern: /\/shop\/|\/магазин\/|\/store\//i, weight: 1, label: "url:shop" },
];

// ── Score counting ────────────────────────────────────────────────────────────

interface ScoreResult {
  score: number;
  matched: string[];
}

function countSignals(text: string, signals: ReadonlyArray<Signal>): ScoreResult {
  const lower = ` ${text.toLowerCase()} `;
  let score = 0;
  const matched: string[] = [];
  for (const { text: sig, weight } of signals) {
    if (lower.includes(sig.toLowerCase())) {
      score += weight;
      matched.push(sig.trim());
    }
  }
  return { score, matched };
}

function countUrlSignals(
  url: string,
  patterns: ReadonlyArray<{ pattern: RegExp; weight: number; label: string }>
): ScoreResult {
  let score = 0;
  const matched: string[] = [];
  for (const { pattern, weight, label } of patterns) {
    if (pattern.test(url)) {
      score += weight;
      matched.push(label);
    }
  }
  return { score, matched };
}

// ── Category inference ────────────────────────────────────────────────────────

function inferEmployeeCategory(matchedSignals: string[], url: string): EmployeeRelevanceCategory {
  const all = matchedSignals.join(" ").toLowerCase();
  const urlLower = url.toLowerCase();
  if (/вакансі|vacancy/.test(all) || /\/jobs\/|\/vacancy\//i.test(urlLower)) return "vacancy";
  if (/співбесід|собеседован|interview/.test(all)) return "interview";
  if (/зарплат|salary|wages/.test(all)) return "salary";
  if (/умови праці|робочі умови|working condition|work condition/.test(all)) return "work_conditions";
  if (/відгуки.*роботодавц|відгуки.*сотрудн|відгуки.*працівн|employer.*review|employee.*review|отзывы.*сотрудн/.test(all)) return "employee_review";
  if (/роботодавець|работодатель|employer/.test(all)) return "employer_profile";
  return "employee_review";
}

function inferConsumerCategory(matchedSignals: string[], url: string): EmployeeRelevanceCategory {
  const all = matchedSignals.join(" ").toLowerCase();
  if (/скарга клієнта|жалоба клиента|customer complaint|consumer complaint/.test(all)) return "customer_complaint";
  if (/банківськ|bank.*service|banking/.test(all)) return "customer_complaint";
  if (/відгуки клієнтів|відгуки покупців|customer review|consumer review/.test(all)) return "consumer_review";
  if (/товар|product|магазин|store/.test(all)) return "product_service_review";
  if (/url:bank\//.test(all)) return "customer_complaint";
  return "consumer_review";
}

// ── Main gate function ────────────────────────────────────────────────────────

export function checkEmployeeRelevance(input: EmployeeRelevanceInput): EmployeeRelevanceResult {
  const sourceType = (input.sourceType ?? "").toLowerCase();

  // Vacancy and company_page sources are always employer-relevant
  if (sourceType === "vacancy") {
    return {
      isEmployeeRelevant: true,
      confidence: "high",
      reason: "Source type is vacancy — inherently employer content.",
      matchedSignals: ["source_type:vacancy"],
      rejectedSignals: [],
      category: "vacancy",
    };
  }
  if (sourceType === "company_page") {
    return {
      isEmployeeRelevant: true,
      confidence: "high",
      reason: "Source type is company_page — inherently employer content.",
      matchedSignals: ["source_type:company_page"],
      rejectedSignals: [],
      category: "employer_profile",
    };
  }

  const url = input.url ?? "";
  const host = hostFromUrl(url);

  // Combine all text (title weighted heavier via repetition)
  const titleText = `${input.title ?? ""} ${input.title ?? ""}`;
  const bodyText = [
    input.snippet ?? "",
    input.summary ?? "",
    ...(input.bullets ?? []),
  ].join(" ");
  const allText = `${titleText} ${bodyText}`;

  let employeeScore = 0;
  const employeeMatched: string[] = [];
  let consumerScore = 0;
  const consumerMatched: string[] = [];

  // ── Domain check (strong prior) ──
  if (EMPLOYEE_DOMAINS.has(host)) {
    const bonus = 5;
    employeeScore += bonus;
    employeeMatched.push(`domain:${host}`);
  } else if (CONSUMER_DOMAINS.has(host)) {
    const bonus = 5;
    consumerScore += bonus;
    consumerMatched.push(`domain:${host}`);
  }

  // Also check parent domain (e.g. "ua.indeed.com" → "indeed.com")
  const parentHost = host.split(".").slice(-2).join(".");
  if (parentHost !== host) {
    if (EMPLOYEE_DOMAINS.has(parentHost) && !employeeMatched.some((s) => s.startsWith("domain:"))) {
      employeeScore += 5;
      employeeMatched.push(`domain:${parentHost}`);
    } else if (CONSUMER_DOMAINS.has(parentHost) && !consumerMatched.some((s) => s.startsWith("domain:"))) {
      consumerScore += 5;
      consumerMatched.push(`domain:${parentHost}`);
    }
  }

  // ── URL path check ──
  const empUrl = countUrlSignals(url, EMPLOYEE_URL_PATTERNS);
  employeeScore += empUrl.score;
  employeeMatched.push(...empUrl.matched);

  const conUrl = countUrlSignals(url, CONSUMER_URL_PATTERNS);
  consumerScore += conUrl.score;
  consumerMatched.push(...conUrl.matched);

  // ── Text signal check ──
  const empText = countSignals(allText, EMPLOYEE_SIGNALS);
  employeeScore += empText.score;
  employeeMatched.push(...empText.matched);

  const conText = countSignals(allText, CONSUMER_SIGNALS);
  consumerScore += conText.score;
  consumerMatched.push(...conText.matched);

  // Deduplicate
  const uniqueEmployeeSignals = [...new Set(employeeMatched)];
  const uniqueConsumerSignals = [...new Set(consumerMatched)];

  // ── Decision ──
  const ACCEPT_THRESHOLD = 5;
  const REJECT_THRESHOLD = 5;
  const CLEAR_MARGIN = 2; // employee must lead by this much over consumer to accept

  let isEmployeeRelevant: boolean;
  let confidence: "high" | "medium" | "low";
  let reason: string;
  let category: EmployeeRelevanceCategory;

  if (employeeScore >= ACCEPT_THRESHOLD && consumerScore <= 2) {
    isEmployeeRelevant = true;
    confidence = "high";
    reason = `Strong employee signals (score ${employeeScore}) with minimal consumer context (${consumerScore}).`;
    category = inferEmployeeCategory(uniqueEmployeeSignals, url);
  } else if (employeeScore >= 3 && employeeScore >= consumerScore + CLEAR_MARGIN) {
    isEmployeeRelevant = true;
    confidence = "medium";
    reason = `Employee signals (${employeeScore}) outweigh consumer signals (${consumerScore}).`;
    category = inferEmployeeCategory(uniqueEmployeeSignals, url);
  } else if (consumerScore >= REJECT_THRESHOLD && employeeScore <= 2) {
    isEmployeeRelevant = false;
    confidence = "high";
    reason = `Strong consumer signals (score ${consumerScore}) with minimal employee context (${employeeScore}).`;
    category = inferConsumerCategory(uniqueConsumerSignals, url);
  } else if (consumerScore >= 2 && consumerScore >= employeeScore + CLEAR_MARGIN) {
    isEmployeeRelevant = false;
    confidence = "medium";
    reason = `Consumer signals (${consumerScore}) outweigh employee signals (${employeeScore}).`;
    category = inferConsumerCategory(uniqueConsumerSignals, url);
  } else if (employeeScore < 2 && consumerScore < 2) {
    isEmployeeRelevant = false;
    confidence = "low";
    reason = `No clear signals found (employee: ${employeeScore}, consumer: ${consumerScore}). Needs manual review.`;
    category = "unknown";
  } else {
    // Mixed signals — needs review
    isEmployeeRelevant = employeeScore >= consumerScore;
    confidence = "low";
    reason = `Mixed signals (employee: ${employeeScore}, consumer: ${consumerScore}). Manual review recommended.`;
    category = employeeScore >= consumerScore
      ? inferEmployeeCategory(uniqueEmployeeSignals, url)
      : inferConsumerCategory(uniqueConsumerSignals, url);
  }

  return {
    isEmployeeRelevant,
    confidence,
    reason,
    matchedSignals: uniqueEmployeeSignals,
    rejectedSignals: uniqueConsumerSignals,
    category,
  };
}

// ── Log helpers ───────────────────────────────────────────────────────────────

export function logRelevanceResult(
  result: EmployeeRelevanceResult,
  companySlug: string,
  sourceName: string
): void {
  const label = result.isEmployeeRelevant
    ? "ACCEPT"
    : result.confidence === "low"
      ? "REVIEW"
      : "REJECT";
  const signals = result.matchedSignals.slice(0, 4).join(", ");
  const consumer = result.rejectedSignals.slice(0, 3).join(", ");
  const detail = consumer ? `employee:[${signals}] consumer:[${consumer}]` : `signals:[${signals}]`;
  console.log(
    `[employee-relevance] ${label} ${companySlug} ${sourceName} ${result.confidence} ${result.category}: ${result.reason.slice(0, 120)} — ${detail}`
  );
}

// ── Built-in self-check test cases ────────────────────────────────────────────

export interface TestCase {
  description: string;
  input: EmployeeRelevanceInput;
  expectedRelevant: boolean;
  expectedCategory?: EmployeeRelevanceCategory;
}

export const SELF_CHECK_CASES: ReadonlyArray<TestCase> = [
  // ACCEPT
  {
    description: "ACCEPT: employee salary complaint (uk)",
    input: { snippet: "Працівники скаржаться на затримку зарплати та графік роботи" },
    expectedRelevant: true,
    expectedCategory: "salary",
  },
  {
    description: "ACCEPT: employee reviews title (ru)",
    input: { title: "Отзывы сотрудников о работе в компании" },
    expectedRelevant: true,
    expectedCategory: "employee_review",
  },
  {
    description: "ACCEPT: work conditions and interview (uk)",
    input: { snippet: "Співбесіда, зарплата, умови праці у компанії" },
    expectedRelevant: true,
  },
  {
    description: "ACCEPT: vacancy on work.ua (sourceType)",
    input: { snippet: "Вакансії компанії на Work.ua", sourceType: "vacancy" },
    expectedRelevant: true,
    expectedCategory: "vacancy",
  },
  {
    description: "ACCEPT: DOU domain",
    input: { url: "https://jobs.dou.ua/companies/privatbank/reviews", sourceType: "reviews" },
    expectedRelevant: true,
    expectedCategory: "employee_review",
  },
  {
    description: "ACCEPT: Indeed employer reviews URL",
    input: { url: "https://ua.indeed.com/cmp/atb/reviews", sourceType: "reviews" },
    expectedRelevant: true,
    expectedCategory: "employee_review",
  },
  {
    description: "ACCEPT: depratsiuiesh domain (Ukrainian employer reviews)",
    input: { url: "https://www.depratsiuiesh.com.ua/відгуки-атб", sourceType: "reviews" },
    expectedRelevant: true,
    expectedCategory: "employee_review",
  },
  // REJECT
  {
    description: "REJECT: client delivery complaint (uk)",
    input: { snippet: "Клієнт скаржиться на доставку товару та якість обслуговування клієнтів" },
    expectedRelevant: false,
    expectedCategory: "consumer_review",
  },
  {
    description: "REJECT: buyer service complaint (ru)",
    input: { snippet: "Покупатель недоволен сервисом магазина и возвратом товара" },
    expectedRelevant: false,
    expectedCategory: "consumer_review",
  },
  {
    description: "REJECT: bank money not returned (ru)",
    input: { snippet: "Банк не вернул деньги клиенту, жалоба клиента на банковские услуги" },
    expectedRelevant: false,
    expectedCategory: "customer_complaint",
  },
  {
    description: "REJECT: credit card consumer review (uk)",
    input: { snippet: "Відгуки клієнтів про кредитну картку та банківські послуги ПриватБанку" },
    expectedRelevant: false,
    expectedCategory: "customer_complaint",
  },
  {
    description: "REJECT: ATM complaint (uk)",
    input: { snippet: "Скарги на банкомат або мобільний додаток, клієнт не може зняти кошти" },
    expectedRelevant: false,
    expectedCategory: "consumer_review",
  },
  {
    description: "REJECT: banker.ua domain (consumer domain)",
    input: { url: "https://banker.ua/uk/bank/privatbank-ua/vidguki", sourceType: "reviews", snippet: "відгуки про банк" },
    expectedRelevant: false,
    expectedCategory: "customer_complaint",
  },
  {
    description: "REJECT: minfin.com.ua domain (consumer domain)",
    input: { url: "https://minfin.com.ua/ua/banks/privatbank/review", sourceType: "reviews" },
    expectedRelevant: false,
    expectedCategory: "consumer_review",
  },
  {
    description: "REJECT: finance.ua bank reviews URL",
    input: { url: "https://finance.ua/ua/banks/privatbank/review", sourceType: "reviews", snippet: "відгуки клієнтів" },
    expectedRelevant: false,
    expectedCategory: "consumer_review",
  },
];

export function runSelfCheck(): { passed: number; failed: number; results: string[] } {
  let passed = 0;
  let failed = 0;
  const results: string[] = [];

  for (const tc of SELF_CHECK_CASES) {
    const result = checkEmployeeRelevance(tc.input);
    const relevantMatch = result.isEmployeeRelevant === tc.expectedRelevant;
    const categoryMatch = !tc.expectedCategory || result.category === tc.expectedCategory;
    const ok = relevantMatch && categoryMatch;

    if (ok) {
      passed++;
      results.push(`  ✓ ${tc.description}`);
    } else {
      failed++;
      const catNote = !categoryMatch ? ` (category: got ${result.category}, want ${tc.expectedCategory})` : "";
      results.push(
        `  ✗ ${tc.description}${catNote}` +
        `\n    got: relevant=${result.isEmployeeRelevant} conf=${result.confidence} cat=${result.category}` +
        `\n    why: ${result.reason}`
      );
    }
  }

  return { passed, failed, results };
}
