// Server helpers for public.external_ratings.
// External ratings are reference data only and are never merged into reviews.

import { getServerClient, getServiceClient } from "./supabase/server";
import type { ExternalRating } from "./types";

type ExternalRatingRow = Record<string, unknown>;

export interface ExternalRatingSummary {
  companySlug: string;
  sourceCount: number;
  averageRating: number | null;
  totalRatingsCount: number | null;
  sources: string[];
}

export type ExternalRatingSummaryBySlug = Record<string, ExternalRatingSummary>;

const SELECT_COLUMNS = [
  "id",
  "company_slug",
  "company_name",
  "source_name",
  "source_url",
  "rating_value",
  "rating_scale",
  "reviews_count",
  "fetched_at",
  "status",
  "is_public",
  "note",
  "created_at",
  "updated_at",
].join(", ");

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function rowToExternalRating(row: ExternalRatingRow): ExternalRating {
  return {
    id: String(row.id),
    companySlug: String(row.company_slug),
    companyName: String(row.company_name),
    sourceName: String(row.source_name),
    sourceUrl: row.source_url ? String(row.source_url) : null,
    ratingValue: toNumber(row.rating_value),
    ratingScale: toNumber(row.rating_scale),
    reviewsCount: Math.max(0, Math.trunc(toNumber(row.reviews_count) ?? 0)),
    fetchedAt: row.fetched_at ? String(row.fetched_at) : null,
    status: row.status === "verified" || row.status === "rejected"
      ? row.status
      : "needs_verification",
    isPublic: Boolean(row.is_public),
    note: row.note ? String(row.note) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export async function getPublicExternalRatings(
  companySlug: string
): Promise<ExternalRating[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!url || !key) return [];

  try {
    const client = getServerClient();
    const { data, error } = await client
      .from("external_ratings")
      .select(SELECT_COLUMNS)
      .eq("company_slug", companySlug)
      .eq("status", "verified")
      .eq("is_public", true)
      .order("fetched_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });

    if (error || !data) return [];
    return data.map((row) => rowToExternalRating(row as unknown as ExternalRatingRow));
  } catch {
    return [];
  }
}

export async function getPublicExternalRatingSummaries(): Promise<ExternalRatingSummaryBySlug> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!url || !key) return {};

  try {
    const client = getServerClient();
    const { data, error } = await client
      .from("external_ratings")
      .select("company_slug, source_name, rating_value, rating_scale, reviews_count")
      .eq("status", "verified")
      .eq("is_public", true);

    if (error || !data) return {};

    const grouped: Record<string, {
      sources: Set<string>;
      normalizedRatings: number[];
      totalRatingsCount: number;
    }> = {};

    for (const row of data as ExternalRatingRow[]) {
      const companySlug = row.company_slug ? String(row.company_slug) : "";
      const sourceName = row.source_name ? String(row.source_name) : "";
      if (!companySlug || !sourceName) continue;

      if (!grouped[companySlug]) {
        grouped[companySlug] = {
          sources: new Set<string>(),
          normalizedRatings: [],
          totalRatingsCount: 0,
        };
      }

      grouped[companySlug].sources.add(sourceName);

      const ratingValue = toNumber(row.rating_value);
      const ratingScale = toNumber(row.rating_scale) ?? 5;
      if (ratingValue !== null && ratingScale > 0) {
        grouped[companySlug].normalizedRatings.push((ratingValue / ratingScale) * 5);
      }

      const reviewsCount = Math.max(0, Math.trunc(toNumber(row.reviews_count) ?? 0));
      grouped[companySlug].totalRatingsCount += reviewsCount;
    }

    const result: ExternalRatingSummaryBySlug = {};
    for (const [companySlug, summary] of Object.entries(grouped)) {
      const average = summary.normalizedRatings.length
        ? summary.normalizedRatings.reduce((sum, value) => sum + value, 0) / summary.normalizedRatings.length
        : null;
      const sources = Array.from(summary.sources);

      result[companySlug] = {
        companySlug,
        sourceCount: sources.length,
        averageRating: average === null ? null : Math.round(average * 10) / 10,
        totalRatingsCount: summary.totalRatingsCount > 0 ? summary.totalRatingsCount : null,
        sources: sources.slice(0, 3),
      };
    }

    return result;
  } catch {
    return {};
  }
}

export async function getAdminExternalRatings(): Promise<ExternalRating[]> {
  try {
    const client = getServiceClient();
    const { data, error } = await client
      .from("external_ratings")
      .select(SELECT_COLUMNS)
      .order("created_at", { ascending: false })
      .limit(200);

    if (error || !data) return [];
    return data.map((row) => rowToExternalRating(row as unknown as ExternalRatingRow));
  } catch {
    return [];
  }
}
