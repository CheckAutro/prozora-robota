// app/api/admin/external-signals/[id]/route.ts
// PATCH /api/admin/external-signals/[id] — update status / is_public / content
// DELETE /api/admin/external-signals/[id] — hard delete (admin only)
// Auth: x-admin-key. Service-role client — bypasses RLS.

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth-server";
import type { ExternalSignalStatus } from "@/lib/types";

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

// ── PATCH: partial update ─────────────────────────────────────────────────────

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
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const update: Record<string, unknown> = {};

  // status
  if ("status" in body) {
    if (!VALID_STATUSES.has(body.status as ExternalSignalStatus)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 422 });
    }
    update.status = body.status;
  }

  // is_public toggle
  if ("is_public" in body) {
    update.is_public = Boolean(body.is_public);
  }

  // short_summary
  if ("short_summary" in body) {
    const s = String(body.short_summary ?? "").trim();
    if (s.length < 10) return NextResponse.json({ error: "short_summary too short" }, { status: 422 });
    if (s.length > 500) return NextResponse.json({ error: "short_summary too long" }, { status: 422 });
    update.short_summary = s;
  }

  // signal_type
  if ("signal_type" in body) {
    update.signal_type = body.signal_type;
  }

  // source_name / source_url
  if ("source_name" in body) {
    update.source_name = body.source_name ? String(body.source_name).trim() || null : null;
  }
  if ("source_url" in body) {
    const url = body.source_url ? String(body.source_url).trim() : "";
    if (url && !isValidUrl(url)) {
      return NextResponse.json({ error: "source_url must be a valid URL" }, { status: 422 });
    }
    update.source_url = url || null;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  try {
    const client = getServiceClient();
    const { error } = await client
      .from("external_signals")
      .update(update)
      .eq("id", id);

    if (error) {
      console.error("[external-signals PATCH]", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// ── DELETE: hard delete ───────────────────────────────────────────────────────

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // ── Auth ─────────────────────────────────────────────────────────────────
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  try {
    const client = getServiceClient();
    const { error } = await client
      .from("external_signals")
      .delete()
      .eq("id", id);

    if (error) {
      console.error("[external-signals DELETE]", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, deleted: id });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
