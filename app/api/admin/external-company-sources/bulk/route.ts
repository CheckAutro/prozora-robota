// app/api/admin/external-company-sources/bulk/route.ts
// POST /api/admin/external-company-sources/bulk

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth-server";
import { primaryTextLooksUkrainian } from "@/lib/external/source-normalizer";

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

function parseIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
}

function buildUpdate(action: string): Record<string, unknown> | null {
  if (action === "approve" || action === "mark_verified") return { status: "verified" };
  if (action === "mark_needs_verification") return { status: "needs_verification", is_public: false };
  if (action === "reject") return { status: "rejected", is_public: false };
  if (action === "publish") return { status: "verified", is_public: true };
  if (action === "unpublish") return { is_public: false };
  return null;
}

function textArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
}

export async function POST(req: NextRequest) {
  const auth = await checkAdminAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const action = optionalString(body.action) ?? "";
  const ids = parseIds(body.ids);
  if (!action || ids.length === 0) {
    return NextResponse.json({ error: "action and ids are required" }, { status: 422 });
  }

  const update = buildUpdate(action);
  if (!update) {
    return NextResponse.json({ error: "Invalid action" }, { status: 422 });
  }

  try {
    const client = getServiceClient();
    let updated_count = 0;
    let skipped_count = 0;
    const errors: Array<{ id: string; error: string }> = [];

    for (const id of ids) {
      if (action === "publish") {
        const { data: current, error: currentError } = await client
          .from("external_company_sources")
          .select("short_summary, positive_points, negative_points, neutral_facts, source_url")
          .eq("id", id)
          .single();
        if (currentError || !current) {
          skipped_count += 1;
          errors.push({ id, error: "External company source not found" });
          continue;
        }
        const row = current as Record<string, unknown>;
        const publicText = [
          typeof row.short_summary === "string" ? row.short_summary : "",
          ...textArray(row.positive_points),
          ...textArray(row.negative_points),
          ...textArray(row.neutral_facts),
        ].join(" ");
        if (!String(row.source_url ?? "").trim()) {
          skipped_count += 1;
          errors.push({ id, error: "source_url is required before publishing external company sources" });
          continue;
        }
        if (!primaryTextLooksUkrainian(publicText)) {
          skipped_count += 1;
          errors.push({ id, error: "Перед публікацією додайте українське коротке узагальнення." });
          continue;
        }
      }
      const { error } = await client
        .from("external_company_sources")
        .update(update)
        .eq("id", id);
      if (error) {
        skipped_count += 1;
        errors.push({ id, error: error.message });
      } else {
        updated_count += 1;
      }
    }

    return NextResponse.json({ ok: true, updated_count, skipped_count, errors });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
