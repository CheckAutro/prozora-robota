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

interface FetchHtmlResult {
  html: string | null;
  fallbackReason: string | null;
  status: number | null;
}

interface ParseResult {
  parsed: ParsedVacancy;
  parsedFrom: string;
  rawTitle: string | null;
  rawCompany: string | null;
  rawCity: string | null;
  rawSalary: string | null;
  cleanedSalary: string | null;
  mainTextPreview: string;
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

const MANUAL_TEXT_MESSAGE =
  "Не вдалося автоматично зчитати вакансію. Скопіюйте текст вакансії вручну.";

const HIGH_RISK = [
  { label: "Неофіційне оформлення", terms: ["неофіційно", "без оформлення", "без офіційного оформлення", "оформлення не потрібне"] },
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
  { label: "Зарплата до без фіксованої частини", terms: ["зарплата до", "дохід до", "зп до"] },
];

const POSITIVE = [
  { label: "Офіційне працевлаштування", terms: ["офіційне працевлаштування", "офіційне оформлення"] },
  { label: "Оплачуване стажування", terms: ["оплачуване стажування"] },
  { label: "Медичне страхування", terms: ["медичне страхування", "медстрахування"] },
  { label: "Прозорий графік", terms: ["прозорий графік", "чіткий графік"] },
  { label: "Ставка + бонус", terms: ["ставка + бонус", "ставка плюс бонус", "ставка та бонус"] },
  { label: "Оплачуване навчання", terms: ["оплачуване навчання"] },
  { label: "Зарплата вказана явно", terms: ["грн", "₴", "uah"] },
];

const BOOKING_WARNING =
  "Бронювання потрібно перевіряти документально: підстава, наказ, строк дії та відповідність посади критеріям.";

const ALIASES: Record<string, string[]> = {
  "a-bank": ["а-банк", "а банк", "абанк", "a-bank", "a bank", "abank"],
  "nova-poshta": ["нова пошта", "нова пошта, тов", "нп", "novaposhta", "nova poshta", "nova-poshta"],
  ukrposhta: ["укрпошта", "укр пошта"],
  privatbank: ["приватбанк", "приват банк", "privatbank"],
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
    .replace(/&q;/g, '"')
    .replace(/&a;/g, "&")
    .replace(/&s;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLookupText(text: string): string {
  return cleanText(text)
    .toLowerCase()
    .replace(/[ʼ’`´]/g, "'")
    .replace(/["«»„“”]/g, "")
    .replace(/[.,;:()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripLegalSuffix(text: string): string {
  return normalizeLookupText(text)
    .replace(/\b(тов|тзов|ат|пат|приватне підприємство|пп|фоп|llc|ltd|inc)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isShortCompanyName(value: string): boolean {
  return stripLegalSuffix(value).replace(/[^a-zа-яіїєґ0-9]/gi, "").length <= 4;
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

function getTagAttr(tag: string, attr: string): string | null {
  const pattern = new RegExp(`${attr}=["']([^"']+)["']`, "i");
  const match = pattern.exec(tag);
  return match?.[1] ? cleanText(match[1]) : null;
}

function firstTag(html: string, pattern: RegExp): string | null {
  return pattern.exec(html)?.[0] ?? null;
}

function takeWindowAround(html: string, needle: RegExp, before = 2500, after = 8000): string {
  const match = needle.exec(html);
  if (!match || match.index === undefined) return "";
  return html.slice(Math.max(0, match.index - before), match.index + after);
}

function truncateAtFirst(text: string, markers: string[]): string {
  let result = text;
  for (const marker of markers) {
    const index = result.toLowerCase().indexOf(marker.toLowerCase());
    if (index >= 0) result = result.slice(0, index);
  }
  return result;
}

function removeContextFragment(text: string, fragment: string | null | undefined): string {
  if (!fragment) return text;
  const normalized = cleanText(fragment);
  if (!normalized) return text;
  return text.replace(new RegExp(normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), " ");
}

function cleanSalaryText(
  raw: string | null | undefined,
  context?: { title?: string | null; companyName?: string | null; city?: string | null }
): string | null {
  if (!raw) return null;

  let text = cleanText(raw)
    .replace(/\*/g, "")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return null;

  text = truncateAtFirst(text, ["|", " robota", " work.ua", " work"]);
  text = text.split(/\r?\n/)[0] ?? "";
  text = removeContextFragment(text, context?.title);
  text = removeContextFragment(text, context?.companyName);
  text = removeContextFragment(text, context?.city);
  text = text
    .replace(/\s*,\s*$/g, "")
    .replace(/\s+-\s+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!text || text.length > 80) return null;

  const lower = text.toLowerCase();
  if (/(robota|work\.ua|drobot|recruiting agency)/i.test(text)) return null;
  if (context?.city && lower.includes(context.city.toLowerCase())) return null;
  if (context?.companyName && lower.includes(context.companyName.toLowerCase())) return null;

  const moneyPattern = /^(?:від\s*)?(?:до\s*)?\d[\d\s]*(?:[—–-]\s*\d[\d\s]*)?\s*(?:грн|₴|uah)(?:\s*(?:\/міс\.?|міс\.?|на місяць|net|gross))?$/i;
  const bonusSalaryPattern =
    /^(?:від\s*)?(?:до\s*)?\d[\d\s]*(?:[—–-]\s*\d[\d\s]*)?\s*(?:грн|₴|uah)(?:\s*(?:\/міс\.?|міс\.?|на місяць|net|gross))?\s*\+\s*(?:\d[\d\s]*)?\s*(?:бонус(?:и|ів)?|bonus(?:es)?|премі(?:я|ї))?$/i;
  const interviewPattern = /^за результатами співбесіди$/i;
  const ratePattern = /^ставка\s*\+?\s*(?:кпі|kpi)(?:\/міс\.?)?$/i;
  const compactWords = lower
    .replace(/\d[\d\s]*(?:[—–-]\s*\d[\d\s]*)?\s*(?:грн|₴|uah)/gi, "")
    .replace(/\+\s*(?:\d[\d\s]*)?\s*(?:бонус(?:и|ів)?|bonus(?:es)?|премі(?:я|ї))?/gi, "")
    .split(/\s+/)
    .filter(Boolean);

  if (moneyPattern.test(text) || bonusSalaryPattern.test(text) || interviewPattern.test(text) || ratePattern.test(text)) {
    return text;
  }

  if (/\d/.test(text) && /(грн|₴|uah)/i.test(text) && compactWords.length <= 2) {
    return text;
  }

  return null;
}

function combineRobotaSalary(baseSalary: string | null, salaryComment: string | null): string | null {
  const base = baseSalary ? cleanText(baseSalary).replace(/\*/g, "").trim() : "";
  const comment = salaryComment ? cleanText(salaryComment).replace(/\*/g, "").trim() : "";
  if (!base) return comment || null;
  if (!comment) return base;

  const compactBonusComment = /^\+\s*(?:\d[\d\s]*)?\s*(?:бонус(?:и|ів)?|bonus(?:es)?|премі(?:я|ї))?$/i;
  if (comment.length <= 40 && compactBonusComment.test(comment)) {
    return `${base} ${comment}`.replace(/\s+/g, " ").trim();
  }

  return base;
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

async function fetchHtml(url: URL): Promise<FetchHtmlResult> {
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
        fallbackReason: MANUAL_TEXT_MESSAGE,
        status: res.status,
      };
    }

    const html = await res.text();
    if (!html.trim()) {
      return {
        html: null,
        fallbackReason: MANUAL_TEXT_MESSAGE,
        status: res.status,
      };
    }

    return { html, fallbackReason: null, status: res.status };
  } catch {
    return {
      html: null,
      fallbackReason: MANUAL_TEXT_MESSAGE,
      status: null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function parseMetaVacancy(html: string, source: SourceName, sourceUrl: string): ParseResult {
  const jsonLd = extractJsonLd(html);
  const htmlTitle = matchTag(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const title =
    jsonLd.title ??
    matchTag(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i) ??
    htmlTitle;
  const metaDescription = matchTag(html, /<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']+)["'][^>]*>/i);
  const rawSalary = jsonLd.salaryText ?? null;
  const cleanedSalary = cleanSalaryText(rawSalary, {
    title,
    companyName: jsonLd.companyName ?? null,
    city: jsonLd.city ?? null,
  });
  const parsed = {
    source,
    sourceUrl,
    title,
    companyName: jsonLd.companyName ?? null,
    city: jsonLd.city ?? null,
    salaryText: cleanedSalary,
    descriptionText: cleanText([jsonLd.descriptionText, metaDescription].filter(Boolean).join(" ")).slice(0, 14000),
  };

  return {
    parsed,
    parsedFrom: jsonLd.title ? "json-ld" : "meta",
    rawTitle: title,
    rawCompany: jsonLd.companyName ?? null,
    rawCity: jsonLd.city ?? null,
    rawSalary,
    cleanedSalary,
    mainTextPreview: parsed.descriptionText.slice(0, 500),
  };
}

function parseWorkUaVacancy(html: string, sourceUrl: string): ParseResult {
  const jsonLd = extractJsonLd(html);
  const h1Tag = firstTag(html, /<h1[^>]+id=["']h1-name["'][\s\S]*?<\/h1>/i);
  const mainHtml = h1Tag
    ? takeWindowAround(html, /<h1[^>]+id=["']h1-name["'][\s\S]*?<\/h1>/i, 2500, 8500)
    : "";
  const descriptionHtml = matchTag(html, /<div[^>]+id=["']job-description["'][^>]*>([\s\S]*?)<\/div>/i);
  const meta = parseMetaVacancy(html, "Work.ua", sourceUrl);
  const title = jsonLd.title ?? (h1Tag ? stripHtml(h1Tag) : meta.parsed.title);
  const companyFromStrong = matchTag(
    mainHtml,
    /<span[^>]+class=["'][^"']*strong-500[^"']*["'][^>]*>([\s\S]*?)<\/span>/i
  );
  const companyLogoTag = firstTag(mainHtml, /<img[^>]+(?:alt|title)=["'][^"']+["'][^>]*>/i);
  const companyFromLogo = companyLogoTag
    ? getTagAttr(companyLogoTag, "alt") ?? getTagAttr(companyLogoTag, "title")
    : null;
  const rawCompany = jsonLd.companyName ?? companyFromStrong ?? companyFromLogo;
  const rawCity = jsonLd.city ?? matchTag(
    mainHtml,
    /<span[^>]+class=["'][^"']*glyphicon-map-marker[\s\S]*?<\/span>\s*([\s\S]*?)<\/li>/i
  );
  const rawSalary = jsonLd.salaryText ?? matchTag(
    mainHtml,
    /<span[^>]+class=["'][^"']*glyphicon-hryvnia[\s\S]*?<\/span>[\s\S]*?<span[^>]+class=["'][^"']*text-default-7[^"']*["'][^>]*>([\s\S]*?)<\/span>/i
  );
  const city = rawCity ? stripHtml(rawCity).replace(/\s+/g, " ").trim() : null;
  const companyName = rawCompany ? cleanText(rawCompany) : null;
  const cleanedSalary = cleanSalaryText(rawSalary, { title, companyName, city });
  const descriptionText = cleanText([descriptionHtml ? stripHtml(descriptionHtml) : "", meta.parsed.descriptionText].filter(Boolean).join(" ")).slice(0, 14000);
  const parsed = {
    source: "Work.ua" as const,
    sourceUrl,
    title: title ? cleanText(title) : null,
    companyName,
    city,
    salaryText: cleanedSalary,
    descriptionText,
  };

  return {
    parsed,
    parsedFrom: h1Tag ? "work-main-block" : meta.parsedFrom,
    rawTitle: title,
    rawCompany,
    rawCity,
    rawSalary,
    cleanedSalary,
    mainTextPreview: stripHtml(mainHtml).slice(0, 500),
  };
}

function parseRobotaUaVacancy(html: string, sourceUrl: string): ParseResult {
  const h1Tag = firstTag(html, /<h1[^>]+data-id=["']vacancy-title["'][\s\S]*?<\/h1>/i);
  const mainHtml = h1Tag
    ? takeWindowAround(html, /<h1[^>]+data-id=["']vacancy-title["'][\s\S]*?<\/h1>/i, 2500, 9000)
    : "";
  const meta = parseMetaVacancy(html, "Robota.ua", sourceUrl);
  const title = h1Tag ? stripHtml(h1Tag) : meta.parsed.title;
  const rawSalaryBase = matchTag(
    mainHtml,
    /<span[^>]+data-id=["']vacancy-salary-from-to["'][^>]*>([\s\S]*?)<\/span>/i
  );
  const rawSalaryComment = matchTag(
    mainHtml,
    /<span[^>]+data-id=["']vacancy-salary-comment["'][^>]*>([\s\S]*?)<\/span>/i
  );
  const rawSalary = combineRobotaSalary(rawSalaryBase, rawSalaryComment);
  const logoTag = firstTag(mainHtml, /<img[^>]+(?:alt|title)=["'][^"']+["'][^>]*>/i);
  const companyFromLogo = logoTag
    ? getTagAttr(logoTag, "alt") ?? getTagAttr(logoTag, "title")?.replace(/\s+—\s+robota\.ua$/i, "")
    : null;
  const companyFromLink = matchTag(
    mainHtml,
    /<a[^>]+href=["']\/company\d+["'][^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>\s*<\/a>/i
  );
  const rawCompany = companyFromLogo ?? companyFromLink;
  const rawCity = matchTag(
    mainHtml,
    /<span[^>]+data-id=["']vacancy-city["'][^>]*>([\s\S]*?)<\/span>/i
  );
  const descriptionHtml = matchTag(
    mainHtml,
    /<div[^>]+id=["']description-wrap["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/i
  );
  const city = rawCity ? cleanText(rawCity) : null;
  const companyName = rawCompany
    ? cleanText(rawCompany).replace(/\s+—\s+robota\.ua$/i, "").replace(/^aбанк$/i, "абанк")
    : null;
  const cleanedSalary = cleanSalaryText(rawSalary, { title, companyName, city });
  const descriptionText = cleanText([descriptionHtml ? stripHtml(descriptionHtml) : "", meta.parsed.descriptionText].filter(Boolean).join(" ")).slice(0, 14000);
  const parsed = {
    source: "Robota.ua" as const,
    sourceUrl,
    title: title ? cleanText(title) : null,
    companyName,
    city,
    salaryText: cleanedSalary,
    descriptionText,
  };

  return {
    parsed,
    parsedFrom: h1Tag ? "robota-main-block" : meta.parsedFrom,
    rawTitle: title,
    rawCompany,
    rawCity,
    rawSalary,
    cleanedSalary,
    mainTextPreview: stripHtml(mainHtml).slice(0, 500),
  };
}

function matchManualField(lines: string[], labels: string[]): string | null {
  const labelPattern = labels.join("|");
  const pattern = new RegExp(`^\\s*(?:${labelPattern})\\s*[:：-]\\s*(.+?)\\s*$`, "i");
  for (const line of lines) {
    const match = pattern.exec(line);
    if (match?.[1]) return cleanText(match[1]);
  }
  return null;
}

function extractManualSalary(lines: string[]): string | null {
  const labeledSalary = matchManualField(lines, [
    "Зарплата",
    "Оплата",
    "Дохід",
    "Доход",
    "Salary",
  ]);
  if (labeledSalary) return cleanSalaryText(labeledSalary);

  const moneyPattern =
    /(?:від\s*)?\d[\d\s]*(?:[-–—]\s*\d[\d\s]*)?\s*(?:грн|₴|uah)(?:\s*(?:на місяць|\/міс\.?|міс\.?|net|gross))?/i;
  for (const line of lines) {
    const match = moneyPattern.exec(line);
    if (match?.[0]) return cleanSalaryText(match[0]);
  }
  return null;
}

function parseManualVacancy(input: string): ParsedVacancy {
  const lines = input
    .split(/\r?\n/)
    .map((line) => decodeHtml(line).trim())
    .filter(Boolean);
  const text = cleanText(input);

  return {
    source: "Вручну",
    sourceUrl: null,
    title: matchManualField(lines, [
      "Вакансія",
      "Назва вакансії",
      "Посада",
      "Вакансия",
      "Должность",
    ]),
    companyName: matchManualField(lines, [
      "Компанія",
      "Компания",
      "Роботодавець",
      "Работодатель",
    ]),
    city: matchManualField(lines, [
      "Місто",
      "Город",
      "Локація",
      "Location",
    ]),
    salaryText: extractManualSalary(lines),
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

function companyNamesForMatch(company: CompanyRow): string[] {
  return [
    company.name,
    stripLegalSuffix(company.name),
    company.slug,
    slugifyCompanyName(company.name),
    ...(ALIASES[company.slug] ?? []),
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
  const sourceHost = detected.url?.hostname.replace(/^www\./, "") ?? null;
  let parsed = parseManualVacancy(input);
  let parseResult: ParseResult = {
    parsed,
    parsedFrom: "manual",
    rawTitle: parsed.title,
    rawCompany: parsed.companyName,
    rawCity: parsed.city,
    rawSalary: parsed.salaryText,
    cleanedSalary: parsed.salaryText,
    mainTextPreview: parsed.descriptionText.slice(0, 500),
  };
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
    const { html, fallbackReason: reason, status } = await fetchHtml(detected.url);
    fallbackReason = reason;
    fetchStatus = status;
    if (html) {
      parseResult = detected.inputType === "work.ua URL"
        ? parseWorkUaVacancy(html, detected.url.toString())
        : parseRobotaUaVacancy(html, detected.url.toString());
      parsed = parseResult.parsed;
      if (!parsed.title && !parsed.companyName && !parsed.city && !parsed.salaryText) {
        return manualTextResponse(MANUAL_TEXT_MESSAGE);
      }
    } else {
      parseResult = {
        parsed: {
          source: detected.source,
          sourceUrl: detected.url.toString(),
          title: null,
          companyName: null,
          city: null,
          salaryText: null,
          descriptionText: "",
        },
        parsedFrom: "fetch-failed",
        rawTitle: null,
        rawCompany: null,
        rawCity: null,
        rawSalary: null,
        cleanedSalary: null,
        mainTextPreview: "",
      };
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
      warnings: [...risk.warnings, ...warnings],
    },
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
          },
        }
      : {}),
  });
}
