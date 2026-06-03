// lib/vacancy-search.ts
// Finds companies from public.companies that are mentioned in free-form vacancy text.
// Used on /check-vacancy to match "Нова Пошта курʼєр Київ" → Нова Пошта.

import { getBrowserClient, isSupabaseConfigured } from "./supabase/client";
import { COMPANIES } from "./mock-data";
import { slugifyCompanyName } from "./slugify";
import type { Review } from "./types";

export interface FoundCompany {
  name: string;
  slug: string;
  city: string | null;
  industry: string | null;
}

export interface CompanyCheckResult {
  company: FoundCompany;
  reviewCount: number;
  averageRating: number | null;
  riskSignals: RiskSignal[];
  recentReviews: Review[];
}

export interface RiskSignal {
  field: string;
  label: string;
}

const RATING_LABEL: Record<string, string> = {
  salary:     "Є відгуки з низькою оцінкою зарплати",
  schedule:   "Є відгуки з низькою оцінкою графіку",
  conditions: "Є відгуки з низькою оцінкою умов",
  management: "Є відгуки з низькою оцінкою керівництва",
  honesty:    "Є відгуки з низькою оцінкою чесності вакансії",
};
const RATING_KEYS = Object.keys(RATING_LABEL) as (keyof typeof RATING_LABEL)[];

// ── URL handling ─────────────────────────────────────────────────────────────

/**
 * Known domain-to-company-name mappings for common Ukrainian employers.
 * Only the hostname suffix is stored (no www., no TLD variation).
 * e.g. "novaposhta.ua" → "Нова Пошта"
 *
 * We deliberately do NOT map generic job-board domains (work.ua, robota.ua,
 * grc.ua, etc.) so the caller can detect "URL with no employer info".
 */
const DOMAIN_TO_NAME: Record<string, string> = {
  "novaposhta.ua":       "Нова Пошта",
  "np.ua":               "Нова Пошта",
  "ukrposhta.ua":        "Укрпошта",
  "rozetka.com.ua":      "Rozetka",
  "rozetka.ua":          "Rozetka",
  "atbmarket.com":       "АТБ",
  "atb.ua":              "АТБ",
  "silpo.ua":            "Сільпо",
  "varus.ua":            "Varus",
  "eva.ua":              "EVA",
  "comfy.ua":            "Comfy",
  "glovoapp.com":        "Glovo",
  "bolt.eu":             "Bolt Food",
  "bolt.food":           "Bolt Food",
  "kyivstar.ua":         "Київстар",
  "vodafone.ua":         "Vodafone Україна",
  "lifecell.ua":         "lifecell",
  "pryvatbank.ua":       "ПриватБанк",
  "privatbank.ua":       "ПриватБанк",
  "mono.bank":           "monobank",
  "monobank.ua":         "monobank",
  "a-bank.com.ua":       "A-Банк",
  "oschadbank.ua":       "Ощадбанк",
  "raiffeisen.ua":       "Райффайзен Банк",
  "pumb.ua":             "ПУМБ",
  "sense.com.ua":        "Sense Bank",
  "okko.ua":             "ОККО",
  "wog.ua":              "WOG",
  "socar.ua":            "SOCAR",
  "mcdonald.ua":         "McDonald's",
  "mcdonalds.ua":        "McDonald's",
  "kfc.ua":              "KFC",
  "dominos.ua":          "Domino's Pizza",
  "softserve.com":       "SoftServe",
  "epam.com":            "EPAM Ukraine",
  "globallogic.com":     "GlobalLogic",
  "luxoft.com":          "Luxoft",
  "intellias.com":       "Intellias",
  "n-ix.com":            "N-iX",
  "ciklum.com":          "Ciklum",
  "dataart.com":         "DataArt",
  "gen.tech":            "Genesis",
  "macpaw.com":          "MacPaw",
  "grammarly.com":       "Grammarly",
  "jooble.org":          "Jooble",
  "evo.company":         "EVO",
  "netpeak.ua":          "Netpeak",
  "betterme.world":      "BetterMe",
  "preply.com":          "Preply",
  "ajax.systems":        "Ajax Systems",
  "roshen.com":          "Roshen",
  "obolon.ua":           "Оболонь",
  "mhp.com.ua":          "МХП",
  "kernel.ua":           "Kernel",
  "dtek.com":            "ДТЕК",
  "metinvest.com":       "Метінвест",
  "interpipe.ua":        "Інтерпайп",
  "dobrobut.com":        "Добробут",
  "sinevo.ua":           "Сінево",
  "dila.ua":             "Діла",
  "lun.ua":              "ЛУН",
};

