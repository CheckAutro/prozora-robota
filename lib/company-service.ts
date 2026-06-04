// lib/company-service.ts
// Reads companies from public.companies (Supabase).
// Falls back to mock data if Supabase is not configured or the query fails.

import { getServerClient } from "./supabase/server";
import { COMPANIES } from "./mock-data";
import { normalizeIndustry } from "./industry";
import type { Company } from "./types";

/** Minimal shape returned by the public.companies table. */
export interface SupabaseCompany {
  id: string;
  slug: string;
  name: string;
  city: string | null;
  industry: string | null;
  verified: boolean;
  created_at: string;
}

/** Marker so callers can tell Supabase rows from fully-enriched mock companies. */
export type CompanyListItem =
  | { source: "mock"; data: Company }
  | { source: "supabase"; data: SupabaseCompany };

/**
 * Returns companies for the /companies listing page.
 *
 * Strategy:
 *  1. Try Supabase (anon, server-side). RLS allows public SELECT on companies.
 *  2. If env vars missing or query fails → return mock companies as fallback.
 *
 * The mock companies are kept in the list so the rich detail pages
 * (Нова Пошта, АТБ, …) are always reachable via their known slugs.
 */
export async function getCompanyList(): Promise<CompanyListItem[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

  if (!url || !key) {
    // Not configured — serve mock data only.
    return COMPANIES.map((c) => ({ source: "mock", data: c }));
  }

  try {
    const client = getServerClient();
    const { data, error } = await client
      .from("companies")
      .select("id, slug, name, city, industry, verified, created_at")
      .order("name");

    if (error || !data || data.length === 0) {
      console.warn("[company-service] Supabase query failed, using mock data:", error?.message);
      return COMPANIES.map((c) => ({ source: "mock", data: c }));
    }

    const rows = data as SupabaseCompany[];
    const mockSlugs = new Set(COMPANIES.map((c) => c.slug));

    // Build result: mock companies (with full metrics) + Supabase-only companies
    // (those whose slug is not covered by a mock entry).
    const mockItems: CompanyListItem[] = COMPANIES.map((c) => ({ source: "mock", data: c }));
    const supabaseOnly: CompanyListItem[] = rows
      .filter((r) => !mockSlugs.has(r.slug))
      .map((r) => ({ source: "supabase", data: r }));

    return [...mockItems, ...supabaseOnly];
  } catch (err) {
    console.warn("[company-service] Unexpected error, using mock data:", err);
    return COMPANIES.map((c) => ({ source: "mock", data: c }));
  }
}

/**
 * Looks up a single company by slug in Supabase.
 * Returns null if not found or Supabase is unavailable.
 * Used by /companies/[slug] for slugs not present in mock data.
 */
export async function getSupabaseCompanyBySlug(
  slug: string
): Promise<SupabaseCompany | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!url || !key) return null;

  try {
    const client = getServerClient();
    const { data, error } = await client
      .from("companies")
      .select("id, slug, name, city, industry, verified, created_at")
      .eq("slug", slug)
      .single();

    if (error || !data) return null;
    return data as SupabaseCompany;
  } catch {
    return null;
  }
}

/** Unique sorted city list extracted from a mixed company list. */
export function getCitiesFromList(items: CompanyListItem[]): string[] {
  const set = new Set<string>();
  for (const item of items) {
    const city = item.source === "mock" ? item.data.city : item.data.city;
    if (city) set.add(city);
  }
  return Array.from(set).sort();
}

/** Unique sorted industry list extracted from a mixed company list (normalized). */
export function getIndustriesFromList(items: CompanyListItem[]): string[] {
  const set = new Set<string>();
  for (const item of items) {
    const raw = item.source === "mock" ? item.data.industry : item.data.industry;
    const industry = normalizeIndustry(raw);
    if (industry) set.add(industry);
  }
  return Array.from(set).sort();
}

// ── Review metrics (server-side, from public.reviews) ─────────────────────────

export interface ReviewMetrics {
  reviewCount: number;
  averageRating: number | null;
  hasHighRating: boolean;    // averageRating >= 4.0
  hasRisks: boolean;         // at least one rating field <= 2
  hasOfficialEmployment: boolean;
  hasBooking: boolean;
  hasPaidInternship: boolean;
}

/** Per-slug map returned by getPublishedReviewMetrics(). */
export type ReviewMetricsBySlug = Record<string, ReviewMetrics>;

export interface PublishedCompanyReviewFacts {
  reviewCount: number;
  averageInternalRating: number | null;
  salaryAverage: number | null;
  scheduleAverage: number | null;
  salaryMatchCounts: Record<string, number>;
  employmentCounts: Record<string, number>;
  bookingCounts: Record<string, number>;
  paymentDelayCounts: Record<string, number>;
  hasSalaryData: boolean;
  hasEmploymentData: boolean;
  hasScheduleData: boolean;
  hasBookingData: boolean;
}

// The columns we SELECT from reviews to compute metrics.
// We keep this minimal to avoid fetching large text fields.
const REVIEW_SELECT =
  "company_slug, ratings, official_employment, booking_received, internship_paid";

const RATING_KEYS = ["salary", "schedule", "management", "conditions", "honesty"] as const;

/**
 * Fetches all published reviews grouped by company_slug and computes
 * filter-relevant metrics. Runs server-side (anon key, RLS: only published).
 *
 * Falls back to an empty map when Supabase is not configured so filters
 * degrade gracefully (no chip shown) rather than crashing.
 */
