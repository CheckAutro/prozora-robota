import { getServiceClient, getServerClient } from "@/lib/supabase/server";
import type {
  ExternalCompanySource,
  ExternalCompanySourceConfidence,
  ExternalCompanySourceStatus,
  ExternalCompanySourceType,
} from "@/lib/types";
import { normalizeExternalUrl, normalizeSourceType, sanitizeText, sourceNameFromUrl, inferSourceTypeFromContent } from "./source-normalizer";
import { readExternalSourceUrl } from "./source-fetcher";

type ExternalCompanySourceRow = Record<string, unknown>;

export interface ExternalCompanySourceSummary {
  companySlug: string;
  sourceCount: number;
  sourceCountLabel: string;
  sources: string[];
  sourceTypes: ExternalCompanySourceType[];
  positiveCount: number;
  negativeCount: number;
  neutralCount: number;
  ratingAverage: number | null;
  totalRatingsCount: number | null;
  topSources: Array<{
    sourceName: string;
    sourceUrl: string | null;
    sourceType: ExternalCompanySourceType;
    title: string | null;
    shortSummary: string;
    ratingValue: number | null;
    ratingScale: number | null;
    reviewsCount: number;
    confidence: ExternalCompanySourceConfidence;
    collectedAt: string | null;
  }>;
  latestCollectedAt: string | null;
}

export type ExternalCompanySourceSummaryBySlug = Record<string, ExternalCompanySourceSummary>;

const SELECT_COLUMNS = [
  "id",
  "company_slug",
  "company_name",
  "source_name",
  "source_url",
  "source_type",
  "title",
  "short_summary",
  "positive_points",
  "negative_points",
  "neutral_facts",
  "rating_value",
  "rating_scale",
  "reviews_count",
  "confidence",
  "status",
  "is_public",
  "source_excerpt",
  "collected_at",
  "admin_note",
  "created_at",
  "updated_at",
].join(", ");

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function textArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toType(value: unknown): ExternalCompanySourceType {
  return normalizeSourceType(value);
}

function toConfidence(value: unknown): ExternalCompanySourceConfidence {
  const text = String(value ?? "").toLowerCase();
  return text === "low" || text === "medium" || text === "high" ? text : "medium";
}

function toStatus(value: unknown): ExternalCompanySourceStatus {
  const text = String(value ?? "").toLowerCase();
  return text === "verified" || text === "rejected" ? text : "needs_verification";
}

function uniqueLimited(items: Array<string | null | undefined>, limit: number): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const value = item?.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
    if (result.length >= limit) break;
  }
  return result;
}

function emptySummary(companySlug: string): ExternalCompanySourceSummary {
  return {
    companySlug,
    sourceCount: 0,
    sourceCountLabel: "поки немає",
    sources: [],
    sourceTypes: [],
    positiveCount: 0,
    negativeCount: 0,
    neutralCount: 0,
    ratingAverage: null,
    totalRatingsCount: null,
    topSources: [],
    latestCollectedAt: null,
  };
}

function scoreRating(value: number | null, scale: number | null): number | null {
  if (value === null || scale === null || !Number.isFinite(value) || !Number.isFinite(scale) || scale <= 0) return null;
  return (value / scale) * 5;
}

