import type {
  ExternalCompanySourceConfidence,
  ExternalCompanySourceType,
} from "@/lib/types";

export type ExternalSourceLanguage = "uk" | "ru" | "en" | "unknown";

const ALLOWED_HOSTS = [
  "work.ua",
  "robota.ua",
  "dou.ua",
  "djinni.co",
  "indeed.com",
  "glassdoor.com",
];

export function hostFromUrl(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

export function isPrivateHost(host: string): boolean {
  const lower = host.toLowerCase();
  return (
    lower === "localhost" ||
    lower === "127.0.0.1" ||
    lower === "0.0.0.0" ||
    lower === "::1" ||
    lower.startsWith("127.") ||
    lower.startsWith("10.") ||
    /^192\.168\./.test(lower) ||
    /^169\.254\./.test(lower) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(lower) ||
    /^fc[0-9a-f]{2}:/i.test(lower) ||
    /^fd[0-9a-f]{2}:/i.test(lower) ||
    lower.startsWith("fe80:") ||
    lower.includes(":") && /^(::ffff:)?(127\.|10\.|192\.168\.|169\.254\.)/.test(lower) ||
    lower.endsWith(".local")
  );
}

export function isAllowedExternalHost(url: string): boolean {
  const host = hostFromUrl(url);
  if (!host || isPrivateHost(host)) return false;
  return ALLOWED_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

export function normalizeExternalUrl(value: string, keepSearch = false): string | null {
  try {
    const url = new URL(value.trim());
    const host = hostFromUrl(url.toString());
    if (!host || isPrivateHost(host)) return null;
    if (!keepSearch) url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function sourceNameFromUrl(value: string): string {
  const host = hostFromUrl(value);
  if (host.includes("work.ua")) return "Work.ua";
  if (host.includes("robota.ua")) return "Robota.ua";
  if (host.includes("dou.ua")) return "DOU";
  if (host.includes("djinni.co")) return "Djinni";
  if (host.includes("indeed.com")) return "Indeed";
  if (host.includes("glassdoor.com")) return "Glassdoor";
  return host ? host.replace(/^www\./, "") : "Зовнішнє джерело";
}

export function normalizeSourceType(value: unknown): ExternalCompanySourceType {
  const text = String(value ?? "").toLowerCase();
  if (["reviews", "review"].includes(text)) return "reviews";
  if (["rating", "ratings", "score"].includes(text)) return "rating";
  if (["vacancy", "vacancies", "job", "jobs"].includes(text)) return "vacancy";
  if (["company_page", "company", "profile"].includes(text)) return "company_page";
  if (["article", "news", "post"].includes(text)) return "article";
  return "other";
}

export function inferSourceTypeFromContent(
  title: string | null | undefined,
  snippet: string | null | undefined,
  url: string
): ExternalCompanySourceType {
  const text = `${title ?? ""} ${snippet ?? ""} ${url}`.toLowerCase();
  const host = hostFromUrl(url);
  if (host.includes("work.ua")) {
    return /\/jobs\/\d+\/?/.test(text) ? "vacancy" : "company_page";
  }
  if (host.includes("robota.ua")) {
    return /vacancy|ваканс|\/jobs?\//.test(text) ? "vacancy" : "company_page";
  }
  if (/відгук|відгуки|reviews?|отзыв|отзывы/.test(text)) return "reviews";
  if (/рейтинг|оцінк|оценк|rating|score|stars?/.test(text)) return "rating";
  if (/ваканс|job|vacancy|робота/.test(text)) return "vacancy";
  if (/company|компан|роботодав/.test(text)) return "company_page";
  if (/article|news|blog|статт|новин/.test(text)) return "article";
  return "other";
}

export function normalizeConfidence(value: unknown): ExternalCompanySourceConfidence {
  const text = String(value ?? "").toLowerCase();
  if (text === "high" || text === "medium" || text === "low") return text;
  return "medium";
}

export function sanitizeText(value: unknown, limit = 800): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, limit);
}

export function detectSourceLanguage(input: {
  title?: string | null;
  snippet?: string | null;
  sourceUrl?: string | null;
}): ExternalSourceLanguage {
  const text = `${input.title ?? ""} ${input.snippet ?? ""} ${input.sourceUrl ?? ""}`.toLowerCase();
  if (/відгуки|працівник|роботодавець|співбесіда|оформлення|керівництво|зарплата|умови/.test(text)) {
    return "uk";
  }
  if (/отзывы сотрудников|отзывы о работодателе|работодатель|сотрудников|руководство|начальство|соискатель|уволили|жалоба|зарплата|условия|график/.test(text)) {
    return "ru";
  }
  if (/reviews|employees|salary|interview|company reviews|employer|workplace/.test(text)) {
    return "en";
  }
  return "unknown";
}

function includesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function uniqueLimited(items: string[], limit = 6): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const value = sanitizeText(item, 220);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
    if (result.length >= limit) break;
  }
  return result;
}

