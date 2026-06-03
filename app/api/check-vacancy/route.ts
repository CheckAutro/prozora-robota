import { NextRequest, NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase/server";
import { getPublicExternalRatings } from "@/lib/external-ratings-service";
import { slugifyCompanyName } from "@/lib/slugify";
import { fromRow, type ReviewRow } from "@/lib/storage";
import type { Review } from "@/lib/types";

type InputType = "work.ua URL" | "robota.ua URL" | "other URL" | "text" | "company name";
type SourceName = "Work.ua" | "Robota.ua" | "URL" | "Вручну";
type RiskLevel = "low" | "medium" | "high" | "unknown";

interface CompanyRow {
  name: string;
  slug: string;
  city: string | null;
  industry: string | null;
}

interface ParsedVacancy {
  source: SourceName;
  sourceUrl: string | null;
  title: string | null;
  companyName: string | null;
  city: string | null;
  salaryText: string | null;
  descriptionText: string;
}

const HIGH_RISK = [
  { label: "Неофіційне оформлення", terms: ["неофіційно", "без оформлення", "без офіційного оформлення"] },
  { label: "Неоплачуване стажування", terms: ["стажування не оплачується", "неоплачуване стажування"] },
  { label: "Оплата після випробувального", terms: ["оплата після випробувального", "зарплата після випробувального"] },
  { label: "Зарплата тільки відсотками", terms: ["зарплата тільки %", "тільки %", "лише відсоток", "лише %"] },
  { label: "Штрафи", terms: ["штрафи", "система штрафів"] },
  { label: "Матеріальна відповідальність", terms: ["матеріальна відповідальність"] },
  { label: "Без вихідних", terms: ["без вихідних"] },
  { label: "Режим 24/7", terms: ["24/7"] },
  { label: "Понаднормова робота", terms: ["понаднормово", "сверхурочно"] },
  { label: "ФОП для найманої роботи", terms: ["фоп для звичайної найманої роботи", "оформлення фоп", "оформлення як фоп"] },
];

const MEDIUM_RISK = [
  { label: "Високий темп", terms: ["високий темп"] },
  { label: "Стресостійкість як ключова вимога", terms: ["стресостійкість", "стрессоустойчивость"] },
  { label: "Багатозадачність", terms: ["багатозадачність", "многозадачность"] },
  { label: "Ненормований графік", terms: ["ненормований графік", "ненормированный график"] },
  { label: "Плаваючий графік", terms: ["плаваючий графік", "плавающий график"] },
  { label: "Випробувальний термін", terms: ["випробувальний термін", "испытательный срок"] },
  { label: "Бронювання сформульовано не як гарантія", terms: ["можливе бронювання", "бронювання можливе"] },
  { label: "Зарплата до без фіксованої частини", terms: ["зарплата до", "дохід до", "зп до"] },
];

const POSITIVE = [
  { label: "Офіційне працевлаштування", terms: ["офіційне працевлаштування", "офіційне оформлення"] },
  { label: "Оплачуване стажування", terms: ["оплачуване стажування"] },
  { label: "Медичне страхування", terms: ["медичне страхування", "медстрахування"] },
  { label: "Прозорий графік", terms: ["прозорий графік", "чіткий графік"] },
  { label: "Ставка + бонус", terms: ["ставка + бонус", "ставка плюс бонус", "ставка та бонус"] },
  { label: "Бронювання", terms: ["бронювання"] },
  { label: "Оплачуване навчання", terms: ["оплачуване навчання"] },
  { label: "Зарплата вказана явно", terms: ["грн", "₴", "uah"] },
];

const ALIASES: Record<string, string[]> = {
  "nova-poshta": ["нова пошта", "нп", "novaposhta"],
  ukrposhta: ["укрпошта", "укр пошта"],
  privatbank: ["приватбанк", "приват банк", "privatbank", "pryvatbank"],
  "a-bank": ["а-банк", "a-bank", "абанк"],
  atb: ["атб", "атб-маркет", "atb"],
  silpo: ["сільпо", "silpo"],
  rozetka: ["розетка", "rozetka"],
  epam: ["epam", "епам"],
  softserve: ["softserve", "софтсерв"],
  ukrzaliznytsia: ["укрзалізниця", "уз", "ukrzaliznytsia"],
};

function detectInput(input: string): { inputType: InputType; url: URL | null; source: SourceName } {
  try {
    const url = new URL(input.startsWith("www.") ? `https://${input}` : input);
    const host = url.hostname.replace(/^www\./, "");
    if (host === "work.ua" || host.endsWith(".work.ua")) {
      return { inputType: "work.ua URL", url, source: "Work.ua" };
    }
    if (host === "robota.ua" || host.endsWith(".robota.ua")) {
      return { inputType: "robota.ua URL", url, source: "Robota.ua" };
    }
    return { inputType: "other URL", url, source: "URL" };
  } catch {
    return {
      inputType: input.length < 80 && !/[.!?]\s/.test(input) ? "company name" : "text",
      url: null,
      source: "Вручну",
    };
  }
}

function decodeHtml(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCharCode(Number(code)));
}