function buildSummary(companySlug: string, sources: ExternalCompanySource[]): ExternalCompanySourceSummary {
  if (sources.length === 0) return emptySummary(companySlug);

  const collectedTimes = sources
    .map((source) => source.collectedAt)
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value));
  const latestTime = collectedTimes.length ? Math.max(...collectedTimes) : null;
  const ratingValues = sources
    .map((source) => scoreRating(source.ratingValue, source.ratingScale))
    .filter((value): value is number => value !== null);
  const ratingAverage = ratingValues.length
    ? Math.round((ratingValues.reduce((sum, value) => sum + value, 0) / ratingValues.length) * 10) / 10
    : null;
  const totalRatingsCount = sources.reduce((sum, source) => sum + (source.reviewsCount || 0), 0) || null;

  return {
    companySlug,
    sourceCount: sources.length,
    sourceCountLabel: `${sources.length}`,
    sources: uniqueLimited(sources.map((source) => source.sourceName), 5),
    sourceTypes: uniqueLimited(sources.map((source) => source.sourceType), 5) as ExternalCompanySourceType[],
    positiveCount: sources.reduce((sum, source) => sum + source.positivePoints.length, 0),
    negativeCount: sources.reduce((sum, source) => sum + source.negativePoints.length, 0),
    neutralCount: sources.reduce((sum, source) => sum + source.neutralFacts.length, 0),
    ratingAverage,
    totalRatingsCount,
    topSources: sources
      .slice()
      .sort((a, b) => {
        if (b.reviewsCount !== a.reviewsCount) return b.reviewsCount - a.reviewsCount;
        const aTime = a.collectedAt ? new Date(a.collectedAt).getTime() : 0;
        const bTime = b.collectedAt ? new Date(b.collectedAt).getTime() : 0;
        return bTime - aTime;
      })
      .slice(0, 3)
      .map((source) => ({
        sourceName: source.sourceName,
        sourceUrl: source.sourceUrl,
        sourceType: source.sourceType,
        title: source.title,
        shortSummary: source.shortSummary,
        ratingValue: source.ratingValue,
        ratingScale: source.ratingScale,
        reviewsCount: source.reviewsCount,
        confidence: source.confidence,
        collectedAt: source.collectedAt,
      })),
    latestCollectedAt: latestTime === null ? null : new Date(latestTime).toISOString(),
  };
}

export function rowToExternalCompanySource(row: ExternalCompanySourceRow): ExternalCompanySource {
  return {
    id: String(row.id),
    companySlug: String(row.company_slug),
    companyName: String(row.company_name),
    sourceName: String(row.source_name),
    sourceUrl: textOrNull(row.source_url),
    sourceType: toType(row.source_type),
    title: textOrNull(row.title),
    shortSummary: String(row.short_summary ?? "").trim(),
    positivePoints: textArray(row.positive_points),
    negativePoints: textArray(row.negative_points),
    neutralFacts: textArray(row.neutral_facts),
    ratingValue: numberOrNull(row.rating_value),
    ratingScale: numberOrNull(row.rating_scale),
    reviewsCount: Math.max(0, Math.trunc(numberOrNull(row.reviews_count) ?? 0)),
    confidence: toConfidence(row.confidence),
    status: toStatus(row.status),
    isPublic: Boolean(row.is_public),
    sourceExcerpt: textOrNull(row.source_excerpt),
    collectedAt: textOrNull(row.collected_at),
    adminNote: textOrNull(row.admin_note),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function isMissingTableError(error: { code?: string; message?: string } | null): boolean {
  return error?.code === "42P01" || /external_company_sources/i.test(error?.message ?? "");
}

export function externalCompanySourcesTableMissing(error: { code?: string; message?: string } | null): boolean {
  return isMissingTableError(error);
}

export async function getPublicCompanyExternalSources(companySlug: string): Promise<ExternalCompanySource[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!url || !key) return [];

  try {
    const client = getServerClient();
    const { data, error } = await client
      .from("external_company_sources")
      .select(SELECT_COLUMNS)
      .eq("company_slug", companySlug)
      .eq("status", "verified")
      .eq("is_public", true)
      .order("collected_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });

    if (error || !data) return [];
    return data.map((row) => rowToExternalCompanySource(row as unknown as ExternalCompanySourceRow));
  } catch {
    return [];
  }
}

export async function getPublicCompanyExternalSourceSummary(
  companySlug: string
): Promise<ExternalCompanySourceSummary> {
  const sources = await getPublicCompanyExternalSources(companySlug);
  return buildSummary(companySlug, sources);
}

export async function getPublicCompanyExternalSourceSummariesForCompanies(): Promise<ExternalCompanySourceSummaryBySlug> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!url || !key) return {};

  try {
    const client = getServerClient();
    const { data, error } = await client
      .from("external_company_sources")
      .select(SELECT_COLUMNS)
      .eq("status", "verified")
      .eq("is_public", true);

    if (error || !data) return {};

    const grouped: Record<string, ExternalCompanySource[]> = {};
    for (const row of data as unknown as ExternalCompanySourceRow[]) {
      const source = rowToExternalCompanySource(row);
      if (!grouped[source.companySlug]) grouped[source.companySlug] = [];
      grouped[source.companySlug].push(source);
    }

    const result: ExternalCompanySourceSummaryBySlug = {};
    for (const [companySlug, items] of Object.entries(grouped)) {
      result[companySlug] = buildSummary(companySlug, items);
    }
    return result;
  } catch {
    return {};
  }
}

