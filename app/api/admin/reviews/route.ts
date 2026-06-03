// GET /api/admin/reviews
// Returns pending reviews and per-status counts.
// Auth: x-admin-key header must match ADMIN_ACCESS_KEY env var.
// Uses Supabase service-role key — bypasses RLS to read any status.

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth-server";
import { fromRow, type ReviewRow } from "@/lib/storage";
import type { ReviewStatus } from "@/lib/types";

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


export async function GET(req: NextRequest) {
  const auth = await checkAdminAuth(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (process.env.NODE_ENV === "development") {
    console.log("[admin-api] reviews GET — authorization exists:",
      Boolean(req.headers.get("authorization")));
  }

  try {
    const client = getServiceClient();

    // Fetch pending reviews and all status counts in parallel.
    const [reviewsResult, ...countResults] = await Promise.all([
      client
        .from("reviews")
        .select("*")
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
      client
        .from("reviews")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending"),
      client
        .from("reviews")
        .select("*", { count: "exact", head: true })
        .eq("status", "published"),
      client
        .from("reviews")
        .select("*", { count: "exact", head: true })
        .eq("status", "rejected"),
      client
        .from("reviews")
        .select("*", { count: "exact", head: true })
        .eq("status", "needs_edit"),
    ]);

    if (reviewsResult.error) {
      console.error("[admin/reviews GET]", reviewsResult.error.message);
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }

    const [pendingCount, publishedCount, rejectedCount, needsEditCount] = countResults;
    const counts: Record<ReviewStatus, number> = {
      pending: pendingCount.count ?? 0,
      published: publishedCount.count ?? 0,
      rejected: rejectedCount.count ?? 0,
      needs_edit: needsEditCount.count ?? 0,
    };

    const reviews = (reviewsResult.data ?? []).map((r) =>
      fromRow(r as unknown as ReviewRow)
    );

    return NextResponse.json({ reviews, counts });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[admin/reviews GET] exception:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
