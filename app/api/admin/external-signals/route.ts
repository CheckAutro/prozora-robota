// app/api/admin/external-signals/route.ts
// GET  /api/admin/external-signals?company_slug=...&status=...
// POST /api/admin/external-signals
// Auth: x-admin-key. Uses service-role (bypasses RLS on external_signals).
// External signals are NEVER mixed with public.reviews.

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth-server";
import type { ExternalSignalType, ExternalSignalStatus } from "@/lib/types";

/**
 * Dual auth guard: Supabase Bearer token (primary) or x-admin-key (legacy).
 * Returns 401 for missing/invalid token, 403 for non-admin user.
 */
async function checkAdminAuth(
  req: NextRequest
): Promise<{ ok: true } | { ok: false; status: 401 | 403; error: string }> {
  if (process.env.NODE_ENV === "development") {
    console.log("[admin-api] authorization exists:", Boolean(req.headers.get("authorization")));
  }

  // Primary: Supabase Auth Bearer token
  const result = await requireAdmin(req);
  if (result.ok) return { ok: true };
  if (result.status === 403) return result; // valid user, not admin

  // Fallback: legacy x-admin-key
  const adminKey = process.env.ADMIN_ACCESS_KEY;
  if (adminKey && req.headers.get("x-admin-key") === adminKey) {
    return { ok: true };
  }

  return result; // 401
}


const VALID_TYPES = new Set<ExternalSignalType>([
  "salary_delay", "unclear_salary", "schedule_risk", "overload",
  "official_employment_issue", "interview_issue", "management_issue",
  "booking_info", "internship_info", "positive_team", "positive_salary",
  "positive_conditions", "other",
]);

const VALID_STATUSES = new Set<ExternalSignalStatus>([
  "needs_verification", "verified", "rejected",
]);

/**
 * Dual auth: accepts Supabase Auth token (Authorization: Bearer ...)
 * OR legacy x-admin-key header. Both are validated server-side.
 * Supabase path checks admin_users table; key path checks ADMIN_ACCESS_KEY env.
 */
function isValidUrl(s: string): boolean {
  try { new URL(s); return true; } catch { return false; }
}

// ── GET: list external signals ────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  // ── Auth: Supabase Bearer token → admin_users check ────────────────────────
  const auth = await checkAdminAuth(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  // ── Auth ─────────────────────────────────────────────────────────────────

  const { searchParams } = req.nextUrl;
  const companySlug = searchParams.get("company_slug") ?? "";
  const status      = searchParams.get("status") ?? "";

  try {
    const client = getServiceClient();
    let query = client
      .from("external_signals")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);

    if (companySlug) query = query.eq("company_slug", companySlug);
    if (status && VALID_STATUSES.has(status as ExternalSignalStatus)) {
      query = query.eq("status", status);
    }

    const { data, error } = await query;
    if (error) {
      console.error("[external-signals GET]", error.message);
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }

    // Map snake_case DB rows to camelCase for frontend
    const signals = (data ?? []).map(rowToSignal);
    return NextResponse.json({ signals });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// ── POST: create external signal ──────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // ── Auth ─────────────────────────────────────────────────────────────────

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const {
    company_slug, company_name, short_summary,
    signal_type, source_name, source_url,
    status = "needs_verification", is_public = false,
  } = body as Record<string, string | boolean | undefined>;

  // Validate required fields
  if (!company_slug || typeof company_slug !== "string" || !company_slug.trim()) {
    return NextResponse.json({ error: "company_slug is required" }, { status: 422 });
  }
  if (!company_name || typeof company_name !== "string" || !company_name.trim()) {
    return NextResponse.json({ error: "company_name is required" }, { status: 422 });
  }
  if (!short_summary || typeof short_summary !== "string") {
    return NextResponse.json({ error: "short_summary is required" }, { status: 422 });
  }
  const summary = short_summary.trim();
  if (summary.length < 10) {
    return NextResponse.json({ error: "short_summary занадто короткий (мін 10 символів)" }, { status: 422 });
  }
  if (summary.length > 500) {
    return NextResponse.json({ error: "short_summary занадто довгий (макс 500 символів)" }, { status: 422 });
  }
  if (!signal_type || !VALID_TYPES.has(signal_type as ExternalSignalType)) {
    return NextResponse.json({ error: "Invalid signal_type" }, { status: 422 });
  }
  if (source_url && typeof source_url === "string" && source_url.trim() && !isValidUrl(source_url.trim())) {
    return NextResponse.json({ error: "source_url must be a valid URL" }, { status: 422 });
  }

  try {
    const client = getServiceClient();
    const row = {
      company_slug:  String(company_slug).trim(),
      company_name:  String(company_name).trim(),
      short_summary: summary,
      signal_type,
      source_name:   source_name ? String(source_name).trim() || null : null,
      source_url:    source_url  ? String(source_url).trim()  || null : null,
      status:        VALID_STATUSES.has(status as ExternalSignalStatus) ? status : "needs_verification",
      is_public:     Boolean(is_public),
    };

    const { data, error } = await client
      .from("external_signals")
      .insert(row)
      .select("*")
      .single();

    if (error) {
      console.error("[external-signals POST]", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, signal: rowToSignal(data) });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// ── Helper: DB row → camelCase ────────────────────────────────────────────────

function rowToSignal(row: Record<string, unknown>) {
  return {
    id:           row.id,
    companySlug:  row.company_slug,
    companyName:  row.company_name,
    shortSummary: row.short_summary,
    signalType:   row.signal_type,
    sourceName:   row.source_name ?? null,
    sourceUrl:    row.source_url  ?? null,
    status:       row.status,
    isPublic:     row.is_public,
    createdAt:    row.created_at,
    updatedAt:    row.updated_at,
  };
}
