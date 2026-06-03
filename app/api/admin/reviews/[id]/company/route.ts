// app/api/admin/reviews/[id]/company/route.ts
// PATCH /api/admin/reviews/[id]/company
// Body: { company_name: string, company_slug: string }
// Updates company_name and company_slug on a review (relinks it to the
// correct company without changing moderation status).
// Auth: x-admin-key header. Uses service-role key.

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


/**
 * Dual auth: accepts Supabase Auth token (Authorization: Bearer ...)
 * OR legacy x-admin-key header. Both are validated server-side.
 * Supabase path checks admin_users table; key path checks ADMIN_ACCESS_KEY env.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // ── Auth: Supabase Bearer token → admin_users check ────────────────────────
  const auth = await checkAdminAuth(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  // ── Auth ─────────────────────────────────────────────────────────────────

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  let body: { company_name?: string; company_slug?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { company_name, company_slug } = body;
  if (!company_name || !company_slug) {
    return NextResponse.json(
      { error: "company_name and company_slug are required" },
      { status: 400 }
    );
  }

  try {
    const client = getServiceClient();
    const { error } = await client
      .from("reviews")
      .update({
        company_name,
        company_slug,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) {
      console.error("[admin/reviews/company PATCH]", error.message);
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, id, company_name, company_slug });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[admin/reviews/company PATCH] exception:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
