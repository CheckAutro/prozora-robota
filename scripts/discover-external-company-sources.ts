import { loadEnvConfig } from "@next/env";
import { getServiceClient } from "@/lib/supabase/server";
import { COMPANY_ALIASES, normalizeLookupText } from "@/lib/vacancy-parser";
import { generateCompanySlug, normalizeCompanyName } from "@/lib/company-matching";
import { discoverExternalSourcesForCompany } from "@/lib/external/source-discovery";
import {
  externalSearchDisabledMessage,
  externalSearchIsEnabled,
  normalizeSearchResultUrl,
} from "@/lib/external/search-provider";
import {
  detectSourceLanguage,
  inferSourceTypeFromContent,
  normalizeExternalSourceForPublic,
  sanitizeText,
  sourceNameFromUrl,
} from "@/lib/external/source-normalizer";
import { upsertExternalCompanySource, externalCompanySourcesTableMissing } from "@/lib/external/company-sources";
import type { ExternalCompanySourceType } from "@/lib/types";

loadEnvConfig(process.cwd());

interface Args {
  slug: string | null;
  limit: number;
  dryRun: boolean;
  onlyMissing: boolean;
  source: "search" | "known" | "all";
}

interface CompanyRow {
  slug: string;
  name: string;
  city: string | null;
  industry: string | null;
}

interface KnownSourceRow {
  company_slug: string;
  company_name: string;
  source_name: string | null;
  source_url: string | null;
  source_type: string | null;
  title: string | null;
  short_summary: string | null;
  source_excerpt: string | null;
  rating_value: number | null;
  rating_scale: number | null;
  reviews_count: number | null;
  confidence: string | null;
  status: string | null;
  is_public: boolean | null;
}

interface CandidatePayload {
  company_slug: string;
  company_name: string;
  source_name: string;
  source_url: string;
  source_type: ExternalCompanySourceType;
  title: string;
  short_summary: string;
  positive_points: string[];
  negative_points: string[];
  neutral_facts: string[];
  rating_value: number | null;
  rating_scale: number | null;
  reviews_count: number;
  confidence: "low" | "medium" | "high";
  status: "needs_verification";
  is_public: false;
  source_excerpt: string | null;
  collected_at: string;
  admin_note: string;
}

interface Stats {
  companiesProcessed: number;
  queriesRun: number;
  searchResults: number;
  candidatesFound: number;
  created: number;
  skippedDuplicates: number;
  blocked: number;
  errors: number;
}

function parseArgs(argv: string[]): Args {
  let slug: string | null = null;
  let limit = 50;
  let dryRun = false;
  let onlyMissing = false;
  let source: Args["source"] = "all";

  for (const arg of argv) {
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--only-missing") onlyMissing = true;
    else if (arg.startsWith("--slug=")) slug = arg.slice("--slug=".length).trim() || null;
    else if (arg.startsWith("--limit=")) {
      const parsed = Number(arg.slice("--limit=".length));
      if (Number.isFinite(parsed) && parsed > 0) limit = Math.min(500, Math.trunc(parsed));
    } else if (arg.startsWith("--source=")) {
      const value = arg.slice("--source=".length).trim();
      if (value === "search" || value === "known" || value === "all") source = value;
    }
  }

  return { slug, limit, dryRun, onlyMissing, source };
}

function isPublicHttpUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    if (!["http:", "https:"].includes(url.protocol)) return false;
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    return !(
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "0.0.0.0" ||
      host === "::1" ||
      host.startsWith("127.") ||
      host.startsWith("10.") ||
      /^192\.168\./.test(host) ||
      /^169\.254\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
      host.endsWith(".local")
    );
  } catch {
    return false;
  }
}

