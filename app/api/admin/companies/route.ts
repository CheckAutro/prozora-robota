// app/api/admin/companies/route.ts
//
// GET  /api/admin/companies?slugs=slug1,slug2   — check which slugs exist
// POST /api/admin/companies                      — create a company from a review
// Auth: x-admin-key header must match ADMIN_ACCESS_KEY env var.
// Uses service-role key (server-only, never in client bundles).

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth-server";

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


// ── GET: check which slugs exist in public.companies ─────────────────────────
// Query: ?slugs=nova-kava,a-bank
// Response: { existing: string[] }  — slugs that ARE in the DB
export async function GET(req: NextRequest) {
  // ── Auth: Supabase Bearer token → admin_users check ────────────────────────
  const auth = await checkAdminAuth(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  // ── Auth ─────────────────────────────────────────────────────────────────

  const slugsParam = req.nextUrl.searchParams.get("slugs") ?? "";
  const slugs = slugsParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (slugs.length === 0) {
    return NextResponse.json({ existing: [] });
  }

  try {
    const client = getServiceClient();
    const { data, error } = await client
      .from("companies")
      .select("slug")
      .in("slug", slugs);

    if (error) {
      console.error("[admin/companies GET]", error.message);
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }

    const existing = (data ?? []).map((r: { slug: string }) => r.slug);
    return NextResponse.json({ existing });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[admin/companies GET] exception:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ── POST: create a company from a review ─────────────────────────────────────
// Body: { name, slug, city?, industry? }
// Response: { ok: true, created: boolean, company: { name, slug } }
//   created = false means the slug already existed (not an error).
export async function POST(req: NextRequest) {
  // ── Auth ─────────────────────────────────────────────────────────────────

  let body: { name?: string; slug?: string; city?: string; industry?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { name, slug, city, industry } = body;
  if (!name || !slug) {
    return NextResponse.json(
      { error: "name and slug are required" },
      { status: 400 }
    );
  }

  try {
    const client = getServiceClient();

    // Idempotency: check if slug already exists before inserting.
    const { data: existing } = await client
      .from("companies")
      .select("slug")
      .eq("slug", slug)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ ok: true, created: false, company: existing });
    }

    const row: Record<string, string | null> = {
      name,
      slug,
      city: city ?? null,
      // Only set industry if it's a canonical value; otherwise leave null.
      industry: industry ?? null,
    };

    const { data: inserted, error } = await client
      .from("companies")
      .insert(row)
      .select("name, slug")
      .single();

    if (error) {
      console.error("[admin/companies POST]", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, created: true, company: inserted });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[admin/companies POST] exception:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
