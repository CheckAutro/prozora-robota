// app/api/admin/companies/search/route.ts
// GET /api/admin/companies/search?q=нова
// Returns up to 10 companies matching the query (name or slug).
// Auth: x-admin-key header.

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth-server";
import { slugifyCompanyName } from "@/lib/slugify";

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
export async function GET(req: NextRequest) {
  // ── Auth: Supabase Bearer token → admin_users check ────────────────────────
  const auth = await checkAdminAuth(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  // ── Auth ─────────────────────────────────────────────────────────────────

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ companies: [] });

  const slugQuery = slugifyCompanyName(q);

  try {
    const client = getServiceClient();

    const [byName, bySlug] = await Promise.all([
      client
        .from("companies")
        .select("name, slug, city, industry")
        .ilike("name", `%${q}%`)
        .order("name")
        .limit(10),
      client
        .from("companies")
        .select("name, slug, city, industry")
        .ilike("slug", `%${slugQuery}%`)
        .order("name")
        .limit(10),
    ]);

    const seen = new Set<string>();
    const companies: { name: string; slug: string; city: string | null; industry: string | null }[] = [];

    for (const row of [...(byName.data ?? []), ...(bySlug.data ?? [])]) {
      const r = row as { name: string; slug: string; city: string | null; industry: string | null };
      if (!seen.has(r.slug)) {
        seen.add(r.slug);
        companies.push(r);
      }
    }

    return NextResponse.json({ companies: companies.slice(0, 10) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
