// Shared vacancy parser for /check-vacancy and bulk discovery scripts.
// Uses only public fetch + static HTML parsing. No browser automation.

export type InputType = "work.ua URL" | "robota.ua URL" | "other URL" | "text" | "company name";
export type SourceName = "Work.ua" | "Robota.ua" | "URL" | "Вручну";

export interface ParsedVacancy {
  source: SourceName;
  sourceUrl: string | null;
  title: string | null;
  companyName: string | null;
  city: string | null;
  salaryText: string | null;
  employmentType: string | null;
  schedule: string | null;
  experience: string | null;
  education: string | null;
  skills: string[];
  benefits: string[];
  requirements: string[];
  responsibilities: string[];
  conditions: string[];
  companyDescription: string | null;
  publishedAt: string | null;
  mentionsOfficialEmployment: boolean;
  mentionsBooking: boolean;
  mentionsProbation: boolean;
  mentionsBonus: boolean;
  descriptionText: string;
}

export interface FetchHtmlResult {
  html: string | null;
  fallbackReason: string | null;
  status: number | null;
}

export interface ParseResult {
  parsed: ParsedVacancy;
  parsedFrom: string;
  rawTitle: string | null;
  rawCompany: string | null;
  rawCity: string | null;
  rawSalary: string | null;
  cleanedSalary: string | null;
  mainTextPreview: string;
}

export const MANUAL_TEXT_MESSAGE =
  "Не вдалося автоматично зчитати вакансію. Скопіюйте текст вакансії вручну.";