export async function getPublishedReviewMetrics(): Promise<ReviewMetricsBySlug> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!url || !key) return {};

  try {
    const client = getServerClient();
    const { data, error } = await client
      .from("reviews")
      .select(REVIEW_SELECT)
      .eq("status", "published");

    if (error || !data) {
      console.warn("[company-service] review metrics query failed:", error?.message);
      return {};
    }

    // Aggregate rows by company_slug.
    const grouped: Record<string, typeof data> = {};
    for (const row of data) {
      const slug = (row as { company_slug: string }).company_slug;
      if (!slug) continue;
      if (!grouped[slug]) grouped[slug] = [];
      grouped[slug].push(row);
    }

    const result: ReviewMetricsBySlug = {};
    for (const [slug, rows] of Object.entries(grouped)) {
      const allRatings: number[] = [];
      let hasRisks = false;
      let hasOfficialEmployment = false;
      let hasBooking = false;
      let hasPaidInternship = false;

      for (const row of rows) {
        const r = row as {
          ratings: Record<string, unknown>;
          official_employment: string;
          booking_received: string;
          internship_paid: string;
        };

        // Ratings
        const ratingsObj = r.ratings ?? {};
        for (const k of RATING_KEYS) {
          const v = ratingsObj[k];
          if (typeof v === "number" && !isNaN(v)) {
            allRatings.push(v);
            if (v <= 2) hasRisks = true;
          }
        }

        // Employment
        if (r.official_employment === "official_day_one") hasOfficialEmployment = true;

        // Booking
        if (r.booking_received === "yes") hasBooking = true;

        // Paid internship
        if (r.internship_paid === "yes" || r.internship_paid === "partial")
          hasPaidInternship = true;
      }

      const averageRating =
        allRatings.length > 0
          ? allRatings.reduce((a, b) => a + b, 0) / allRatings.length
          : null;

      result[slug] = {
        reviewCount: rows.length,
        averageRating,
        hasHighRating: averageRating !== null && averageRating >= 4.0,
        hasRisks,
        hasOfficialEmployment,
        hasBooking,
        hasPaidInternship,
      };
    }

    return result;
  } catch (err) {
    console.warn("[company-service] review metrics exception:", err);
    return {};
  }
}

function bumpCount(counts: Record<string, number>, value: unknown) {
  const key = typeof value === "string" && value.trim() ? value : "unknown";
  counts[key] = (counts[key] ?? 0) + 1;
}

function average(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Fetches factual signals from published reviews for one company page.
 * This does not read pending/rejected reviews and does not touch external ratings.
 */
export async function getPublishedCompanyReviewFacts(
  companySlug: string
): Promise<PublishedCompanyReviewFacts> {
  const empty: PublishedCompanyReviewFacts = {
    reviewCount: 0,
    averageInternalRating: null,
    salaryAverage: null,
    scheduleAverage: null,
    salaryMatchCounts: {},
    employmentCounts: {},
    bookingCounts: {},
    paymentDelayCounts: {},
    hasSalaryData: false,
    hasEmploymentData: false,
    hasScheduleData: false,
    hasBookingData: false,
  };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!url || !key) return empty;

  try {
    const client = getServerClient();
    const { data, error } = await client
      .from("reviews")
      .select("ratings, salary_match, official_employment, booking_received, booking_promised, payment_delay")
      .eq("company_slug", companySlug)
      .eq("status", "published");

    if (error || !data) {
      console.warn("[company-service] company review facts query failed:", error?.message);
      return empty;
    }

    const allRatings: number[] = [];
    const salaryRatings: number[] = [];
    const scheduleRatings: number[] = [];
    const salaryMatchCounts: Record<string, number> = {};
    const employmentCounts: Record<string, number> = {};
    const bookingCounts: Record<string, number> = {};
    const paymentDelayCounts: Record<string, number> = {};

    for (const row of data) {
      const r = row as {
        ratings: Record<string, unknown> | null;
        salary_match: string | null;
        official_employment: string | null;
        booking_received: string | null;
        booking_promised: string | null;
        payment_delay: string | null;
      };
      const ratings = r.ratings ?? {};

      for (const key of RATING_KEYS) {
        const value = ratings[key];
        if (typeof value === "number" && !Number.isNaN(value)) {
          allRatings.push(value);
          if (key === "salary") salaryRatings.push(value);
          if (key === "schedule") scheduleRatings.push(value);
        }
      }

      bumpCount(salaryMatchCounts, r.salary_match);
      bumpCount(employmentCounts, r.official_employment);
      bumpCount(bookingCounts, r.booking_received ?? r.booking_promised);
      bumpCount(paymentDelayCounts, r.payment_delay);
    }

    return {
      reviewCount: data.length,
      averageInternalRating: average(allRatings),
      salaryAverage: average(salaryRatings),
      scheduleAverage: average(scheduleRatings),
      salaryMatchCounts,
      employmentCounts,
      bookingCounts,
      paymentDelayCounts,
      hasSalaryData: salaryRatings.length > 0 || Object.keys(salaryMatchCounts).some((key) => key !== "unknown"),
      hasEmploymentData: Object.keys(employmentCounts).some((key) => key !== "unknown"),
      hasScheduleData: scheduleRatings.length > 0,
      hasBookingData: Object.keys(bookingCounts).some((key) => key !== "unknown" && key !== "not_applicable"),
    };
  } catch (err) {
    console.warn("[company-service] company review facts exception:", err);
    return empty;
  }
}