export async function getAdminCompanyExternalSources(): Promise<ExternalCompanySource[]> {
  try {
    const client = getServiceClient();
    const { data, error } = await client
      .from("external_company_sources")
      .select(SELECT_COLUMNS)
      .order("created_at", { ascending: false })
      .limit(400);

    if (error || !data) return [];
    return data.map((row) => rowToExternalCompanySource(row as unknown as ExternalCompanySourceRow));
  } catch {
    return [];
  }
}

function detectPoints(text: string): { positive: string[]; negative: string[]; neutral: string[] } {
  const lower = text.toLowerCase();
  const positive: string[] = [];
  const negative: string[] = [];
  const neutral: string[] = [];

  if (/офіцій|оформл|contract|contracting/.test(lower)) positive.push("Згадується офіційне оформлення.");
  if (/ставка|salary|зарплат|оплата/.test(lower)) neutral.push("У джерелі згадується оплата або зарплата.");
  if (/бронюван|відстроч/.test(lower)) neutral.push("Є згадка про бронювання або відстрочку.");
  if (/позитив|добре|вигідн|прозор/.test(lower)) positive.push("Є позитивна згадка про умови.");
  if (/затрим|штраф|негатив|важк|поган|плинність|перевантаж/.test(lower)) negative.push("Є негативна або ризикова згадка.");
  return { positive, negative, neutral };
}

function toShortSummaryFromFetched(title: string | null, description: string | null, text: string | null): string {
  const base = [title, description, text ? text.slice(0, 220) : null].filter(Boolean).join(" — ");
  return sanitizeText(base || "Зовнішнє джерело про компанію", 600);
}