/** Domains that are generic job boards — don't carry employer info. */
const JOB_BOARD_DOMAINS = new Set([
  "work.ua", "robota.ua", "grc.ua", "hh.ua", "indeed.com",
  "jobs.ua", "rabota.ua", "jooble.org", "linkedin.com",
  "dou.ua", "djinni.co", "moikrug.ru",
]);

/**
 * Result of URL parsing. Returns:
 *  - `text`: space-joined tokens extracted from host + path (for search).
 *  - `directName`: the employer name if the domain is in DOMAIN_TO_NAME.
 *  - `isJobBoard`: true when URL points to a generic job board.
 */
export interface UrlExtractResult {
  text: string;
  directName: string | null;
  isJobBoard: boolean;
}

/**
 * Tries to parse `input` as a URL.
 * Returns null if `input` is not a valid URL.
 * Does NOT make any network requests.
 */
export function extractUrlText(input: string): UrlExtractResult | null {
  const trimmed = input.trim();
  // Quick check: must contain "://" or start with "www."
  if (!trimmed.includes("://") && !trimmed.startsWith("www.")) return null;

  let parsed: URL;
  try {
    const withProtocol = trimmed.startsWith("www.") ? `https://${trimmed}` : trimmed;
    parsed = new URL(withProtocol);
  } catch {
    return null;
  }

  // Strip leading "www."
  const host = parsed.hostname.replace(/^www\./, "");
  const isJobBoard = JOB_BOARD_DOMAINS.has(host);

  // Check domain map (exact match, then suffix match for subdomains)
  let directName: string | null = DOMAIN_TO_NAME[host] ?? null;
  if (!directName) {
    // Try suffix: "careers.novaposhta.ua" → match "novaposhta.ua"
    for (const [domain, name] of Object.entries(DOMAIN_TO_NAME)) {
      if (host === domain || host.endsWith("." + domain)) {
        directName = name;
        break;
      }
    }
  }

  // Build searchable text from host + decoded path segments
  const pathSegments = decodeURIComponent(parsed.pathname)
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^\d+$/.test(s)); // drop pure numeric IDs

  const hostTokens = host.replace(/\.(ua|com|org|net|eu|io|world|app)(\.\w+)?$/, "").replace(/[.\-]/g, " ");
  const text = [hostTokens, ...pathSegments].join(" ");

  return { text, directName, isJobBoard };
}

// Words that are weak signals on their own — single-token match from these
// should not strongly elevate a company.
const WEAK_TOKENS = new Set([
  // Ukrainian job/place words
  "нова","банк","робота","вакансія","оператор","менеджер","кур","єр",
  "київ","львів","одеса","дніпро","харків","пошта","аптека",
  // English equivalents
  "nova","bank","kyiv","lviv","odesa","courier","operator","manager",
  "developer","engineer","analyst","designer","senior","junior","middle",
  "lead","intern","specialist","coordinator","pharmacy",
]);

/**
 * Scores how well a candidate company matches the raw input text.
 *
 * Scoring rules (applied in priority order):
 *  +100  Full company name found verbatim in the input (case-insensitive).
 *        Immediately returned — this is a definitive match.
 *  +90   Full slug found in slugified input, or slug-without-dashes found
 *        in slug-without-dashes of input.
 *  +50   Bonus when ≥ 2 name tokens matched independently.
 *  +15   Each strong (non-weak) name token matched.
 *  +5    Each weak name token matched.
 *
 * A score ≥ 80 means the UI should show this company directly without
 * asking the user to pick from a list.
 */
