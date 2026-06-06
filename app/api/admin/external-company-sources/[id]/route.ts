// app/api/admin/external-company-sources/[id]/route.ts
// PATCH /api/admin/external-company-sources/[id]
// DELETE /api/admin/external-company-sources/[id]

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth-server";
import type { ExternalCompanySourceStatus, ExternalCompanySourceType } from "@/lib/types";

async function checkAdminAuth(
  req: NextRequest
): Promise<{ ok: true } | { ok: false; status: 401 | 403; error: string }> {
  const result = await requireAdmin(req);
  if (result.ok) return { ok: true };
  if (result.status === 403) return result;
  const adminKey = process.env.ADMIN_ACCESS_KEY;
  if (adminKey && req.headers.get("x-admin-key") === adminKey) return { ok: true };
  return result;
}

function optionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function nullableDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split(/\r?\n|;/).map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function isValidUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return ["http:", "https:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

function validStatus(value: unknown): ExternalCompanySourceStatus | null {
  return value === "needs_verification" || value === "verified" || value === "rejected" ? value : null;
}

function validType(value: unknown): ExternalCompanySourceType | null {
  return value === "reviews" ||
    value === "rating" ||
    value === "vacancy" ||
    value === "company_page" ||
    value === "article" ||
    value === "other"
    ? value
    : null;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await checkAdminAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  for (const field of ["company_slug", "company_name", "source_name", "title", "short_summary", "source_excerpt", "admin_note"]) {
    if (field in body) update[field] = optionalString(body[field]);
  }

  if ("source_url" in body) {
    const sourceUrl = optionalString(body.source_url);
    if (sourceUrl && !isValidUrl(sourceUrl)) {
      return NextResponse.json({ error: "source_url must be a valid URL" }, { status: 422 });
    }
    update.source_url = sourceUrl;
  }

  if ("source_type" in body) {
    const type = validType(body.source_type);
    if (!type) return NextResponse.json({ error: "Invalid source_type" }, { status: 422 });
    update.source_type = type;
  }

  if ("positive_points" in body) update.positive_points = parseArray(body.positive_points);
  if ("negative_points" in body) update.negative_points = parseArray(body.negative_points);
  if ("neutral_facts" in body) update.neutral_facts = parseArray(body.neutral_facts);

  if ("rating_value" in body) update.rating_value = typeof body.rating_value === "number" ? body.rating_value : null;
  if ("rating_scale" in body) update.rating_scale = typeof body.rating_scale === "number" ? body.rating_scale : 5;
  if ("reviews_count" in body) update.reviews_count = typeof body.reviews_count === "number" ? Math.max(0, Math.trunc(body.reviews_count)) : 0;
  if ("confidence" in body) update.confidence = body.confidence === "high" || body.confidence === "low" ? body.confidence : "medium";
  if ("collected_at" in body) update.collected_at = nullableDate(body.collected_at);
  if ("status" in body) {
    const status = validStatus(body.status);
    if (!status) return NextResponse.json({ error: "Invalid status" }, { status: 422 });
    update.status = status;
    if (status !== "verified") update.is_public = false;
  }
  if ("is_public" in body) update.is_public = Boolean(body.is_public);

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  try {
    const client = getServiceClient();
    if (update.is_public === true) {
      const { data: current, error: currentError } = await client
        .from("external_company_sources")
        .select("status, source_url")
        .eq("id", id)
        .single();
      if (currentError || !current) {
        return NextResponse.json({ error: "External company source not found" }, { status: 404 });
      }
      const currentRow = current as { status?: string; source_url?: string | null };
      if ((update.status ?? currentRow.status) !== "verified") {
        return NextResponse.json({ error: "is_public=true is allowed only for verified external company sources" }, { status: 422 });
      }
      if (!String(update.source_url ?? currentRow.source_url ?? "").trim()) {
        return NextResponse.json({ error: "source_url is required before publishing external company sources" }, { status: 422 });
      }
    }

    const { error } = await client
      .from("external_company_sources")
      .update(update)
      .eq("id", id);

    if (error) {
      console.error("[external-company-sources PATCH]", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, id });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await checkAdminAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  try {
    const client = getServiceClient();
    const { error } = await client.from("external_company_sources").delete().eq("id", id);
    if (error) {
      console.error("[external-company-sources DELETE]", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, deleted: id });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