export function normalizeExternalSourceForPublic(input: {
  title?: string | null;
  snippet?: string | null;
  sourceUrl?: string | null;
  sourceType?: ExternalCompanySourceType | null;
  sourceLanguage?: ExternalSourceLanguage | null;
}): {
  ukrainianTitle: string;
  ukrainianShortSummary: string;
  positivePointsUk: string[];
  negativePointsUk: string[];
  neutralFactsUk: string[];
  sourceLanguage: ExternalSourceLanguage;
} {
  const sourceLanguage = input.sourceLanguage ?? detectSourceLanguage(input);
  const sourceType = input.sourceType ?? inferSourceTypeFromContent(input.title, input.snippet, input.sourceUrl ?? "");
  const text = `${input.title ?? ""} ${input.snippet ?? ""} ${input.sourceUrl ?? ""}`.toLowerCase();
  const neutralFacts: string[] = [];
  const positivePoints: string[] = [];
  const negativePoints: string[] = [];

  if (sourceType === "reviews" || includesAny(text, [/відгук|отзыв|reviews?/])) {
    neutralFacts.push("Є зовнішні відгуки працівників про компанію.");
  }
  if (sourceType === "rating" || includesAny(text, [/рейтинг|оцінк|оценк|rating|stars?/])) {
    neutralFacts.push("У джерелі згадується зовнішня оцінка компанії.");
  }
  if (sourceType === "vacancy" || includesAny(text, [/ваканс|робота|работа|job|vacancy/])) {
    neutralFacts.push("У джерелі згадуються вакансії або робота в компанії.");
  }
  if (includesAny(text, [/зарплат|salary|оплат|виплат/])) {
    neutralFacts.push("У джерелі згадується зарплата або оплата.");
  }
  if (includesAny(text, [/руководство|начальство|керівниц|management|manager/])) {
    neutralFacts.push("У джерелі згадується управління або керівництво.");
  }
  if (includesAny(text, [/условия|умови|график|графік|schedule|workload/])) {
    neutralFacts.push("У джерелі згадуються умови або графік роботи.");
  }
  if (includesAny(text, [/офіцій|оформл|договір|contract|employment/])) {
    positivePoints.push("Є згадка про оформлення або договірні умови.");
  }
  if (includesAny(text, [/бонус|benefit|переваг|соцпакет|команда|positive|добре|хорош/])) {
    positivePoints.push("Є позитивна згадка про умови, команду або переваги.");
  }
  if (includesAny(text, [/жалоб|скарг|негатив|плохо|поган|затрим|штраф|уволили|конфлікт|overload|bad|negative/])) {
    negativePoints.push("Є негативна згадка або скарга.");
  }

  if (neutralFacts.length === 0 && positivePoints.length === 0 && negativePoints.length === 0) {
    neutralFacts.push("Є зовнішнє джерело, яке потребує ручної перевірки модератором.");
  }

  const titleByType: Record<ExternalCompanySourceType, string> = {
    reviews: "Зовнішні відгуки про компанію",
    rating: "Зовнішня оцінка компанії",
    vacancy: "Відкрита вакансія або сторінка роботи",
    company_page: "Сторінка компанії у відкритому джерелі",
    article: "Публікація про компанію",
    other: "Зовнішнє джерело про компанію",
  };
  const ukrainianTitle = titleByType[sourceType] ?? "Зовнішнє джерело про компанію";
  const ukrainianShortSummary = uniqueLimited(
    [...neutralFacts, ...negativePoints, ...positivePoints],
    3
  ).join(" ");

  return {
    ukrainianTitle,
    ukrainianShortSummary: ukrainianShortSummary || "Є зовнішнє джерело про компанію, яке потребує модерації.",
    positivePointsUk: uniqueLimited(positivePoints, 4),
    negativePointsUk: uniqueLimited(negativePoints, 4),
    neutralFactsUk: uniqueLimited(neutralFacts, 5),
    sourceLanguage,
  };
}

export function primaryTextLooksUkrainian(value: string | null | undefined): boolean {
  const text = sanitizeText(value ?? "", 800).toLowerCase();
  if (!text) return false;
  if (/отзывы|сотрудник|работодатель|руководство|начальство|соискатель|уволили|жалоба|условия|график/.test(text)) {
    return false;
  }
  return /відгук|працівник|роботодав|джерел|згаду|компан|оцінк|умови|зарплат|оплат|керівниц|потріб|модерац/.test(text);
}