function cleanText(text: string): string {
  return decodeHtml(text)
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtml(html: string): string {
  return cleanText(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  );
}

function matchTag(html: string, pattern: RegExp): string | null {
  const match = pattern.exec(html);
  return match?.[1] ? cleanText(match[1]) : null;
}

function findJobPosting(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findJobPosting(item);
      if (found) return found;
    }
    return null;
  }

  const record = value as Record<string, unknown>;
  const type = record["@type"];
  if (
    type === "JobPosting" ||
    (Array.isArray(type) && type.some((item) => String(item).toLowerCase() === "jobposting"))
  ) {
    return record;
  }

  for (const nested of Object.values(record)) {
    const found = findJobPosting(nested);
    if (found) return found;
  }
  return null;
}

function firstString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return cleanText(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstString(item);
      if (found) return found;
    }
  }
  return null;
}

function nestedString(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = nestedString(item, key);
      if (found) return found;
    }
    return null;
  }
  const record = value as Record<string, unknown>;
  if (key in record) return firstString(record[key]);
  for (const nested of Object.values(record)) {
    const found = nestedString(nested, key);
    if (found) return found;
  }
  return null;
}

function extractJsonLd(html: string): Partial<ParsedVacancy> {
  const scripts = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const script of scripts) {
    try {
      const parsed = JSON.parse(decodeHtml(script[1]).trim());
      const job = findJobPosting(parsed);
      if (!job) continue;
      return {
        title: firstString(job.title),
        companyName: nestedString(job.hiringOrganization, "name"),
        city: nestedString(job.jobLocation, "addressLocality"),
        salaryText:
          firstString(job.baseSalary) ??
          nestedString(job.baseSalary, "value") ??
          nestedString(job.baseSalary, "minValue"),
        descriptionText: stripHtml(firstString(job.description) ?? ""),
      };
    } catch {
      // Ignore invalid JSON-LD.
    }
  }
  return {};
}