function normalizePublicUrl(value: string | null): string | null {
  if (!value || !isPublicHttpUrl(value)) return null;
  try {
    const url = new URL(value.trim());
    url.hash = "";
    for (const key of Array.from(url.searchParams.keys())) {
      if (/^utm_/i.test(key) || /^(gclid|fbclid|yclid|mc_cid|mc_eid)$/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    return url.toString();
  } catch {
    return null;
  }
}

function clean(value: string | null | undefined, limit = 800): string {
  return sanitizeText(value ?? "", limit);
}

function unique<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = keyFn(item).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function buildKnownSourceType(sourceType: string | null, sourceName: string | null, sourceUrl: string, title: string | null): ExternalCompanySourceType {
  const lower = `${sourceType ?? ""} ${sourceName ?? ""} ${sourceUrl} ${title ?? ""}`.toLowerCase();
  if (/rating|оцінк|рейтинг/.test(lower)) return "rating";
  if (/відгук|review|отзыв/.test(lower)) return "reviews";
  if (/ваканс|job|vacancy|робота/.test(lower)) return "vacancy";
  if (/сторінка|company|компан|роботодав/.test(lower)) return "company_page";
  if (/article|news|новин|статт/.test(lower)) return "article";
  return "other";
}

function isSourceSummaryOpenFact(title: string | null, excerpt: string | null): boolean {
  const lower = `${title ?? ""} ${excerpt ?? ""}`.toLowerCase();
  return (
    lower.startsWith("сторінка компанії на") ||
    lower.includes("компанія має сторінку") ||
    lower.includes("кількість відкритих вакансій у списку") ||
    lower.includes("сторінка компанії у джерелі")
  );
}

function sourceTypeFromLegacySignal(signalType: string | null, summary: string | null, sourceUrl: string): ExternalCompanySourceType {
  const lower = `${signalType ?? ""} ${summary ?? ""} ${sourceUrl}`.toLowerCase();
  if (/salary_delay|unclear_salary|schedule_risk|overload|official_employment_issue|interview_issue|management_issue|positive_team|positive_salary|positive_conditions/.test(lower)) {
    return "reviews";
  }
  if (/booking_info|internship_info/.test(lower)) return "vacancy";
  if (/rating|оцінк|рейтинг/.test(lower)) return "rating";
  if (/ваканс|job|vacancy|робота/.test(lower)) return "vacancy";
  if (/company_page|company|компан|роботодав/.test(lower)) return "company_page";
  return "other";
}

function confidenceFromText(
  companyName: string,
  sourceUrl: string,
  title: string,
  summary: string,
  aliases: string[] = []
): "low" | "medium" | "high" {
  const text = normalizeLookupText(`${companyName} ${sourceUrl} ${title} ${summary}`);
  const nameTokens = unique([companyName, generateCompanySlug(companyName), ...aliases].map((value) => normalizeCompanyName(value)), (value) => value);
  const normalizedCompany = normalizeLookupText(companyName);
  if (nameTokens.some((token) => token && text.includes(normalizeLookupText(token)))) return "high";
  if (normalizedCompany && text.includes(normalizedCompany)) return "high";
  if (/work\.ua|robota\.ua|dou\.ua|djinni\.co|indeed\.com|glassdoor\.com/.test(sourceUrl)) return "medium";
  return "low";
}

function buildShortSummary(row: KnownSourceRow): string {
  if (row.source_type === "rating") {
    const rating = row.rating_value !== null ? `${row.rating_value}${row.rating_scale ? ` / ${row.rating_scale}` : ""}` : "оцінка не вказана";
    return clean(
      row.short_summary ??
        `Підтверджена зовнішня оцінка: ${rating}; кількість оцінок: ${row.reviews_count ?? 0}.`,
      800
    );
  }

  if (row.source_type === "reviews") {
    return clean(
      row.short_summary ??
        row.source_excerpt ??
        `${row.source_name ?? "Зовнішнє джерело"} містить короткі узагальнення про компанію.`,
      800
    );
  }

  return clean(
    row.short_summary ??
      row.source_excerpt ??
      row.title ??
      `${row.source_name ?? "Зовнішнє джерело"} про компанію.`,
    800
  );
}

function buildKnownCandidate(row: KnownSourceRow): CandidatePayload | null {
  const sourceUrl = normalizePublicUrl(row.source_url);
  if (!sourceUrl) return null;
  const companyName = clean(row.company_name, 200);
  if (!companyName) return null;
  const companySlug = clean(row.company_slug, 120) || generateCompanySlug(companyName);
  const aliases = COMPANY_ALIASES[companySlug] ?? [];
  const sourceName = clean(row.source_name ?? sourceNameFromUrl(sourceUrl), 100) || sourceNameFromUrl(sourceUrl);
  const title = clean(row.title, 240) || sourceName;
  const sourceType = buildKnownSourceType(row.source_type, sourceName, sourceUrl, title);
  const rawSummary = buildShortSummary(row);
  const sourceLanguage = detectSourceLanguage({
    title,
    snippet: rawSummary,
    sourceUrl,
  });
  const normalized = normalizeExternalSourceForPublic({
    title,
    snippet: rawSummary,
    sourceUrl,
    sourceType,
    sourceLanguage,
  });
  const shortSummary = normalized.ukrainianShortSummary;
  const confidence = confidenceFromText(companyName, sourceUrl, title, rawSummary, aliases);
  const positivePoints = normalized.positivePointsUk.length ? normalized.positivePointsUk : /офіцій|оформл|бронюван/.test(shortSummary.toLowerCase())
    ? ["Згадується офіційне оформлення або бронювання."]
    : [];
  const negativePoints = normalized.negativePointsUk.length ? normalized.negativePointsUk : /затрим|штраф|поган|негатив|перевантаж/.test(shortSummary.toLowerCase())
    ? ["Є ризикова або негативна згадка."]
    : [];
  const neutralFacts = normalized.neutralFactsUk.length ? normalized.neutralFactsUk : positivePoints.length === 0 && negativePoints.length === 0
    ? ["Є коротке узагальнення з відкритого джерела."]
    : [];

  return {
    company_slug: companySlug,
    company_name: companyName,
    source_name: sourceName,
    source_url: sourceUrl,
    source_type: sourceType,
    title: normalized.ukrainianTitle || title,
    short_summary: shortSummary,
    positive_points: positivePoints,
    negative_points: negativePoints,
    neutral_facts: neutralFacts,
    rating_value: row.rating_value ?? null,
    rating_scale: row.rating_scale ?? null,
    reviews_count: Math.max(0, Math.trunc(row.reviews_count ?? 0)),
    confidence,
    status: "needs_verification",
    is_public: false,
    source_excerpt: clean(row.source_excerpt ?? rawSummary, 800) || null,
    collected_at: new Date().toISOString(),
    admin_note: `known source import (${row.source_type ?? "unknown"}); Original language: ${normalized.sourceLanguage}`,
  };
}

async function loadCompanies(limit: number, slug: string | null): Promise<CompanyRow[]> {
  const client = getServiceClient();
  let query = client.from("companies").select("slug, name, city, industry").order("name");
  if (slug) query = query.eq("slug", slug);
  else query = query.limit(limit);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as CompanyRow[];
}

async function loadCompanySourceSlugs(): Promise<Set<string>> {
  const client = getServiceClient();
  const { data, error } = await client.from("external_company_sources").select("company_slug");
  if (error) {
    if (externalCompanySourcesTableMissing(error)) throw new Error("Run Supabase migration 20240108_external_company_sources.sql first");
    throw new Error(error.message);
  }
  return new Set((data ?? []).map((row) => String((row as Record<string, unknown>).company_slug ?? "").trim()).filter(Boolean));
}

async function loadKnownSourceRows(companySlug: string): Promise<KnownSourceRow[]> {
  const client = getServiceClient();
  const [openFacts, ratings, reviewSignals, discoveryQueue] = await Promise.all([
    client
      .from("company_open_facts")
      .select("company_slug, company_name, source_name, source_url, vacancy_title, raw_excerpt, collected_at, status, is_public")
      .eq("company_slug", companySlug)
      .eq("status", "verified")
      .eq("is_public", true),
    client
      .from("external_ratings")
      .select("company_slug, company_name, source_name, source_url, rating_value, rating_scale, reviews_count, note, fetched_at, collected_at, status, is_public")
      .eq("company_slug", companySlug)
      .eq("status", "verified")
      .eq("is_public", true),
    client
      .from("external_review_signals")
      .select("company_slug, company_name, source_name, source_url, topic, summary, confidence, collected_at, status, is_public")
      .eq("company_slug", companySlug)
      .eq("status", "verified")
      .eq("is_public", true),
    client
      .from("company_discovery_queue")
      .select("discovered_name, suggested_slug, source_name, source_url, city, industry, description, company_size, matched_existing_slug, match_confidence, status, is_imported, imported_company_slug, raw_excerpt, collected_at, admin_note, created_at")
      .or(`matched_existing_slug.eq.${companySlug},imported_company_slug.eq.${companySlug}`)
      .neq("status", "rejected"),
  ]);

  let legacySignals: { data: Record<string, unknown>[] | null; error: { code?: string; message?: string } | null } = { data: [], error: null };
  try {
    legacySignals = await client
      .from("external_signals")
      .select("company_slug, company_name, source_name, source_url, short_summary, signal_type, created_at, status, is_public")
      .eq("company_slug", companySlug)
      .eq("status", "verified")
      .eq("is_public", true);
  } catch {
    legacySignals = { data: [], error: null };
  }

  const rows: KnownSourceRow[] = [];

  for (const row of (openFacts.data ?? []) as Record<string, unknown>[]) {
    const title = typeof row.vacancy_title === "string" ? row.vacancy_title : null;
    const excerpt = typeof row.raw_excerpt === "string" ? row.raw_excerpt : null;
    rows.push({
      company_slug: companySlug,
      company_name: String(row.company_name ?? ""),
      source_name: String(row.source_name ?? ""),
      source_url: typeof row.source_url === "string" ? row.source_url : null,
      source_type: isSourceSummaryOpenFact(title, excerpt) ? "company_page" : "vacancy",
      title,
      short_summary: excerpt,
      source_excerpt: excerpt,
      rating_value: null,
      rating_scale: null,
      reviews_count: null,
      confidence: "high",
      status: String(row.status ?? "verified"),
      is_public: Boolean(row.is_public),
    });
  }

  for (const row of (ratings.data ?? []) as Record<string, unknown>[]) {
    rows.push({
      company_slug: companySlug,
      company_name: String(row.company_name ?? ""),
      source_name: String(row.source_name ?? ""),
      source_url: typeof row.source_url === "string" ? row.source_url : null,
      source_type: "rating",
      title: "Підтверджена зовнішня оцінка",
      short_summary: typeof row.note === "string" ? row.note : null,
      source_excerpt: typeof row.note === "string" ? row.note : null,
      rating_value: typeof row.rating_value === "number" ? row.rating_value : null,
      rating_scale: typeof row.rating_scale === "number" ? row.rating_scale : null,
      reviews_count: typeof row.reviews_count === "number" ? row.reviews_count : null,
      confidence: "high",
      status: String(row.status ?? "verified"),
      is_public: Boolean(row.is_public),
    });
  }

  for (const row of (reviewSignals.data ?? []) as Record<string, unknown>[]) {
    rows.push({
      company_slug: companySlug,
      company_name: String(row.company_name ?? ""),
      source_name: String(row.source_name ?? ""),
      source_url: typeof row.source_url === "string" ? row.source_url : null,
      source_type: "reviews",
      title: `Сигнал: ${String(row.topic ?? "other")}`,
      short_summary: typeof row.summary === "string" ? row.summary : null,
      source_excerpt: typeof row.summary === "string" ? row.summary : null,
      rating_value: null,
      rating_scale: null,
      reviews_count: typeof row.mentions_count === "number" ? row.mentions_count : null,
      confidence: String(row.confidence ?? "medium") as "low" | "medium" | "high",
      status: String(row.status ?? "verified"),
      is_public: Boolean(row.is_public),
    });
  }

  for (const row of (legacySignals.data ?? []) as Record<string, unknown>[]) {
    const sourceUrl = typeof row.source_url === "string" ? row.source_url : null;
    rows.push({
      company_slug: companySlug,
      company_name: String(row.company_name ?? ""),
      source_name: String(row.source_name ?? ""),
      source_url: sourceUrl,
      source_type: sourceTypeFromLegacySignal(
        typeof row.signal_type === "string" ? row.signal_type : null,
        typeof row.short_summary === "string" ? row.short_summary : null,
        sourceUrl ?? ""
      ),
      title: String(row.signal_type ?? "other"),
      short_summary: typeof row.short_summary === "string" ? row.short_summary : null,
      source_excerpt: typeof row.short_summary === "string" ? row.short_summary : null,
      rating_value: null,
      rating_scale: null,
      reviews_count: 0,
      confidence: "medium",
      status: String(row.status ?? "verified"),
      is_public: Boolean(row.is_public),
    });
  }

  for (const row of (discoveryQueue.data ?? []) as Record<string, unknown>[]) {
    const sourceUrl = typeof row.source_url === "string" ? row.source_url : null;
    if (!sourceUrl) continue;
    rows.push({
      company_slug: companySlug,
      company_name: String(row.discovered_name ?? ""),
      source_name: String(row.source_name ?? "Зовнішнє джерело"),
      source_url: sourceUrl,
      source_type: "company_page",
      title: String(row.discovered_name ?? "Компанія"),
      short_summary: typeof row.description === "string" ? row.description : null,
      source_excerpt: typeof row.raw_excerpt === "string" ? row.raw_excerpt : null,
      rating_value: null,
      rating_scale: null,
      reviews_count: 0,
      confidence: String(row.match_confidence ?? "low") as "low" | "medium" | "high",
      status: "needs_verification",
      is_public: false,
    });
  }

  return rows;
}

async function knownSourceExists(candidate: CandidatePayload): Promise<boolean> {
  const client = getServiceClient();
  let query = client
    .from("external_company_sources")
    .select("id")
    .eq("company_slug", candidate.company_slug)
    .eq("source_name", candidate.source_name)
    .eq("source_type", candidate.source_type);
  query = candidate.source_url ? query.eq("source_url", candidate.source_url) : query.is("source_url", null);
  query = candidate.title ? query.eq("title", candidate.title) : query.is("title", null);
  const { data, error } = await query.maybeSingle();
  if (error) {
    if (externalCompanySourcesTableMissing(error)) throw new Error("Run Supabase migration 20240108_external_company_sources.sql first");
    throw new Error(error.message);
  }
  return Boolean(data?.id);
}

async function saveCandidate(candidate: CandidatePayload, dryRun: boolean): Promise<boolean> {
  if (dryRun) return true;

  const result = await upsertExternalCompanySource(candidate);
  if (!result.ok) {
    if (result.missingTable) throw new Error("Run Supabase migration 20240108_external_company_sources.sql first");
    throw new Error(result.error);
  }
  return result.created;
}

async function processKnownSourcesForCompany(company: CompanyRow, dryRun: boolean): Promise<{
  candidatesFound: number;
  created: number;
  skippedDuplicates: number;
  blocked: number;
  errors: number;
}> {
  const rows = unique(await loadKnownSourceRows(company.slug), (row) =>
    `${row.source_url ?? ""}|${row.source_name ?? ""}|${row.title ?? ""}`
  );

  let candidatesFound = 0;
  let created = 0;
  let skippedDuplicates = 0;
  let blocked = 0;
  let errors = 0;

  for (const row of rows) {
    const candidate = buildKnownCandidate(row);
    if (!candidate) {
      blocked += 1;
      continue;
    }
    if (await knownSourceExists(candidate)) {
      skippedDuplicates += 1;
      continue;
    }
    candidatesFound += 1;
    try {
      const saved = await saveCandidate(candidate, dryRun);
      if (dryRun) {
        created += 0;
      } else if (saved) {
        created += 1;
      } else {
        skippedDuplicates += 1;
      }
    } catch {
      errors += 1;
    }
  }

  return { candidatesFound, created, skippedDuplicates, blocked, errors };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const searchEnabled = externalSearchIsEnabled();

  const stats: Stats = {
    companiesProcessed: 0,
    queriesRun: 0,
    searchResults: 0,
    candidatesFound: 0,
    created: 0,
    skippedDuplicates: 0,
    blocked: 0,
    errors: 0,
  };
  const warnings: string[] = [];
  const sampleCandidates: Array<{
    companySlug: string;
    sourceName: string;
    sourceType: ExternalCompanySourceType;
    confidence: string;
    title: string | null;
    shortSummary: string;
    adminNote: string | null;
  }> = [];

  if (args.source === "search" && !searchEnabled) {
    console.log(externalSearchDisabledMessage());
    return;
  }

  const client = getServiceClient();
  try {
    const tableCheck = await client.from("external_company_sources").select("id").limit(1);
    if (tableCheck.error) {
      if (externalCompanySourcesTableMissing(tableCheck.error)) {
        console.error("Run Supabase migration 20240108_external_company_sources.sql first");
        process.exitCode = 1;
        return;
      }
      throw new Error(tableCheck.error.message);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[discover-external-sources] database unavailable: ${message}`);
    console.log(JSON.stringify({
      ok: false,
      source: args.source,
      dryRun: args.dryRun,
      companiesProcessed: 0,
      queriesRun: 0,
      searchResults: 0,
      candidatesFound: 0,
      created: 0,
      skippedDuplicates: 0,
      blocked: 0,
      errors: 1,
      warnings: [message],
      dryRunMessage: args.dryRun ? "dry run: no rows were written" : undefined,
    }, null, 2));
    return;
  }

  let companies: CompanyRow[] = [];
  try {
    companies = await loadCompanies(args.limit, args.slug);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[discover-external-sources] database unavailable: ${message}`);
    console.log(JSON.stringify({
      ok: false,
      source: args.source,
      dryRun: args.dryRun,
      companiesProcessed: 0,
      queriesRun: 0,
      searchResults: 0,
      candidatesFound: 0,
      created: 0,
      skippedDuplicates: 0,
      blocked: 0,
      errors: 1,
      warnings: [message],
      dryRunMessage: args.dryRun ? "dry run: no rows were written" : undefined,
    }, null, 2));
    return;
  }
  if (companies.length === 0) {
    console.log("No companies to process.");
    return;
  }

  if ((args.source === "search" || args.source === "all") && !searchEnabled) {
    warnings.push(externalSearchDisabledMessage());
    if (args.source === "search") {
      console.log(externalSearchDisabledMessage());
      return;
    }
  }

  const sourceSlugs = await loadCompanySourceSlugs();
  const targets = args.onlyMissing ? companies.filter((company) => !sourceSlugs.has(company.slug)) : companies;
  const processed = targets.slice(0, args.limit);

  const workers = 2;
  let index = 0;
  const results: Stats[] = [];

  async function worker() {
    while (index < processed.length) {
      const currentIndex = index;
      index += 1;
      const company = processed[currentIndex];
      if (!company) continue;
      stats.companiesProcessed += 1;

      try {
        const companyStats: Stats = {
          companiesProcessed: 1,
          queriesRun: 0,
          searchResults: 0,
          candidatesFound: 0,
          created: 0,
          skippedDuplicates: 0,
          blocked: 0,
          errors: 0,
        };

        if ((args.source === "search" || args.source === "all") && searchEnabled) {
          const discovered = await discoverExternalSourcesForCompany({
            companySlug: company.slug,
            companyName: company.name,
            aliases: COMPANY_ALIASES[company.slug] ?? [],
            industry: company.industry,
            limit: args.limit,
            dryRun: args.dryRun,
          });
          companyStats.queriesRun += discovered.stats.queriesRun;
          companyStats.searchResults += discovered.stats.searchResults;
          companyStats.candidatesFound += discovered.stats.candidatesFound;
          companyStats.created += discovered.stats.created;
          companyStats.skippedDuplicates += discovered.stats.skippedDuplicates;
          companyStats.blocked += discovered.stats.blocked;
          companyStats.errors += discovered.stats.errors;
          warnings.push(...discovered.warnings);
          for (const source of discovered.sources.slice(0, 5)) {
            if (sampleCandidates.length >= 10) break;
            sampleCandidates.push({
              companySlug: source.companySlug,
              sourceName: source.sourceName,
              sourceType: source.sourceType,
              confidence: source.confidence,
              title: source.title,
              shortSummary: source.shortSummary,
              adminNote: source.adminNote,
            });
          }
        }

        if (args.source === "known" || args.source === "all") {
          const knownStats = await processKnownSourcesForCompany(company, args.dryRun);
          companyStats.candidatesFound += knownStats.candidatesFound;
          companyStats.created += knownStats.created;
          companyStats.skippedDuplicates += knownStats.skippedDuplicates;
          companyStats.blocked += knownStats.blocked;
          companyStats.errors += knownStats.errors;
        }

        results.push(companyStats);
      } catch (error) {
        stats.errors += 1;
        warnings.push(`${company.slug}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  await Promise.all(Array.from({ length: workers }, () => worker()));

  for (const row of results) {
    stats.queriesRun += row.queriesRun;
    stats.searchResults += row.searchResults;
    stats.candidatesFound += row.candidatesFound;
    stats.created += row.created;
    stats.skippedDuplicates += row.skippedDuplicates;
    stats.blocked += row.blocked;
    stats.errors += row.errors;
  }

  console.log(JSON.stringify({
    ok: true,
    source: args.source,
    dryRun: args.dryRun,
    companiesProcessed: stats.companiesProcessed,
    queriesRun: stats.queriesRun,
    searchResults: stats.searchResults,
    candidatesFound: stats.candidatesFound,
    created: stats.created,
    skippedDuplicates: stats.skippedDuplicates,
    blocked: stats.blocked,
    errors: stats.errors,
    warnings: warnings.slice(0, 20),
    sampleCandidates: args.dryRun ? sampleCandidates : undefined,
    dryRunMessage: args.dryRun ? "dry run: no rows were written" : undefined,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
