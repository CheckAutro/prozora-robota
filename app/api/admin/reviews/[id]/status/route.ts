// PATCH /api/admin/reviews/[id]/status
// Body: { "status": "published" | "rejected" | "needs_edit" }
// Auth: x-admin-key header must match ADMIN_ACCESS_KEY env var.
// Uses Supabase service-role key — bypasses RLS to update any row.

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth-server";
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


const ALLOWED_STATUSES: ReviewStatus[] = ["published", "rejected", "needs_edit"];

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

  let body: { status?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const newStatus = body.status as ReviewStatus;
  if (!ALLOWED_STATUSES.includes(newStatus)) {
    return NextResponse.json(
      { error: `Invalid status. Allowed: ${ALLOWED_STATUSES.join(", ")}` },
      { status: 400 }
    );
  }

  try {
    const client = getServiceClient();

    // NOTE: we intentionally do NOT set verified = true here.
    // `verified` is reserved for a separate document-confirmation flow
    // (future feature). Publishing a review only means it passed text
    // moderation, not that supporting documents were checked.
    const { error } = await client
      .from("reviews")
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq("id", id);

    if (error) {
      console.error("[admin/reviews/status PATCH]", error.message);
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }

    // Log the moderation action.
    // Errors here are non-fatal — the status update already succeeded.
    const actionMap: Record<string, string> = {
      published: "publish",
      rejected: "reject",
      needs_edit: "needs_edit",
    };
    const { error: logError } = await client
      .from("review_moderation_logs")
      .insert({
        review_id: id,
        action: actionMap[newStatus] ?? newStatus,
        moderator_id: null, // null = demo admin (key-only auth); replace with auth.uid() later
        reason: null,
      });
    if (logError) {
      // Non-fatal: log to server console but don't fail the request.
      console.warn("[admin/reviews/status PATCH] moderation log failed:", logError.message);
    }

    return NextResponse.json({ ok: true, id, status: newStatus });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[admin/reviews/status PATCH] exception:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
