import type {
  ExternalCompanySourceConfidence,
  ExternalCompanySourceType,
} from "@/lib/types";

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
