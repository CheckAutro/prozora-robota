import { loadEnvConfig } from "@next/env";
import { getServiceClient } from "@/lib/supabase/server";
import { findBestCompanyMatch, generateCompanySlug, isConfidentCompanyMatch, normalizeCompanyName } from "@/lib/company-matching";
import { sanitizeText, inferSourceTypeFromContent, sourceNameFromUrl } from "@/lib/external/source-normalizer";
import { TOPIC_LABELS, SENTIMENT_LABELS } from "@/lib/external-review-signals-service";
import {
  externalCompanySourcesTableMissing,
  upsertExternalCompanySource,
} from "@/lib/external/company-sources";
import type { ExternalCompanySourceType } from "@/lib/types";

loadEnvConfig(process.cwd());

type CompanyRow = { slug: string; name: string };
type ExternalSignalRow = Record<string, unknown>;
type CompanyDiscoveryRow = Record<string, unknown>;

function isDryRun(): boolean {
  return process.argv.includes("--dry-run");
}

function clean(value: unknown, limit = 800): string {
  if (typeof value !== "string") return "";
  return sanitizeText(value, limit);
}

function compactText(values: Array<string | null | undefined>, fallback: string): string {
  const joined = values
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean)
    .join(" ");
  const summary = sanitizeText(joined, 800);
  return summary.length >= 20 ? summary : fallback;
}

function detectPoints(text: string): { positive: string[]; negative: string[]; neutral: string[] } {
  const lower = text.toLowerCase();
  const positive: string[] = [];
  const negative: string[] = [];
  const neutral: string[] = [];

  if (/офіцій|оформл|contract|бронюван|відстроч/.test(lower)) positive.push("Згадується офіційне оформлення або бронювання.");
  if (/ставка|salary|зарплат|оплата/.test(lower)) neutral.push("У джерелі згадується оплата або зарплата.");
  if (/позитив|добре|вигідн|прозор|команда/.test(lower)) positive.push("Є позитивна згадка про умови або команду.");
  if (/затрим|штраф|негатив|важк|поган|плинність|перевантаж|конфлікт/.test(lower)) negative.push("Є ризикова або негативна згадка.");
  if (positive.length === 0 && negative.length === 0) neutral.push("Є відкритий факт або коротке узагальнення.");
  return { positive, negative, neutral };
}

function sourceTypeFromOpenFact(row: Record<string, unknown>): ExternalCompanySourceType {
  const title = clean(row.vacancy_title, 180).toLowerCase();
  const excerpt = clean(row.raw_excerpt, 300).toLowerCase();
  const sourceName = clean(row.source_name, 80);
  if (title.startsWith("сторінка компанії") || excerpt.includes("компанія має сторінку")) return "company_page";
  if (/work\.ua|robota\.ua/.test(sourceName.toLowerCase())) return "vacancy";
  if (title || excerpt) return "vacancy";
  return "other";
}

function sourceTypeFromSignalType(signalType: string): ExternalCompanySourceType {
  if (["salary_delay", "unclear_salary", "schedule_risk", "overload", "official_employment_issue", "interview_issue", "management_issue", "positive_team", "positive_salary", "positive_conditions"].includes(signalType)) {
    return "reviews";
  }
  if (["booking_info", "internship_info"].includes(signalType)) return "vacancy";
  return "other";
}

function sourceTypeFromQueue(row: CompanyDiscoveryRow): ExternalCompanySourceType {
  const sourceUrl = clean(row.source_url, 500);
  const description = clean(row.description, 300);
  const excerpt = clean(row.raw_excerpt, 300);
  return inferSourceTypeFromContent(description, excerpt, sourceUrl || "https://prozora-robota.vercel.app");
}