function scoreCompany(company: FoundCompany, inputLow: string, slugInput: string): number {
  const nameLow = company.name.toLowerCase().trim();
  const cSlug   = company.slug;

  // Rule 1: full name found in input — highest priority
  if (inputLow.includes(nameLow)) return 100;

  // Rule 2: full slug in slugified input
  const slugNoHyphen = cSlug.replace(/-/g, "");
  const inputNoHyphen = slugInput.replace(/-/g, "");
  if (slugInput.includes(cSlug) || inputNoHyphen.includes(slugNoHyphen)) return 90;

  // Rule 3+4: token-level matching
  const nameTokens = nameLow
    .split(/[\s\-_/]+/)
    .filter((t) => t.length >= 2);

  let score = 0;
  let matchedCount = 0;

  for (const nt of nameTokens) {
    const ntSlug = slugifyCompanyName(nt);
    const matched =
      inputLow.includes(nt) ||                // Cyrillic token in input
      (ntSlug.length >= 2 && slugInput.includes(ntSlug)); // Latin slug token

    if (matched) {
      const isWeak = WEAK_TOKENS.has(nt) || WEAK_TOKENS.has(ntSlug);
      score += isWeak ? 5 : 15;
      matchedCount++;
    }
  }

  if (matchedCount >= 2) score += 50;
  else if (matchedCount === 1) score += 10;

  return score;
}

/**
 * Fetches candidate companies from Supabase (or mock fallback) using broad
 * ilike queries, then re-ranks results client-side with scoreCompany().
 *
 * If `input` is a URL, the domain + path are extracted and appended to the
 * effective search text. No external requests are made.
 *
 * Returns a scored, deduplicated list sorted by score descending (max 5).
 * Only companies with score > 0 are returned.
 * Also returns `isUrlInput` and `isJobBoard` so the caller can show the
 * "could not determine employer from this URL" hint.
 */