async function fetchHtml(url: URL): Promise<{ html: string | null; fallbackReason: string | null }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(url.toString(), {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "WorkRadar vacancy checker (+https://prozora-robota.vercel.app)",
        accept: "text/html,application/xhtml+xml",
      },
    });

    if (!res.ok) {
      return {
        html: null,
        fallbackReason: "Не вдалося автоматично зчитати вакансію. Вставте текст вакансії вручну.",
      };
    }

    const html = await res.text();
    if (!html.trim()) {
      return {
        html: null,
        fallbackReason: "Не вдалося автоматично зчитати вакансію. Вставте текст вакансії вручну.",
      };
    }

    return { html, fallbackReason: null };
  } catch {
    return {
      html: null,
      fallbackReason: "Не вдалося автоматично зчитати вакансію. Вставте текст вакансії вручну.",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function parseHtmlVacancy(html: string, source: SourceName, sourceUrl: string): ParsedVacancy {
  const jsonLd = extractJsonLd(html);
  const bodyText = stripHtml(html);
  const title =
    jsonLd.title ??
    matchTag(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i) ??
    matchTag(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const metaDescription =
    matchTag(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i) ??
    matchTag(html, /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["'][^>]*>/i);
  const companyMatch = bodyText.match(/(?:Компанія|Компания|Роботодавець|Employer)\s*:?\s+(.{2,80}?)(?:\s{2,}| · | \| |$)/i);
  const cityMatch = bodyText.match(/(?:Місто|Город|Локація|Location)\s*:?\s+(.{2,50}?)(?:\s{2,}| · | \| |$)/i);
  const salaryMatch = bodyText.match(/(?:зарплата|salary|оплата|дохід)[^\n.]{0,120}|(?:\d[\d\s]{2,}\s*(?:грн|₴|uah))[^\n.]{0,80}/i);

  return {
    source,
    sourceUrl,
    title,
    companyName: jsonLd.companyName ?? (companyMatch ? cleanText(companyMatch[1]) : null),
    city: jsonLd.city ?? (cityMatch ? cleanText(cityMatch[1]) : null),
    salaryText: jsonLd.salaryText ?? (salaryMatch ? cleanText(salaryMatch[0]) : null),
    descriptionText: cleanText([jsonLd.descriptionText, metaDescription, bodyText].filter(Boolean).join(" ")).slice(0, 14000),
  };
}

function parseManualVacancy(input: string): ParsedVacancy {
  const text = cleanText(input);
  const salaryMatch = text.match(/(?:зарплата|salary|оплата|дохід)[^.]{0,120}|(?:\d[\d\s]{2,}\s*(?:грн|₴|uah))[^.]{0,80}/i);
  return {
    source: "Вручну",
    sourceUrl: null,
    title: null,
    companyName: null,
    city: null,
    salaryText: salaryMatch ? cleanText(salaryMatch[0]) : null,
    descriptionText: text,
  };
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

function scoreCompany(company: CompanyRow, parsed: ParsedVacancy, rawInput: string): number {
  const exactCompany = parsed.companyName?.trim().toLowerCase() ?? "";
  const companyName = company.name.toLowerCase();
  const haystack = [
    rawInput,
    parsed.title,
    parsed.companyName,
    parsed.descriptionText,
  ].filter(Boolean).join(" ").toLowerCase();
  const slugHaystack = slugifyCompanyName(haystack);
  const aliases = ALIASES[company.slug] ?? [];

  if (exactCompany && exactCompany === companyName) return 1000;
  if (parsed.companyName && slugifyCompanyName(parsed.companyName) === company.slug) return 980;
  if (slugHaystack.includes(company.slug)) return 900;
  if (haystack.includes(companyName)) return 820;
  if (aliases.some((alias) => haystack.includes(alias.toLowerCase()) || slugHaystack.includes(slugifyCompanyName(alias)))) {
    return 780;
  }

  const tokens = companyName
    .split(/[\s\-_/]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
  let matched = 0;
  for (const token of tokens) {
    const slugToken = slugifyCompanyName(token);
    if (haystack.includes(token) || (slugToken && slugHaystack.includes(slugToken))) {
      matched++;
    }
  }

  if (matched >= 2) return 500 + matched * 25;
  if (matched === 1 && tokens.length === 1) return 260;
  return 0;
}

function matchCompany(companies: CompanyRow[], parsed: ParsedVacancy, rawInput: string): CompanyRow | null {
  const scored = companies
    .map((company) => ({ company, score: scoreCompany(company, parsed, rawInput) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.company ?? null;
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
  const factors = [...high, ...medium, ...reviewRiskSignals];
  let riskScore = Math.min(100, high.length * 18 + medium.length * 8 + reviewRiskSignals.length * 6);
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

  const detected = detectInput(input);
  let parsed = parseManualVacancy(input);
  let fallbackReason: string | null = null;
  const warnings: string[] = [];

  if (detected.url && (detected.inputType === "work.ua URL" || detected.inputType === "robota.ua URL")) {
    const { html, fallbackReason: reason } = await fetchHtml(detected.url);
    fallbackReason = reason;
    if (html) {
      parsed = parseHtmlVacancy(html, detected.source, detected.url.toString());
    } else {
      parsed = {
        source: detected.source,
        sourceUrl: detected.url.toString(),
        title: null,
        companyName: null,
        city: null,
        salaryText: null,
        descriptionText: "",
      };
    }
  } else if (detected.url) {
    fallbackReason = "Автоматичне зчитування підтримується тільки для Work.ua та Robota.ua. Вставте текст вакансії вручну.";
    parsed = {
      ...parsed,
      source: "URL",
      sourceUrl: detected.url.toString(),
    };
    warnings.push("Посилання не з Work.ua або Robota.ua, тому сторінку не завантажували.");
  }

  if (fallbackReason) warnings.push(fallbackReason);

  const companies = await loadCompanies();
  const matchInput = detected.url ? "" : input;
  const matchedCompany = matchCompany(companies, parsed, matchInput);
  const internalReviews = matchedCompany
    ? await loadReviewsSummary(matchedCompany.slug)
    : { reviewCount: 0, averageRating: null, riskSignals: [], recentReviews: [] };
  const externalRatings = matchedCompany
    ? await getPublicExternalRatings(matchedCompany.slug)
    : [];
  const risk = analyzeRisk(parsed, internalReviews.riskSignals);

  return NextResponse.json({
    ok: true,
    inputType: detected.inputType,
    parsedVacancy: parsed,
    matchedCompany,
    internalReviews,
    externalRatings,
    risk: {
      ...risk,
      warnings,
    },
    fallbackReason,
  });
}
