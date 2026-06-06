import { createHash } from "crypto";
import { getServiceClient } from "@/lib/supabase/server";
import { COMPANY_ALIASES, normalizeLookupText } from "@/lib/vacancy-parser";
import { generateCompanySlug, normalizeCompanyName } from "@/lib/company-matching";
import type {
  ExternalCompanySource,
  ExternalCompanySourceConfidence,
  ExternalCompanySourceStatus,
  ExternalCompanySourceType,
} from "@/lib/types";
import {
  inferSourceTypeFromContent,
  sanitizeText,
  sourceNameFromUrl,
} from "./source-normalizer";
import {
  externalSearchDisabledMessage,
  externalSearchIsEnabled,
  normalizeSearchResultUrl,
  searchExternalSourcesWithWarnings,
} from "./search-provider";
import { upsertExternalCompanySource, externalCompanySourcesTableMissing } from "./company-sources";

export interface DiscoverExternalSourcesInput {
  companySlug: string;
  companyName: string;
  aliases?: string[];
  industry?: string | null;
  limit?: number;
  dryRun?: boolean;
}

export interface DiscoverExternalSourcesStats {
  companiesProcessed: number;
  queriesRun: number;
  searchResults: number;
  candidatesFound: number;
  created: number;
  skippedDuplicates: number;
  blocked: number;
  errors: number;
}

export interface DiscoverExternalSourcesResult {
  sources: ExternalCompanySource[];
  warnings: string[];
  stats: DiscoverExternalSourcesStats;
}

interface CompanySourceCandidate {
  companySlug: string;
  companyName: string;
  sourceName: string;
  sourceUrl: string;
  sourceType: ExternalCompanySourceType;
  title: string;
  shortSummary: string;
  positivePoints: string[];
  negativePoints: string[];
  neutralFacts: string[];
  confidence: ExternalCompanySourceConfidence;
  status: ExternalCompanySourceStatus;
  isPublic: boolean;
  sourceExcerpt: string | null;
  adminNote: string;
  collectedAt: string;
}

const SOCIAL_HOST_PATTERNS = [
  /(^|\.)facebook\.com$/i,
  /(^|\.)instagram\.com$/i,
  /(^|\.)linkedin\.com$/i,
  /(^|\.)twitter\.com$/i,
  /(^|\.)x\.com$/i,
  /(^|\.)youtube\.com$/i,
  /(^|\.)youtu\.be$/i,
  /(^|\.)tiktok\.com$/i,
  /(^|\.)telegram\.me$/i,
  /(^|\.)t\.me$/i,
  /(^|\.)wa\.me$/i,
  /(^|\.)reddit\.com$/i,
  /(^|\.)threads\.net$/i,
  /(^|\.)vk\.com$/i,
];

function cleanText(value: unknown, limit = 800): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, limit);
}