async function loadCompanyIndex(): Promise<{ bySlug: Map<string, CompanyRow>; byName: Map<string, CompanyRow> }> {
  const client = getServiceClient();
  const { data, error } = await client.from("companies").select("slug, name");
  if (error) throw new Error(error.message);

  const bySlug = new Map<string, CompanyRow>();
  const byName = new Map<string, CompanyRow>();
  for (const row of (data ?? []) as CompanyRow[]) {
    bySlug.set(row.slug, row);
    byName.set(normalizeCompanyName(row.name).toLowerCase(), row);
    byName.set(generateCompanySlug(row.name), row);
  }
  return { bySlug, byName };
}

function resolveCompanySlug(
  rowCompanySlug: string | null,
  rowCompanyName: string | null,
  index: { bySlug: Map<string, CompanyRow>; byName: Map<string, CompanyRow> }
): string | null {
  if (rowCompanySlug) {
    const trimmed = rowCompanySlug.trim();
    if (index.bySlug.has(trimmed)) return trimmed;
    const normalized = generateCompanySlug(trimmed);
    if (normalized && index.bySlug.has(normalized)) return normalized;
  }

  if (rowCompanyName) {
    const normalizedName = normalizeCompanyName(rowCompanyName).toLowerCase();
    if (index.byName.has(normalizedName)) return index.byName.get(normalizedName)!.slug;

    const generatedSlug = generateCompanySlug(rowCompanyName);
    if (generatedSlug && index.bySlug.has(generatedSlug)) return index.bySlug.get(generatedSlug)!.slug;

    const match = findBestCompanyMatch(rowCompanyName, Array.from(index.bySlug.values()));
    if (isConfidentCompanyMatch(match) && match.company) return match.company.slug;
  }

  return null;
}

async function externalCompanySourceExists(input: {
  companySlug: string;
  sourceName: string;
  sourceType: ExternalCompanySourceType;
  sourceUrl: string | null;
  title: string | null;
}): Promise<boolean> {
  const client = getServiceClient();
  let query = client
    .from("external_company_sources")
    .select("id")
    .eq("company_slug", input.companySlug)
    .eq("source_name", input.sourceName)
    .eq("source_type", input.sourceType);
  query = input.sourceUrl === null ? query.is("source_url", null) : query.eq("source_url", input.sourceUrl);
  query = input.title === null ? query.is("title", null) : query.eq("title", input.title);
  const { data, error } = await query.maybeSingle();
  if (error) {
    if (externalCompanySourcesTableMissing(error)) throw new Error("Run Supabase migration 20240108_external_company_sources.sql first");
    throw new Error(error.message);
  }
  return Boolean(data?.id);
}

async function upsertBackfillSource(
  payload: Parameters<typeof upsertExternalCompanySource>[0],
  dryRun: boolean
): Promise<"created" | "updated"> {
  const existed = await externalCompanySourceExists({
    companySlug: payload.company_slug,
    sourceName: payload.source_name,
    sourceType: payload.source_type ?? "other",
    sourceUrl: payload.source_url ?? null,
    title: payload.title ?? null,
  });

  if (dryRun) {
    return existed ? "updated" : "created";
  }

  const result = await upsertExternalCompanySource(payload);
  if (!result.ok) {
    if (result.missingTable) {
      throw new Error("Run Supabase migration 20240108_external_company_sources.sql first");
    }
    throw new Error(result.error);
  }
  return existed ? "updated" : "created";
}