export async function upsertExternalCompanySource(
  input: {
    company_slug: string;
    company_name: string;
    source_name: string;
    source_url?: string | null;
    source_type?: ExternalCompanySourceType;
    title?: string | null;
    short_summary: string;
    positive_points?: string[];
    negative_points?: string[];
    neutral_facts?: string[];
    rating_value?: number | null;
    rating_scale?: number | null;
    reviews_count?: number | null;
    confidence?: ExternalCompanySourceConfidence;
    status?: ExternalCompanySourceStatus;
    is_public?: boolean;
    source_excerpt?: string | null;
    collected_at?: string | null;
    admin_note?: string | null;
  }
): Promise<{ ok: true; created: boolean; id?: string } | { ok: false; error: string; missingTable?: boolean }> {
  try {
    const client = getServiceClient();
    const sourceType = input.source_type ?? "other";
    const payload = {
      company_slug: input.company_slug,
      company_name: input.company_name,
      source_name: input.source_name,
      source_url: input.source_url ?? null,
      source_type: sourceType,
      title: input.title ?? null,
      short_summary: input.short_summary,
      positive_points: input.positive_points ?? [],
      negative_points: input.negative_points ?? [],
      neutral_facts: input.neutral_facts ?? [],
      rating_value: input.rating_value ?? null,
      rating_scale: input.rating_scale ?? 5,
      reviews_count: input.reviews_count ?? 0,
      confidence: input.confidence ?? "medium",
      status: input.status ?? "needs_verification",
      is_public: input.is_public ?? false,
      source_excerpt: input.source_excerpt ?? null,
      collected_at: input.collected_at ?? null,
      admin_note: input.admin_note ?? null,
    };

    let existingQuery = client
      .from("external_company_sources")
      .select("id")
      .eq("company_slug", payload.company_slug)
      .eq("source_name", payload.source_name)
      .eq("source_type", payload.source_type);
    existingQuery = payload.source_url === null
      ? existingQuery.is("source_url", null)
      : existingQuery.eq("source_url", payload.source_url);
    existingQuery = payload.title === null
      ? existingQuery.is("title", null)
      : existingQuery.eq("title", payload.title);

    const { data: existing, error: existingError } = await existingQuery.maybeSingle();

    if (existingError) {
      return { ok: false, error: existingError.message, missingTable: isMissingTableError(existingError) };
    }

    if (existing?.id) {
      const { error } = await client
        .from("external_company_sources")
        .update(payload)
        .eq("id", existing.id);
      if (error) return { ok: false, error: error.message, missingTable: isMissingTableError(error) };
      return { ok: true, created: false, id: String(existing.id) };
    }

    const { data, error } = await client
      .from("external_company_sources")
      .insert(payload)
      .select("id")
      .single();
    if (error) return { ok: false, error: error.message, missingTable: isMissingTableError(error) };
    return { ok: true, created: true, id: typeof data?.id === "string" ? data.id : undefined };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function collectExternalCompanySignals(input: {
  companySlug: string;
  companyName: string;
  sourceUrls: string[];
  sourceName?: string | null;
  sourceType?: ExternalCompanySourceType | null;
}): Promise<{ sources: ExternalCompanySource[]; warnings: string[] }> {
  const warnings: string[] = [];
  const sources: ExternalCompanySource[] = [];
  const uniqueUrls = Array.from(new Set(input.sourceUrls.map((value) => normalizeExternalUrl(value, false)).filter(Boolean) as string[]));

  for (const sourceUrl of uniqueUrls) {
    const fetched = await readExternalSourceUrl(sourceUrl, { allowAnyPublicHost: true, timeoutMs: 8000, maxBytes: 1024 * 1024 });
    if (fetched.status !== "success") {
      warnings.push(`${sourceUrl} -> ${fetched.reason ?? fetched.status}`);
      continue;
    }

    const summary = toShortSummaryFromFetched(fetched.title ?? null, fetched.description ?? null, fetched.text ?? null);
    const points = detectPoints(summary);
    const sourceType = input.sourceType ?? inferSourceTypeFromContent(fetched.title ?? null, fetched.description ?? null, sourceUrl);
    const result = await upsertExternalCompanySource({
      company_slug: input.companySlug,
      company_name: input.companyName,
      source_name: input.sourceName ?? fetched.sourceName ?? sourceNameFromUrl(sourceUrl),
      source_url: sourceUrl,
      source_type: sourceType,
      title: fetched.title ?? null,
      short_summary: summary,
      positive_points: points.positive,
      negative_points: points.negative,
      neutral_facts: points.neutral,
      confidence: points.negative.length > 0 ? "medium" : "low",
      status: "needs_verification",
      is_public: false,
      source_excerpt: fetched.text?.slice(0, 1200) ?? null,
      admin_note: `Collected from ${sourceUrl}`,
    });
    if (!result.ok) {
      warnings.push(`${sourceUrl} -> ${result.error}`);
      continue;
    }

    sources.push({
      id: result.id ?? sourceUrl,
      companySlug: input.companySlug,
      companyName: input.companyName,
      sourceName: input.sourceName ?? fetched.sourceName ?? sourceNameFromUrl(sourceUrl),
      sourceUrl,
      sourceType,
      title: fetched.title ?? null,
      shortSummary: summary,
      positivePoints: points.positive,
      negativePoints: points.negative,
      neutralFacts: points.neutral,
      ratingValue: null,
      ratingScale: 5,
      reviewsCount: 0,
      confidence: points.negative.length > 0 ? "medium" : "low",
      status: "needs_verification",
      isPublic: false,
      sourceExcerpt: fetched.text?.slice(0, 1200) ?? null,
      collectedAt: new Date().toISOString(),
      adminNote: `Collected from ${sourceUrl}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  return { sources, warnings };
}
