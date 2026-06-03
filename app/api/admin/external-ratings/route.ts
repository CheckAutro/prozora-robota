// app/api/admin/external-ratings/route.ts
// GET  /api/admin/external-ratings
// POST /api/admin/external-ratings
// External ratings are NEVER inserted into public.reviews.

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth-server";
import {
  getAdminExternalRatings,
  rowToExternalRating,
} from "@/lib/external-ratings-service";
import type { ExternalRatingStatus } from "@/lib/types";

async function checkAdminAuth(
  req: NextRequest
): Promise<{ ok: true } | { ok: false; status: 401 | 403; error: string }> {
  if (process.env.NODE_ENV === "development") {
    console.log("[admin-api] authorization exists:", Boolean(req.headers.get("authorization")));
  }

  const result = await requireAdmin(req);
  if (result.ok) return { ok: true };
  if (result.status === 403) return result;

  const adminKey = process.env.ADMIN_ACCESS_KEY;
  if (adminKey && req.headers.get("x-admin-key") === adminKey) {
    return { ok: true };
  }

  return result;
}

const VALID_STATUSES = new Set<ExternalRatingStatus>([
  "needs_verification", "verified", "rejected",
]);

function isValidUrl(value: string): boolean {
  try { new URL(value); return true; } catch { return false; }
}

function optionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function requiredString(value: unknown, field: string): string | NextResponse {
  if (typeof value !== "string" || !value.trim()) {
    return NextResponse.json({ error: `${field} is required` }, { status: 422 });
  }
  return value.trim();
}

function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function optionalDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function GET(req: NextRequest) {
  const auth = await checkAdminAuth(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const ratings = await getAdminExternalRatings();
  return NextResponse.json({ ratings });
}

export async function POST(req: NextRequest) {
  const auth = await checkAdminAuth(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const companySlug = requiredString(body.company_slug, "company_slug");
  if (companySlug instanceof NextResponse) return companySlug;
  const companyName = requiredString(body.company_name, "company_name");
  if (companyName instanceof NextResponse) return companyName;
  const sourceName = requiredString(body.source_name, "source_name");
  if (sourceName instanceof NextResponse) return sourceName;

  const sourceUrl = optionalString(body.source_url);
  if (sourceUrl && !isValidUrl(sourceUrl)) {
    return NextResponse.json({ error: "source_url must be a valid URL" }, { status: 422 });
  }

  const ratingValue = optionalNumber(body.rating_value);
  const ratingScale = optionalNumber(body.rating_scale) ?? 5;
  const reviewsCount = Math.max(0, Math.trunc(optionalNumber(body.reviews_count) ?? 0));
  const fetchedAt = optionalDate(body.fetched_at);
  const status = VALID_STATUSES.has(body.status as ExternalRatingStatus)
    ? body.status
    : "needs_verification";
  const isPublic = Boolean(body.is_public);

  if (ratingValue !== null && ratingValue < 0) {
    return NextResponse.json({ error: "rating_value must be positive" }, { status: 422 });
  }
  if (ratingScale <= 0) {
    return NextResponse.json({ error: "rating_scale must be greater than 0" }, { status: 422 });
  }
  if (isPublic && status !== "verified") {
    return NextResponse.json(
      { error: "is_public=true is allowed only for verified ratings" },
      { status: 422 }
    );
  }

  try {
    const client = getServiceClient();
    const { data, error } = await client
      .from("external_ratings")
      .insert({
        company_slug: companySlug,
        company_name: companyName,
        source_name: sourceName,
        source_url: sourceUrl,
        rating_value: ratingValue,
        rating_scale: ratingScale,
        reviews_count: reviewsCount,
        fetched_at: fetchedAt,
        status,
        is_public: isPublic,
        note: optionalString(body.note),
      })
      .select("*")
      .single();

    if (error) {
      console.error("[external-ratings POST]", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, rating: rowToExternalRating(data) });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