export async function findCompaniesInVacancyText(
  input: string
): Promise<{ companies: FoundCompany[]; topScore: number; isJobBoard: boolean }> {
  const trimmed = input.trim();
  if (trimmed.length < 2) return { companies: [], topScore: 0, isJobBoard: false };

  // ── URL handling (no network requests) ────────────────────────────────────
  const urlResult = extractUrlText(trimmed);
  let isJobBoard = false;

  // If the URL maps directly to a known company, score it at 100 immediately.
  if (urlResult?.directName) {
    const directName = urlResult.directName;
    const { companies: found } = await findCompaniesInVacancyText(directName);
    if (found.length > 0) {
      return { companies: found, topScore: 100, isJobBoard: false };
    }
  }

  if (urlResult?.isJobBoard) isJobBoard = true;

  // Build the effective search text: original + URL-extracted tokens.
  const effectiveInput = urlResult
    ? `${trimmed} ${urlResult.text}`
    : trimmed;

  const inputLow  = effectiveInput.toLowerCase();
  const slugInput = slugifyCompanyName(effectiveInput);

  // Broad search tokens — keep all meaningful words (≥ 2 chars).
  const rawTokens = [...new Set(
    inputLow
      .split(/[\s,;:\-./\()\[\]{}'"""]+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2)
  )];

  // Limit tokens to prevent excessive parallel queries
  const tokens = rawTokens.slice(0, 8);

  let candidates: FoundCompany[] = [];

  if (isSupabaseConfigured()) {
    try {
      const client = getBrowserClient();

      // Broad parallel search across name and slug for each token.
      const searches = tokens.flatMap((token) => {
        const slugToken = slugifyCompanyName(token);
        const queries = [
          client
            .from("companies")
            .select("name, slug, city, industry")
            .ilike("name", `%${token}%`)
            .limit(10),
        ];
        if (slugToken.length >= 2) {
          queries.push(
            client
              .from("companies")
              .select("name, slug, city, industry")
              .ilike("slug", `%${slugToken}%`)
              .limit(10)
          );
        }
        return queries;
      });

      const responses = await Promise.all(searches);
      const seen = new Set<string>();
      for (const res of responses) {
        for (const row of res.data ?? []) {
          const c = row as FoundCompany;
          if (!seen.has(c.slug)) {
            seen.add(c.slug);
            candidates.push(c);
          }
        }
      }
    } catch {
      // Fall through to mock
    }
  }

  // Mock fallback when Supabase is unavailable or returned nothing
  if (candidates.length === 0) {
    const seen = new Set<string>();
    for (const c of COMPANIES) {
      if (seen.has(c.slug)) continue;
      const nameLow = c.name.toLowerCase();
      if (
        inputLow.includes(nameLow) ||
        slugInput.includes(c.slug) ||
        tokens.some((t) => nameLow.includes(t) && t.length > 2)
      ) {
        seen.add(c.slug);
        candidates.push({ name: c.name, slug: c.slug, city: c.city, industry: c.industry });
      }
    }
  }

  // Score and rank all candidates
  const scored = candidates
    .map((c) => ({ company: c, score: scoreCompany(c, inputLow, slugInput) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  return {
    companies: scored.map((x) => x.company),
    topScore:  scored[0]?.score ?? 0,
    isJobBoard,
  };
}

/**
 * Loads published reviews for a company and computes metrics + risk signals.
 * If Supabase is unavailable, returns an honest empty result instead of
 * falling back to demo reviews.
 */
export async function getCompanyCheckResult(
  company: FoundCompany
): Promise<CompanyCheckResult | null> {
  if (!isSupabaseConfigured()) return buildEmptyResult(company);

  try {
    const client = getBrowserClient();
    const { data, error } = await client
      .from("reviews")
      .select("*")
      .eq("company_slug", company.slug)
      .eq("status", "published")
      .order("created_at", { ascending: false })
      .limit(20); // enough for metrics + last 3

    if (error) return buildEmptyResult(company);

    const rows = data ?? [];
    const { fromRow } = await import("./storage");
    const reviews: Review[] = rows.map((r) => fromRow(r as Parameters<typeof fromRow>[0]));

    return buildResult(company, reviews);
  } catch {
    return buildEmptyResult(company);
  }
}

function buildResult(company: FoundCompany, reviews: Review[]): CompanyCheckResult {
  const allRatings: { field: string; value: number }[] = [];

  for (const r of reviews) {
    for (const key of RATING_KEYS) {
      const v = r.ratings?.[key as keyof typeof r.ratings];
      if (typeof v === "number" && !isNaN(v)) {
        allRatings.push({ field: key, value: v });
      }
    }
  }

  const averageRating =
    allRatings.length > 0
      ? allRatings.reduce((a, b) => a + b.value, 0) / allRatings.length
      : null;

  // Risk signals: fields where average per-field is <= 2
  const riskSignals: RiskSignal[] = [];
  for (const key of RATING_KEYS) {
    const fieldRatings = allRatings.filter((r) => r.field === key).map((r) => r.value);
    if (fieldRatings.length > 0) {
      const fieldAvg = fieldRatings.reduce((a, b) => a + b, 0) / fieldRatings.length;
      if (fieldAvg <= 2) {
        riskSignals.push({ field: key, label: RATING_LABEL[key] });
      }
    }
  }

  return {
    company,
    reviewCount: reviews.length,
    averageRating,
    riskSignals,
    recentReviews: reviews.slice(0, 3),
  };
}

function buildEmptyResult(company: FoundCompany): CompanyCheckResult {
  return {
    company,
    reviewCount: 0,
    averageRating: null,
    riskSignals: [],
    recentReviews: [],
  };
}