export const HIGH_RISK = [
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

export const MEDIUM_RISK = [
  { label: "Високий темп", terms: ["високий темп"] },
  { label: "Стресостійкість як ключова вимога", terms: ["стресостійкість", "стрессоустойчивость"] },
  { label: "Багатозадачність", terms: ["багатозадачність", "многозадачность"] },
  { label: "Ненормований графік", terms: ["ненормований графік", "ненормированный график"] },
  { label: "Плаваючий графік", terms: ["плаваючий графік", "плавающий график"] },
  { label: "Випробувальний термін", terms: ["випробувальний термін", "испытательный срок"] },
  { label: "Зарплата до без фіксованої частини", terms: ["зарплата до", "дохід до", "зп до"] },
];

export const POSITIVE = [
  { label: "Офіційне працевлаштування", terms: ["офіційне працевлаштування", "офіційне оформлення"] },
  { label: "Оплачуване стажування", terms: ["оплачуване стажування"] },
  { label: "Медичне страхування", terms: ["медичне страхування", "медстрахування"] },
  { label: "Прозорий графік", terms: ["прозорий графік", "чіткий графік"] },
  { label: "Ставка + бонус", terms: ["ставка + бонус", "ставка плюс бонус", "ставка та бонус"] },
  { label: "Оплачуване навчання", terms: ["оплачуване навчання"] },
  { label: "Зарплата вказана явно", terms: ["грн", "₴", "uah"] },
];

export const BOOKING_WARNING =
  "Бронювання потрібно перевіряти документально: підстава, наказ, строк дії та відповідність посади критеріям.";

export function detectVacancyInput(input: string): { inputType: InputType; url: URL | null; source: SourceName } {
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

export function normalizeLookupText(text: string): string {
  return cleanText(text)
    .toLowerCase()
    .replace(/[ʼ’`´]/g, "'")
    .replace(/["«»„“”]/g, "")
    .replace(/[.,;:()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function stripLegalSuffix(text: string): string {
  return normalizeLookupText(text)
    .replace(/\b(тов|тзов|ат|пат|приватне підприємство|пп|фоп|llc|ltd|inc)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isShortCompanyName(value: string): boolean {
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

export async function fetchVacancyHtml(url: URL): Promise<FetchHtmlResult> {
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
  const structured = extractStructuredVacancyFacts(
    cleanText([jsonLd.descriptionText, metaDescription].filter(Boolean).join(" "))
  );
  const parsed = {
    source,
    sourceUrl,
    title,
    companyName: jsonLd.companyName ?? null,
    city: jsonLd.city ?? null,
    salaryText: cleanedSalary,
    ...structured,
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

function normalizeListItem(value: string): string | null {
  const text = cleanText(value)
    .replace(/^[-–—•*\d.)\s]+/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text || text.length < 3 || text.length > 180) return null;
  return text;
}

function uniqueShortList(items: Array<string | null | undefined>, limit = 5): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const normalized = item ? normalizeListItem(item) : null;
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

function extractSegment(text: string, headings: string[], stopHeadings: string[]): string {
  const lower = text.toLowerCase();
  let start = -1;
  let matchedHeading = "";
  for (const heading of headings) {
    const index = lower.indexOf(heading.toLowerCase());
    if (index >= 0 && (start === -1 || index < start)) {
      start = index;
      matchedHeading = heading;
    }
  }
  if (start < 0) return "";

  const contentStart = start + matchedHeading.length;
  let end = text.length;
  for (const heading of stopHeadings) {
    const index = lower.indexOf(heading.toLowerCase(), contentStart + 10);
    if (index >= 0 && index < end) end = index;
  }
  return text.slice(contentStart, end).replace(/^[:\s-]+/, "").trim();
}

function splitFactSegment(segment: string, limit = 5): string[] {
  if (!segment) return [];
  return uniqueShortList(
    segment
      .split(/(?:\s+[;•]\s+|\s+-\s+|(?<=[.!?])\s+(?=[А-ЯA-ZІЇЄҐ]))/u)
      .map((item) => item.trim()),
    limit
  );
}

function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1]) return cleanText(match[1]).slice(0, 120);
    if (match?.[0]) return cleanText(match[0]).slice(0, 120);
  }
  return null;
}

function extractScheduleText(text: string): string | null {
  return firstMatch(text, [
    /графік(?: роботи)?\s*[:：-]\s*([^.;\n]{3,120})/i,
    /(?:графік|режим)\s+(?:роботи\s+)?(?:\d{1,2}[:.]\d{2}\s*[—–-]\s*\d{1,2}[:.]\d{2}|[0-9]\s*\/\s*[0-9])[^.;\n]*/i,
    /(?:повна|часткова)\s+зайнятість/i,
    /(?:позмінний|позмінно|змінний)\s+графік/i,
    /\b[1-6]\s*\/\s*[1-6]\b/i,
  ]);
}

function extractEmploymentType(text: string): string | null {
  if (hasAnyTerm(text.toLowerCase(), ["офіційне працевлаштування", "офіційне оформлення"])) {
    return "Офіційне працевлаштування";
  }
  if (hasAnyTerm(text.toLowerCase(), ["без оформлення", "неофіційно", "оформлення не потрібне"])) {
    return "Неофіційне оформлення згадується";
  }
  return firstMatch(text, [
    /тип\s+договору\s*[:：-]\s*([^.;\n]{3,120})/i,
    /трудовий\s+договір/i,
    /оформлення\s+фоп/i,
  ]);
}

function extractExperience(text: string): string | null {
  return firstMatch(text, [
    /досвід\s+роботи\s*[:：-]?\s*([^.;\n]{3,100})/i,
    /без\s+досвіду/i,
    /досвід\s+від\s+\d+\s+(?:року|років|лет)/i,
  ]);
}

function extractEducation(text: string): string | null {
  return firstMatch(text, [
    /освіта\s*[:：-]?\s*([^.;\n]{3,100})/i,
    /вища\s+освіта/i,
    /середня\s+спеціальна\s+освіта/i,
  ]);
}

function extractCompanyDescription(text: string): string | null {
  const segment = extractSegment(text, ["ми —", "ми -", "про компанію", "компанія"], [
    "вимоги",
    "обов’язки",
    "обов'язки",
    "ми пропонуємо",
    "умови",
    "що ти отримаєш",
  ]);
  const cleaned = cleanText(segment).slice(0, 700);
  return cleaned.length >= 40 ? cleaned : null;
}

function extractStructuredVacancyFacts(text: string): Omit<
  ParsedVacancy,
  "source" | "sourceUrl" | "title" | "companyName" | "city" | "salaryText" | "descriptionText"
> {
  const clean = cleanText(text).slice(0, 14000);
  const lower = clean.toLowerCase();
  const stopHeadings = [
    "вимоги",
    "обов’язки",
    "обов'язки",
    "ми пропонуємо",
    "умови",
    "що ти отримаєш",
    "чому саме ми",
    "надсилай",
    "про компанію",
  ];
  const requirements = splitFactSegment(extractSegment(clean, ["вимоги", "що важливо для цієї ролі"], stopHeadings));
  const responsibilities = splitFactSegment(extractSegment(clean, ["обов’язки", "обов'язки", "твої основні обов’язки"], stopHeadings));
  const conditions = splitFactSegment(extractSegment(clean, ["ми пропонуємо", "умови роботи", "що ти отримаєш"], stopHeadings));
  const benefits = uniqueShortList([
    ...splitFactSegment(extractSegment(clean, ["переваги", "бенефіти", "benefits"], stopHeadings)),
    ...(hasAnyTerm(lower, ["медичне страхування", "медстрахування"]) ? ["Медичне страхування"] : []),
    ...(hasAnyTerm(lower, ["оплачувані відпустки", "оплачувана відпустка"]) ? ["Оплачувана відпустка"] : []),
    ...(hasAnyTerm(lower, ["кар'єрного зростання", "карʼєрного зростання", "карьерного роста"]) ? ["Можливість кар'єрного зростання"] : []),
  ]);
  const skills = uniqueShortList(
    [...clean.matchAll(/\b(?:MS Excel|Excel|CRM|Tableau|PowerPoint|Word|SQL|JavaScript|TypeScript|React|Node\.js|English|англійська)\b/gi)]
      .map((match) => match[0]),
    6
  );

  return {
    employmentType: extractEmploymentType(clean),
    schedule: extractScheduleText(clean),
    experience: extractExperience(clean),
    education: extractEducation(clean),
    skills,
    benefits,
    requirements,
    responsibilities,
    conditions,
    companyDescription: extractCompanyDescription(clean),
    publishedAt: firstMatch(clean, [
      /вакансія\s+від\s+([^.;\n]{3,80})/i,
      /(\d{1,2}\s+[а-яіїєґ]+\s+20\d{2})/i,
    ]),
    mentionsOfficialEmployment: hasAnyTerm(lower, ["офіційне працевлаштування", "офіційне оформлення", "трудовий договір"]),
    mentionsBooking: hasBookingWording(lower),
    mentionsProbation: hasProbationWording(lower),
    mentionsBonus: hasBonusWording(lower),
  };
}

export function parseWorkUaVacancy(html: string, sourceUrl: string): ParseResult {
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
  const structured = extractStructuredVacancyFacts(cleanText([stripHtml(mainHtml), descriptionText].filter(Boolean).join(" ")));
  const parsed = {
    source: "Work.ua" as const,
    sourceUrl,
    title: title ? cleanText(title) : null,
    companyName,
    city,
    salaryText: cleanedSalary,
    ...structured,
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

export function parseRobotaUaVacancy(html: string, sourceUrl: string): ParseResult {
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
  const structured = extractStructuredVacancyFacts(cleanText([stripHtml(mainHtml), descriptionText].filter(Boolean).join(" ")));
  const parsed = {
    source: "Robota.ua" as const,
    sourceUrl,
    title: title ? cleanText(title) : null,
    companyName,
    city,
    salaryText: cleanedSalary,
    ...structured,
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

export function parseManualVacancyText(input: string): ParsedVacancy {
  const lines = input
    .split(/\r?\n/)
    .map((line) => decodeHtml(line).trim())
    .filter(Boolean);
  const text = cleanText(input);
  const structured = extractStructuredVacancyFacts(text);

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
    ...structured,
    descriptionText: text,
  };
}


export function uniqueItems(items: string[]): string[] {
  return [...new Set(items.filter((item) => item.trim()))];
}

export function vacancyText(parsed: ParsedVacancy): string {
  return [
    parsed.title,
    parsed.companyName,
    parsed.city,
    parsed.salaryText,
    parsed.employmentType,
    parsed.schedule,
    parsed.experience,
    parsed.education,
    parsed.companyDescription,
    parsed.conditions.join(" "),
    parsed.benefits.join(" "),
    parsed.requirements.join(" "),
    parsed.responsibilities.join(" "),
    parsed.skills.join(" "),
    parsed.descriptionText,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function hasAnyTerm(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term.toLowerCase()));
}

export function hasClearSchedule(text: string): boolean {
  return /(?:^|[^\d])\d\s*\/\s*\d(?:$|[^\d])/.test(text) ||
    hasAnyTerm(text, ["чіткий графік", "прозорий графік", "позмінний", "позмінно", "повна зайнятість", "часткова зайнятість"]);
}

export function hasEmploymentWording(text: string): boolean {
  return hasAnyTerm(text, [
    "офіційне працевлаштування",
    "офіційне оформлення",
    "трудовий договір",
    "без оформлення",
    "неофіційно",
    "оформлення не потрібне",
    "оформлення фоп",
  ]);
}

export function hasProbationWording(text: string): boolean {
  return hasAnyTerm(text, ["випробувальний", "испытательный", "стажування", "стажировка"]);
}

export function hasBonusWording(text: string): boolean {
  return /(?:бонус|kpi|кпі|кпi|премі|преми|ставка\s*\+)/i.test(text);
}

export function hasBonusFormula(text: string): boolean {
  return /(?:формул|розрахову|розрахунок|відсот|процент|умов[аи]? бонус|правил[аи]? бонус|kpi\s*:|кпі\s*:)/i.test(text);
}

export function hasBookingWording(text: string): boolean {
  return hasAnyTerm(text, ["бронювання", "бронь", "відстрочка"]);
}

export function extractSalaryNumbers(salaryText: string | null): number[] {
  if (!salaryText) return [];
  return [...salaryText.matchAll(/\d[\d\s]*/g)]
    .map((match) => Number(match[0].replace(/\s/g, "")))
    .filter((value) => Number.isFinite(value) && value > 0);
}


export const TRUSTED_VACANCY_SOURCES = new Set<SourceName>(["Work.ua", "Robota.ua"]);

export const COMPANY_ALIASES: Record<string, string[]> = {
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

export function emptyStructuredVacancyFacts(): Omit<ParsedVacancy, "source" | "sourceUrl" | "title" | "companyName" | "city" | "salaryText" | "descriptionText"> {
  return extractStructuredVacancyFacts("");
}

export function buildManualParseResult(input: string): ParseResult {
  const parsed = parseManualVacancyText(input);
  return {
    parsed,
    parsedFrom: "manual",
    rawTitle: parsed.title,
    rawCompany: parsed.companyName,
    rawCity: parsed.city,
    rawSalary: parsed.salaryText,
    cleanedSalary: parsed.salaryText,
    mainTextPreview: parsed.descriptionText.slice(0, 500),
  };
}

export async function parseVacancyUrl(urlInput: URL | string): Promise<{
  ok: boolean;
  parseResult: ParseResult;
  fallbackReason: string | null;
  fetchStatus: number | null;
}> {
  const url = typeof urlInput === "string" ? new URL(urlInput) : urlInput;
  const detected = detectVacancyInput(url.toString());
  const sourceUrl = url.toString();
  const failedResult = (parsedFrom: string): ParseResult => ({
    parsed: {
      source: detected.source,
      sourceUrl,
      title: null,
      companyName: null,
      city: null,
      salaryText: null,
      ...emptyStructuredVacancyFacts(),
      descriptionText: "",
    },
    parsedFrom,
    rawTitle: null,
    rawCompany: null,
    rawCity: null,
    rawSalary: null,
    cleanedSalary: null,
    mainTextPreview: "",
  });

  if (detected.inputType !== "work.ua URL" && detected.inputType !== "robota.ua URL") {
    return {
      ok: false,
      parseResult: failedResult("unsupported-domain"),
      fallbackReason: "Автоматичне зчитування підтримується тільки для Work.ua та Robota.ua. Скопіюйте текст вакансії вручну.",
      fetchStatus: null,
    };
  }

  const { html, fallbackReason, status } = await fetchVacancyHtml(url);
  if (!html) {
    return {
      ok: false,
      parseResult: failedResult("fetch-failed"),
      fallbackReason: fallbackReason ?? MANUAL_TEXT_MESSAGE,
      fetchStatus: status,
    };
  }

  const parseResult = detected.inputType === "work.ua URL"
    ? parseWorkUaVacancy(html, sourceUrl)
    : parseRobotaUaVacancy(html, sourceUrl);
  const parsed = parseResult.parsed;
  const hasMainData = Boolean(parsed.title || parsed.companyName || parsed.city || parsed.salaryText);
  return {
    ok: hasMainData,
    parseResult,
    fallbackReason: hasMainData ? null : MANUAL_TEXT_MESSAGE,
    fetchStatus: status,
  };
}

export function analyzeParsedVacancy(parsed: ParsedVacancy) {
  const text = vacancyText(parsed);
  return {
    hasSalary: Boolean(parsed.salaryText),
    hasCompany: Boolean(parsed.companyName),
    hasCity: Boolean(parsed.city),
    hasSchedule: Boolean(parsed.schedule) || hasClearSchedule(text),
    hasEmployment: hasEmploymentWording(text),
    mentionsOfficialEmployment: parsed.mentionsOfficialEmployment,
    mentionsBooking: parsed.mentionsBooking || hasBookingWording(text),
    mentionsProbation: parsed.mentionsProbation || hasProbationWording(text),
    mentionsBonus: parsed.mentionsBonus || hasBonusWording(text),
  };
}