async function main() {
  const dryRun = isDryRun();
  const client = getServiceClient();
  const companyIndex = await loadCompanyIndex();

  const tableCheck = await client.from("external_company_sources").select("id").limit(1);
  if (tableCheck.error) {
    if (externalCompanySourcesTableMissing(tableCheck.error)) {
      console.error("Run Supabase migration 20240108_external_company_sources.sql first");
      process.exitCode = 1;
      return;
    }
    throw new Error(tableCheck.error.message);
  }

  const stats = {
    createdVerifiedPublic: 0,
    createdNeedsVerification: 0,
    updatedOrSkipped: 0,
    missingCompanySlugs: [] as string[],
    errors: [] as Array<{ source: string; error: string }>,
  };

  const [
    openFacts,
    ratings,
    reviewSignals,
    legacySignals,
    discoveryQueue,
  ] = await Promise.all([
    client
      .from("company_open_facts")
      .select("company_slug, company_name, source_name, source_url, vacancy_title, city, salary_text, employment_type, schedule, company_description, vacancy_description, raw_excerpt, collected_at, status, is_public")
      .eq("status", "verified")
      .eq("is_public", true),
    client
      .from("external_ratings")
      .select("company_slug, company_name, source_name, source_url, rating_value, rating_scale, reviews_count, fetched_at, note, collected_at, status, is_public")
      .eq("status", "verified")
      .eq("is_public", true),
    client
      .from("external_review_signals")
      .select("company_slug, company_name, source_name, source_url, topic, sentiment, summary, mentions_count, sample_size, confidence, collected_at, status, is_public")
      .eq("status", "verified")
      .eq("is_public", true),
    client
      .from("external_signals")
      .select("company_slug, company_name, short_summary, signal_type, source_name, source_url, status, is_public, created_at")
      .eq("status", "verified")
      .eq("is_public", true),
    client
      .from("company_discovery_queue")
      .select("discovered_name, suggested_slug, source_name, source_url, city, industry, description, company_size, matched_existing_slug, match_confidence, status, is_imported, imported_company_slug, raw_excerpt, collected_at, admin_note, created_at")
      .neq("status", "rejected"),
  ]);

  const sources: Array<{
    origin: string;
    companySlug: string;
    companyName: string;
    sourceName: string;
    sourceUrl: string | null;
    sourceType: ExternalCompanySourceType;
    title: string | null;
    shortSummary: string;
    positivePoints: string[];
    negativePoints: string[];
    neutralFacts: string[];
    ratingValue: number | null;
    ratingScale: number | null;
    reviewsCount: number;
    confidence: "low" | "medium" | "high";
    status: "needs_verification" | "verified" | "rejected";
    isPublic: boolean;
    sourceExcerpt: string | null;
    collectedAt: string | null;
    adminNote: string | null;
  }> = [];

  for (const row of (openFacts.data ?? []) as Record<string, unknown>[]) {
    const companySlug = resolveCompanySlug(
      typeof row.company_slug === "string" ? row.company_slug : null,
      typeof row.company_name === "string" ? row.company_name : null,
      companyIndex
    );
    if (!companySlug) {
      stats.missingCompanySlugs.push(clean(row.company_name, 100) || clean(row.company_slug, 100) || "open_facts");
      continue;
    }
    const sourceName = clean(row.source_name, 80);
    const sourceUrl = clean(row.source_url, 500) || null;
    const title = clean(row.vacancy_title, 160) || (sourceUrl ? `Сторінка компанії на ${sourceName}` : sourceName);
    const sourceType = sourceTypeFromOpenFact(row);
    const summary = compactText(
      [clean(row.company_description, 220), clean(row.vacancy_description, 260), clean(row.raw_excerpt, 260)],
      sourceType === "company_page"
        ? `Є сторінка компанії у відкритому джерелі ${sourceName}.`
        : `Є дані з відкритої вакансії ${sourceName}.`
    );
    const points = detectPoints(summary);
    sources.push({
      origin: "company_open_facts",
      companySlug,
      companyName: clean(row.company_name, 160),
      sourceName,
      sourceUrl,
      sourceType,
      title,
      shortSummary: summary,
      positivePoints: points.positive,
      negativePoints: points.negative,
      neutralFacts: points.neutral,
      ratingValue: null,
      ratingScale: 5,
      reviewsCount: 0,
      confidence: "high",
      status: "verified",
      isPublic: true,
      sourceExcerpt: clean(row.raw_excerpt, 1200) || null,
      collectedAt: clean(row.collected_at, 80) || null,
      adminNote: "Backfilled from company_open_facts",
    });
  }

  for (const row of (ratings.data ?? []) as Record<string, unknown>[]) {
    const companySlug = resolveCompanySlug(
      typeof row.company_slug === "string" ? row.company_slug : null,
      typeof row.company_name === "string" ? row.company_name : null,
      companyIndex
    );
    if (!companySlug) {
      stats.missingCompanySlugs.push(clean(row.company_name, 100) || clean(row.company_slug, 100) || "external_ratings");
      continue;
    }
    const sourceName = clean(row.source_name, 80);
    const sourceUrl = clean(row.source_url, 500) || null;
    const ratingValue = typeof row.rating_value === "number" ? row.rating_value : null;
    const ratingScale = typeof row.rating_scale === "number" ? row.rating_scale : 5;
    const summary = compactText(
      [
        ratingValue !== null ? `Оцінка ${ratingValue.toFixed(1)} / ${ratingScale}.` : null,
        typeof row.reviews_count === "number" || typeof row.reviews_count === "string"
          ? `Кількість оцінок: ${Number(row.reviews_count ?? 0)}.`
          : null,
        clean(row.note, 200),
      ],
      `Підтверджена зовнішня оцінка ${sourceName}.`
    );
    const points = ratingValue !== null && ratingScale > 0
      ? ratingValue >= 4
        ? { positive: ["Висока зовнішня оцінка."], negative: [], neutral: [] }
        : ratingValue <= 2
          ? { positive: [], negative: ["Низька зовнішня оцінка."], neutral: [] }
          : { positive: [], negative: [], neutral: ["Середня зовнішня оцінка."] }
      : detectPoints(summary);
    sources.push({
      origin: "external_ratings",
      companySlug,
      companyName: clean(row.company_name, 160),
      sourceName,
      sourceUrl,
      sourceType: "rating",
      title: "Підтверджена зовнішня оцінка",
      shortSummary: summary,
      positivePoints: points.positive,
      negativePoints: points.negative,
      neutralFacts: points.neutral,
      ratingValue,
      ratingScale,
      reviewsCount: Math.max(0, Math.trunc(Number(row.reviews_count ?? 0))),
      confidence: "high",
      status: "verified",
      isPublic: true,
      sourceExcerpt: clean(row.note, 1200) || null,
      collectedAt: clean(row.fetched_at, 80) || clean(row.collected_at, 80) || null,
      adminNote: "Backfilled from external_ratings",
    });
  }

  for (const row of (reviewSignals.data ?? []) as Record<string, unknown>[]) {
    const companySlug = resolveCompanySlug(
      typeof row.company_slug === "string" ? row.company_slug : null,
      typeof row.company_name === "string" ? row.company_name : null,
      companyIndex
    );
    if (!companySlug) {
      stats.missingCompanySlugs.push(clean(row.company_name, 100) || clean(row.company_slug, 100) || "external_review_signals");
      continue;
    }
    const sourceName = clean(row.source_name, 80);
    const sourceUrl = clean(row.source_url, 500) || null;
    const topic = clean(row.topic, 80) || "other";
    const sentiment = clean(row.sentiment, 80) || "neutral";
    const title = `${TOPIC_LABELS[topic as keyof typeof TOPIC_LABELS] ?? topic}: ${SENTIMENT_LABELS[sentiment as keyof typeof SENTIMENT_LABELS] ?? sentiment}`;
    const summary = compactText(
      [clean(row.summary, 260), `Тема: ${topic}.`, `Тональність: ${sentiment}.`],
      "Узагальнення зовнішніх відгуків."
    );
    const points = /positive/i.test(sentiment)
      ? { positive: [summary], negative: [], neutral: [] }
      : sentiment === "negative"
        ? { positive: [], negative: [summary], neutral: [] }
        : sentiment === "mixed"
          ? { positive: [], negative: [], neutral: [summary] }
          : detectPoints(summary);
    sources.push({
      origin: "external_review_signals",
      companySlug,
      companyName: clean(row.company_name, 160),
      sourceName,
      sourceUrl,
      sourceType: "reviews",
      title,
      shortSummary: summary,
      positivePoints: points.positive,
      negativePoints: points.negative,
      neutralFacts: points.neutral,
      ratingValue: null,
      ratingScale: 5,
      reviewsCount: Math.max(0, Math.trunc(Number(row.mentions_count ?? 1))),
      confidence: (clean(row.confidence, 20) as "low" | "medium" | "high") || "medium",
      status: "verified",
      isPublic: true,
      sourceExcerpt: clean(row.summary, 1200) || null,
      collectedAt: clean(row.collected_at, 80) || null,
      adminNote: "Backfilled from external_review_signals",
    });
  }

  for (const row of (legacySignals.data ?? []) as Record<string, unknown>[]) {
    const companySlug = resolveCompanySlug(
      typeof row.company_slug === "string" ? row.company_slug : null,
      typeof row.company_name === "string" ? row.company_name : null,
      companyIndex
    );
    if (!companySlug) {
      stats.missingCompanySlugs.push(clean(row.company_name, 100) || clean(row.company_slug, 100) || "external_signals");
      continue;
    }
    const sourceName = clean(row.source_name, 80) || "Зовнішній сигнал";
    const sourceUrl = clean(row.source_url, 500) || null;
    const signalType = clean(row.signal_type, 80) || "other";
    const sourceType = sourceTypeFromSignalType(signalType);
    const shortSummary = compactText(
      [clean(row.short_summary, 300)],
      `Узагальнений сигнал: ${signalType}.`
    );
    const points = detectPoints(shortSummary);
    sources.push({
      origin: "external_signals",
      companySlug,
      companyName: clean(row.company_name, 160),
      sourceName,
      sourceUrl,
      sourceType,
      title: `Сигнал: ${signalType}`,
      shortSummary,
      positivePoints: points.positive,
      negativePoints: points.negative,
      neutralFacts: points.neutral,
      ratingValue: null,
      ratingScale: 5,
      reviewsCount: 0,
      confidence: "medium",
      status: "verified",
      isPublic: true,
      sourceExcerpt: clean(row.short_summary, 1200) || null,
      collectedAt: clean(row.created_at, 80) || null,
      adminNote: "Backfilled from external_signals",
    });
  }

  for (const row of (discoveryQueue.data ?? []) as CompanyDiscoveryRow[]) {
    const sourceUrl = clean(row.source_url, 500) || null;
    if (!sourceUrl) continue;
    const companySlug = resolveCompanySlug(
      typeof row.matched_existing_slug === "string" ? row.matched_existing_slug : null,
      typeof row.discovered_name === "string" ? row.discovered_name : null,
      companyIndex
    );
    if (!companySlug) {
      stats.missingCompanySlugs.push(clean(row.discovered_name, 100) || clean(row.suggested_slug, 100) || "company_discovery_queue");
      continue;
    }
    const companyName = clean(row.discovered_name, 160) || companyIndex.bySlug.get(companySlug)?.name || companySlug;
    const sourceType = sourceTypeFromQueue(row);
    const sourceName = clean(row.source_name, 80) || sourceNameFromUrl(sourceUrl);
    const shortSummary = compactText(
      [clean(row.description, 240), clean(row.raw_excerpt, 240), `Дані з черги знайдених компаній.`],
      `Компанія у черзі відкритих джерел: ${companyName}.`
    );
    const points = detectPoints(shortSummary);
    sources.push({
      origin: "company_discovery_queue",
      companySlug,
      companyName,
      sourceName,
      sourceUrl,
      sourceType,
      title: `Черга компаній: ${companyName}`,
      shortSummary,
      positivePoints: points.positive,
      negativePoints: points.negative,
      neutralFacts: points.neutral,
      ratingValue: null,
      ratingScale: 5,
      reviewsCount: 0,
      confidence: (clean(row.match_confidence, 20) as "low" | "medium" | "high") || "low",
      status: "needs_verification",
      isPublic: false,
      sourceExcerpt: clean(row.raw_excerpt, 1200) || null,
      collectedAt: clean(row.collected_at, 80) || clean(row.created_at, 80) || null,
      adminNote: clean(row.admin_note, 240) || "Backfilled from company_discovery_queue",
    });
  }

  for (const source of sources) {
    try {
      if (dryRun) {
        const action = await upsertBackfillSource(
          {
            company_slug: source.companySlug,
            company_name: source.companyName,
            source_name: source.sourceName,
            source_url: source.sourceUrl,
            source_type: source.sourceType,
            title: source.title,
            short_summary: source.shortSummary,
            positive_points: source.positivePoints,
            negative_points: source.negativePoints,
            neutral_facts: source.neutralFacts,
            rating_value: source.ratingValue,
            rating_scale: source.ratingScale,
            reviews_count: source.reviewsCount,
            confidence: source.confidence,
            status: source.status,
            is_public: source.isPublic,
            source_excerpt: source.sourceExcerpt,
            collected_at: source.collectedAt,
            admin_note: source.adminNote,
          },
          true
        );
        if (action === "created") stats.createdVerifiedPublic += source.isPublic ? 1 : 0;
        else stats.createdNeedsVerification += source.isPublic ? 0 : 1;
        stats.updatedOrSkipped += action === "updated" ? 1 : 0;
      } else {
        const action = await upsertBackfillSource(
          {
            company_slug: source.companySlug,
            company_name: source.companyName,
            source_name: source.sourceName,
            source_url: source.sourceUrl,
            source_type: source.sourceType,
            title: source.title,
            short_summary: source.shortSummary,
            positive_points: source.positivePoints,
            negative_points: source.negativePoints,
            neutral_facts: source.neutralFacts,
            rating_value: source.ratingValue,
            rating_scale: source.ratingScale,
            reviews_count: source.reviewsCount,
            confidence: source.confidence,
            status: source.status,
            is_public: source.isPublic,
            source_excerpt: source.sourceExcerpt,
            collected_at: source.collectedAt,
            admin_note: source.adminNote,
          },
          false
        );
        if (source.isPublic) {
          if (action === "created") stats.createdVerifiedPublic += 1;
        } else if (action === "created") {
          stats.createdNeedsVerification += 1;
        }
        if (action === "updated") stats.updatedOrSkipped += 1;
      }
    } catch (error) {
      stats.errors.push({ source: `${source.origin}:${source.sourceName}`, error: error instanceof Error ? error.message : String(error) });
    }
  }

  console.info("[backfill-external-sources] completed", {
    dryRun,
    createdVerifiedPublic: stats.createdVerifiedPublic,
    createdNeedsVerification: stats.createdNeedsVerification,
    updatedOrSkipped: stats.updatedOrSkipped,
    missingCompanySlugs: stats.missingCompanySlugs.length,
    errors: stats.errors.length,
  });

  console.log(`created verified+public: ${stats.createdVerifiedPublic}`);
  console.log(`created needs_verification/private: ${stats.createdNeedsVerification}`);
  console.log(`updated/skipped: ${stats.updatedOrSkipped}`);
  console.log(`missing company slugs: ${stats.missingCompanySlugs.length}`);
  console.log(`errors: ${stats.errors.length}`);
  if (stats.missingCompanySlugs.length > 0) {
    console.log(`missing company slugs sample: ${stats.missingCompanySlugs.slice(0, 10).join(", ")}`);
  }
  if (stats.errors.length > 0) {
    for (const error of stats.errors.slice(0, 20)) {
      console.log(`error: ${error.source} -> ${error.error}`);
    }
  }

  if (dryRun) {
    console.log("dry run: no rows were written");
  }
}

main().catch((error) => {
  console.error("[backfill-external-sources] failed:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
