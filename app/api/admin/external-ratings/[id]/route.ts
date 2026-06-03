// app/api/admin/external-ratings/[id]/route.ts
// PATCH /api/admin/external-ratings/[id]
// DELETE /api/admin/external-ratings/[id]

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth-server";
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

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return String(value).trim() || null;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nullableDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await checkAdminAuth(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const update: Record<string, unknown> = {};

  for (const field of ["company_slug", "company_name", "source_name"]) {
    if (field in body) {
      const value = String(body[field] ?? "").trim();
      if (!value) return NextResponse.json({ error: `${field} is required` }, { status: 422 });
      update[field] = value;
    }
  }

  if ("source_url" in body) {
    const sourceUrl = nullableString(body.source_url);
    if (sourceUrl && !isValidUrl(sourceUrl)) {
      return NextResponse.json({ error: "source_url must be a valid URL" }, { status: 422 });
    }
    update.source_url = sourceUrl;
  }

  if ("rating_value" in body) {
    const value = nullableNumber(body.rating_value);
    if (value !== null && value < 0) {
      return NextResponse.json({ error: "rating_value must be positive" }, { status: 422 });
    }
    update.rating_value = value;
  }

  if ("rating_scale" in body) {
    const value = nullableNumber(body.rating_scale) ?? 5;
    if (value <= 0) {
      return NextResponse.json({ error: "rating_scale must be greater than 0" }, { status: 422 });
    }
    update.rating_scale = value;
  }

  if ("reviews_count" in body) {
    update.reviews_count = Math.max(0, Math.trunc(nullableNumber(body.reviews_count) ?? 0));
  }

  if ("fetched_at" in body) {
    update.fetched_at = nullableDate(body.fetched_at);
  }

  if ("note" in body) {
    update.note = nullableString(body.note);
  }

  if ("status" in body) {
    if (!VALID_STATUSES.has(body.status as ExternalRatingStatus)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 422 });
    }
    update.status = body.status;
    if (body.status !== "verified") {
      update.is_public = false;
    }
  }

  if ("is_public" in body) {
    update.is_public = Boolean(body.is_public);
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  try {
    const client = getServiceClient();

    if (update.is_public === true && "status" in update && update.status !== "verified") {
      return NextResponse.json(
        { error: "is_public=true is allowed only for verified ratings" },
        { status: 422 }
      );
    }

    if (update.is_public === true && update.status !== "verified") {
      const { data: current, error: currentError } = await client
        .from("external_ratings")
        .select("status")
        .eq("id", id)
        .single();

      if (currentError || !current) {
        return NextResponse.json({ error: "Rating not found" }, { status: 404 });
      }

      const currentStatus = (current as { status?: string }).status;
      if (currentStatus !== "verified") {
        return NextResponse.json(
          { error: "is_public=true is allowed only for verified ratings" },
          { status: 422 }
        );
      }
    }

    const { error } = await client
      .from("external_ratings")
      .update(update)
      .eq("id", id);

    if (error) {
      console.error("[external-ratings PATCH]", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, id });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await checkAdminAuth(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  try {
    const client = getServiceClient();
    const { error } = await client
      .from("external_ratings")
      .delete()
      .eq("id", id);

    if (error) {
      console.error("[external-ratings DELETE]", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, deleted: id });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
