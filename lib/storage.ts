// Public (anon) review storage backed by Supabase.
//
// Only two operations use the anon key:
//   addPendingReview  — INSERT with status='pending'  (allowed by RLS)
//   getPublishedReviewsForCompany — SELECT published   (allowed by RLS)
//
// All admin operations (read pending, change status) run through
// /api/admin/reviews Route Handlers that use the service-role key server-side.

import { getBrowserClient, isSupabaseConfigured } from "./supabase/client";
import type { Review, ReviewStatus } from "./types";

// ── Row type (DB snake_case) ──────────────────────────────────────────────────

export interface ReviewRow {
  id: string;
  company_slug: string;
  company_name: string;
  type: string;
  city: string;
  role_category: string;
  year: number;
  verified: boolean;
  text: string;
  salary_match: string;
  official_employment: string;
  booking_promised: string;
  booking_received: string;
  booking_timing: string | null;
  internship_paid: string;
  payment_delay: string;
  ratings: Record<string, number>;
  badges: string[];
  status: string;
  created_at: string;
  updated_at: string;
}

// ── Converters (exported so Route Handlers can reuse them) ────────────────────

export function fromRow(row: ReviewRow): Review {
  return {
    id: row.id,
    companySlug: row.company_slug,
    companyName: row.company_name,
    type: row.type as Review["type"],
    city: row.city,
    roleCategory: row.role_category,
    year: row.year,
    verified: row.verified,
    text: row.text,
    salaryMatch: row.salary_match as Review["salaryMatch"],
    officialEmployment: row.official_employment as Review["officialEmployment"],
    bookingPromised: row.booking_promised as Review["bookingPromised"],
    bookingReceived: row.booking_received as Review["bookingReceived"],
    bookingTiming: (row.booking_timing ?? undefined) as Review["bookingTiming"],
    internshipPaid: row.internship_paid as Review["internshipPaid"],
    paymentDelay: row.payment_delay as Review["paymentDelay"],
    ratings: row.ratings as unknown as Review["ratings"],
    badges: row.badges ?? [],
    status: row.status as ReviewStatus,
    createdAt: row.created_at,
  };
}

export function toRow(review: Review): Omit<ReviewRow, "updated_at" | "created_at"> {
  // created_at is intentionally omitted — the DB sets it via DEFAULT now().
  // The local review.createdAt field is only used for display after a round-trip read.
  return {
    id: review.id,
    company_slug: review.companySlug,
    company_name: review.companyName,
    type: review.type,
    city: review.city,
    role_category: review.roleCategory,
    year: review.year,
    verified: review.verified,
    text: review.text,
    salary_match: review.salaryMatch,
    official_employment: review.officialEmployment,
    booking_promised: review.bookingPromised,
    booking_received: review.bookingReceived,
    booking_timing: review.bookingTiming ?? null,
    internship_paid: review.internshipPaid,
    payment_delay: review.paymentDelay,
    ratings: review.ratings as unknown as Record<string, number>,
    badges: review.badges,
    status: review.status ?? "pending",
  };
}

// ── Public API (anon key, RLS-restricted) ────────────────────────────────────

/**
 * Inserts a new review with status = 'pending'.
 * Throws a user-facing error on failure.
 */
export async function addPendingReview(review: Review): Promise<void> {
  if (!isSupabaseConfigured()) {
    throw new Error(
      "Supabase не налаштовано. Зверніться до адміністратора."
    );
  }
  const client = getBrowserClient();
  const row = toRow({ ...review, status: "pending" });
  const { error } = await client.from("reviews").insert(row as never);
  if (error) {
    console.error("[storage] addPendingReview:", error.message);
    throw new Error("Не вдалося зберегти відгук. Спробуйте ще раз.");
  }
}

/**
 * Returns published reviews for a company page (anon-readable by RLS).
 * Returns [] silently if Supabase is not configured or on any error.
 */
export async function getPublishedReviewsForCompany(
  companySlug: string
): Promise<Review[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const client = getBrowserClient();
    const { data, error } = await client
      .from("reviews")
      .select("*")
      .eq("company_slug", companySlug)
      .eq("status", "published")
      .order("created_at", { ascending: false });
    if (error) {
      console.error("[storage] getPublishedReviewsForCompany:", error.message);
      return [];
    }
    return (data ?? []).map((r) => fromRow(r as unknown as ReviewRow));
  } catch {
    return [];
  }
}

/** Generates a UUID for a new review. Falls back to timestamp ID in old envs. */
export function generateReviewId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `r_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