function hostFromUrl(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function isSocialHost(url: string): boolean {
  const host = hostFromUrl(url);
  return SOCIAL_HOST_PATTERNS.some((pattern) => pattern.test(host));
}

function normalizeCandidateUrl(url: string): string | null {
  const normalized = normalizeSearchResultUrl(url);
  if (!normalized) return null;
  if (isSocialHost(normalized)) return null;
  return normalized;
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

function buildQueries(companyName: string, aliases: string[] = []): string[] {
  const baseNames = unique([companyName, ...aliases], (value) => normalizeCompanyName(value));
  const templates = [
    "{name} відгуки працівників",
    "{name} отзывы сотрудников",
    "{name} робота відгуки",
    "{name} work.ua",
    "{name} robota.ua",
    "{name} DOU відгуки",
    "{name} Djinni",
    "{name} Indeed reviews",
    "{name} Glassdoor reviews",
  ];

  return unique(
    baseNames.flatMap((name) => templates.map((template) => template.replace("{name}", name))),
    (value) => value
  );
}

function textMatchesTerm(text: string, term: string): boolean {
  const normalizedText = normalizeLookupText(text);
  const normalizedTerm = normalizeLookupText(term);
  if (!normalizedTerm) return false;
  if (normalizedTerm.length <= 4) {
    const pattern = new RegExp(`(^|\\s|[^a-zа-яіїєґ0-9])${normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|\\s|[^a-zа-яіїєґ0-9])`, "i");
    return pattern.test(normalizedText);
  }
  return normalizedText.includes(normalizedTerm);
}

function candidateConfidence(companyName: string, aliases: string[], candidate: { title: string; snippet: string; url: string }): ExternalCompanySourceConfidence {
  const terms = unique([companyName, ...aliases, generateCompanySlug(companyName)], (value) => normalizeCompanyName(value || ""));
  const text = `${candidate.title} ${candidate.snippet} ${candidate.url}`;
  if (terms.some((term) => textMatchesTerm(text, term))) return "high";
  const tokenSet = new Set(
    terms
      .flatMap((term) => normalizeLookupText(term).split(" "))
      .filter((token) => token.length > 2)
  );
  const hitCount = Array.from(tokenSet).filter((token) => normalizeLookupText(text).includes(token)).length;
  if (hitCount >= 2) return "medium";
  if (/work\.ua|robota\.ua|dou\.ua|djinni\.co|indeed\.com|glassdoor\.com/.test(candidate.url)) return "medium";
  return "low";
}

function inferTopicAndFacts(candidate: { title: string; snippet: string; url: string }): {
  sourceType: ExternalCompanySourceType;
  positivePoints: string[];
  negativePoints: string[];
  neutralFacts: string[];
} {
  const text = `${candidate.title} ${candidate.snippet} ${candidate.url}`;
  const lower = text.toLowerCase();
  const sourceType = inferSourceTypeFromContent(candidate.title, candidate.snippet, candidate.url);
  const positivePoints: string[] = [];
  const negativePoints: string[] = [];
  const neutralFacts: string[] = [];

  if (/офіцій|оформл|contract|договір/.test(lower)) positivePoints.push("Згадується офіційне оформлення.");
  if (/позитив|добре|вигідн|прозор|команда/.test(lower)) positivePoints.push("Є позитивна згадка про умови або команду.");
  if (/затрим|штраф|негатив|важк|поган|плинність|перевантаж|конфлікт/.test(lower)) negativePoints.push("Є ризикова або негативна згадка.");
  if (/ставка|salary|зарплат|оплата|rating|рейтинг|оцінк|review|відгук/.test(lower)) neutralFacts.push("У джерелі згадується оцінка, відгук або зарплата.");
  if (/бронюван|відстроч/.test(lower)) neutralFacts.push("Є згадка про бронювання або відстрочку.");
  if (neutralFacts.length === 0 && positivePoints.length === 0 && negativePoints.length === 0) {
    neutralFacts.push("Є коротке узагальнення з відкритого джерела.");
  }

  return { sourceType, positivePoints, negativePoints, neutralFacts };
}

function candidateHash(candidate: Pick<CompanySourceCandidate, "companySlug" | "sourceName" | "sourceUrl" | "sourceType" | "title">): string {
  return createHash("sha1")
    .update(
      JSON.stringify({
        companySlug: candidate.companySlug,
        sourceName: candidate.sourceName,
        sourceUrl: candidate.sourceUrl,
        sourceType: candidate.sourceType,
        title: candidate.title,
      })
    )
    .digest("hex")
    .slice(0, 16);
}

async function existingSourceExists(candidate: CompanySourceCandidate): Promise<boolean> {
  const client = getServiceClient();
  let query = client
    .from("external_company_sources")
    .select("id")
    .eq("company_slug", candidate.companySlug)
    .eq("source_name", candidate.sourceName)
    .eq("source_type", candidate.sourceType);
  query = candidate.sourceUrl ? query.eq("source_url", candidate.sourceUrl) : query.is("source_url", null);
  query = candidate.title ? query.eq("title", candidate.title) : query.is("title", null);
  const { data, error } = await query.maybeSingle();
  if (error) {
    if (externalCompanySourcesTableMissing(error)) {
      throw new Error("Run Supabase migration 20240108_external_company_sources.sql first");
    }
    throw new Error(error.message);
  }
  return Boolean(data?.id);
}

async function saveCandidate(candidate: CompanySourceCandidate, dryRun: boolean): Promise<ExternalCompanySource | null> {
  if (dryRun) {
    return {
      id: `candidate:${candidateHash(candidate)}`,
      companySlug: candidate.companySlug,
      companyName: candidate.companyName,
      sourceName: candidate.sourceName,
      sourceUrl: candidate.sourceUrl,
      sourceType: candidate.sourceType,
      title: candidate.title,
      shortSummary: candidate.shortSummary,
      positivePoints: candidate.positivePoints,
      negativePoints: candidate.negativePoints,
      neutralFacts: candidate.neutralFacts,
      ratingValue: null,
      ratingScale: null,
      reviewsCount: 0,
      confidence: candidate.confidence,
      status: candidate.status,
      isPublic: candidate.isPublic,
      sourceExcerpt: candidate.sourceExcerpt,
      collectedAt: candidate.collectedAt,
      adminNote: candidate.adminNote,
      createdAt: candidate.collectedAt,
      updatedAt: candidate.collectedAt,
    };
  }

  const result = await upsertExternalCompanySource({
    company_slug: candidate.companySlug,
    company_name: candidate.companyName,
    source_name: candidate.sourceName,
    source_url: candidate.sourceUrl,
    source_type: candidate.sourceType,
    title: candidate.title,
    short_summary: candidate.shortSummary,
    positive_points: candidate.positivePoints,
    negative_points: candidate.negativePoints,
    neutral_facts: candidate.neutralFacts,
    confidence: candidate.confidence,
    status: candidate.status,
    is_public: candidate.isPublic,
    source_excerpt: candidate.sourceExcerpt,
    collected_at: candidate.collectedAt,
    admin_note: candidate.adminNote,
  });

  if (!result.ok) {
    throw new Error(result.error);
  }

  return {
    id: result.id ?? `candidate:${candidateHash(candidate)}`,
    companySlug: candidate.companySlug,
    companyName: candidate.companyName,
    sourceName: candidate.sourceName,
    sourceUrl: candidate.sourceUrl,
    sourceType: candidate.sourceType,
    title: candidate.title,
    shortSummary: candidate.shortSummary,
    positivePoints: candidate.positivePoints,
    negativePoints: candidate.negativePoints,
    neutralFacts: candidate.neutralFacts,
    ratingValue: null,
    ratingScale: null,
    reviewsCount: 0,
    confidence: candidate.confidence,
    status: candidate.status,
    isPublic: candidate.isPublic,
    sourceExcerpt: candidate.sourceExcerpt,
    collectedAt: candidate.collectedAt,
    adminNote: candidate.adminNote,
    createdAt: candidate.collectedAt,
    updatedAt: candidate.collectedAt,
  };
}

export async function discoverExternalSourcesForCompany(
  input: DiscoverExternalSourcesInput
): Promise<DiscoverExternalSourcesResult> {
  const companySlug = input.companySlug.trim();
  const companyName = input.companyName.trim();
  const aliases = unique(
    [...(input.aliases ?? []), ...(COMPANY_ALIASES[companySlug] ?? [])],
    (value) => normalizeCompanyName(value)
  );
  const limit = Math.max(1, Math.min(200, Math.trunc(input.limit ?? 50)));
  const warnings: string[] = [];
  const stats: DiscoverExternalSourcesStats = {
    companiesProcessed: 1,
    queriesRun: 0,
    searchResults: 0,
    candidatesFound: 0,
    created: 0,
    skippedDuplicates: 0,
    blocked: 0,
    errors: 0,
  };

  if (!externalSearchIsEnabled()) {
    warnings.push(externalSearchDisabledMessage());
    return { sources: [], warnings, stats };
  }

  const queries = buildQueries(companyName || companySlug, aliases);
  const accepted: CompanySourceCandidate[] = [];
  const seenUrls = new Set<string>();

  for (const query of queries) {
    if (accepted.length >= limit) break;
    stats.queriesRun += 1;

    const { results, warnings: searchWarnings } = await searchExternalSourcesWithWarnings(query);
    warnings.push(...searchWarnings);
    stats.searchResults += results.length;

    for (const result of results) {
      if (accepted.length >= limit) break;

      const normalizedUrl = normalizeCandidateUrl(result.url);
      if (!normalizedUrl) {
        stats.blocked += 1;
        continue;
      }
      if (seenUrls.has(normalizedUrl)) {
        stats.skippedDuplicates += 1;
        continue;
      }
      seenUrls.add(normalizedUrl);

      const mergedText = `${result.title} ${result.snippet} ${normalizedUrl}`;
      if (/facebook|instagram|linkedin|twitter|x\.com|youtube|tiktok|telegram|reddit|vk\.com|threads\.net/i.test(mergedText)) {
        stats.blocked += 1;
        continue;
      }
      if (!normalizeLookupText(mergedText).includes(normalizeLookupText(companyName)) &&
          aliases.every((alias) => !normalizeLookupText(mergedText).includes(normalizeLookupText(alias)))) {
        // Still keep low-confidence results, but avoid obvious off-topic pages.
        const host = hostFromUrl(normalizedUrl);
        if (!host) {
          stats.blocked += 1;
          continue;
        }
      }

      const confidence = candidateConfidence(companyName, aliases, {
        title: result.title,
        snippet: result.snippet,
        url: normalizedUrl,
      });
      const { sourceType, positivePoints, negativePoints, neutralFacts } = inferTopicAndFacts({
        title: result.title,
        snippet: result.snippet,
        url: normalizedUrl,
      });
      const shortSummary = sanitizeText(
        `${result.title} — ${result.snippet}`.trim() || "Зовнішнє джерело про компанію",
        800
      );
      const candidate: CompanySourceCandidate = {
        companySlug,
        companyName,
        sourceName: result.sourceName || sourceNameFromUrl(normalizedUrl),
        sourceUrl: normalizedUrl,
        sourceType,
        title: result.title,
        shortSummary,
        positivePoints,
        negativePoints,
        neutralFacts,
        confidence,
        status: "needs_verification",
        isPublic: false,
        sourceExcerpt: result.snippet.slice(0, 1200),
        adminNote: `discovery query: ${query}`,
        collectedAt: new Date().toISOString(),
      };

      stats.candidatesFound += 1;

      const alreadyExists = await existingSourceExists(candidate);
      if (alreadyExists) {
        stats.skippedDuplicates += 1;
        continue;
      }

      const saved = await saveCandidate(candidate, Boolean(input.dryRun));
      if (!saved) continue;
      accepted.push(candidate);
      if (!input.dryRun) stats.created += 1;
    }
  }

  const sources = accepted.map((candidate) => ({
    id: `candidate:${candidateHash(candidate)}`,
    companySlug: candidate.companySlug,
    companyName: candidate.companyName,
    sourceName: candidate.sourceName,
    sourceUrl: candidate.sourceUrl,
    sourceType: candidate.sourceType,
    title: candidate.title,
    shortSummary: candidate.shortSummary,
    positivePoints: candidate.positivePoints,
    negativePoints: candidate.negativePoints,
    neutralFacts: candidate.neutralFacts,
    ratingValue: null,
    ratingScale: null,
    reviewsCount: 0,
    confidence: candidate.confidence,
    status: candidate.status,
    isPublic: candidate.isPublic,
    sourceExcerpt: candidate.sourceExcerpt,
    collectedAt: candidate.collectedAt,
    adminNote: candidate.adminNote,
    createdAt: candidate.collectedAt,
    updatedAt: candidate.collectedAt,
  } satisfies ExternalCompanySource));

  return { sources, warnings, stats };
}
