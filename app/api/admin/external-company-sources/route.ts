// app/api/admin/external-company-sources/route.ts
// GET  /api/admin/external-company-sources
// POST /api/admin/external-company-sources

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth-server";
import {
  collectExternalCompanySignals,
  getAdminCompanyExternalSources,
  upsertExternalCompanySource,
} from "@/lib/external/company-sources";
import { generateCompanySlug } from "@/lib/company-matching";
import type { ExternalCompanySourceType } from "@/lib/types";

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

function validType(value: unknown): ExternalCompanySourceType {
  return value === "reviews" ||
    value === "rating" ||
    value === "vacancy" ||
    value === "company_page" ||
    value === "article"
    ? value
    : "other";
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

export async function GET(req: NextRequest) {
  const auth = await checkAdminAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const sources = await getAdminCompanyExternalSources();
  return NextResponse.json({ sources });
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

  const action = optionalString(body.action) ?? "create";
  const companyName = optionalString(body.company_name);
  const companySlug = optionalString(body.company_slug);
  const sourceName = optionalString(body.source_name);
  if (!companyName || !sourceName) {
    return NextResponse.json({ error: "company_name and source_name are required" }, { status: 422 });
  }

  const sourceUrl = optionalString(body.source_url);
  if (sourceUrl && !isValidUrl(sourceUrl)) {
    return NextResponse.json({ error: "source_url must be a valid URL" }, { status: 422 });
  }

  const finalSlug = companySlug || generateCompanySlug(companyName);

  if (action === "collect") {
    if (!sourceUrl) {
      return NextResponse.json({ error: "source_url is required for source collection" }, { status: 422 });
    }
    const collected = await collectExternalCompanySignals({
      companySlug: finalSlug,
      companyName,
      sourceUrls: [sourceUrl],
      sourceName,
      sourceType: validType(body.source_type),
    });
    return NextResponse.json({
      ok: true,
      sources: collected.sources,
      warnings: collected.warnings,
    });
  }

  const result = await upsertExternalCompanySource({
    company_slug: finalSlug,
    company_name: companyName,
    source_name: sourceName,
    source_url: sourceUrl,
    source_type: validType(body.source_type),
    title: optionalString(body.title),
    short_summary: optionalString(body.short_summary) || "Зовнішнє джерело про компанію",
    positive_points: parseArray(body.positive_points),
    negative_points: parseArray(body.negative_points),
    neutral_facts: parseArray(body.neutral_facts),
    rating_value: typeof body.rating_value === "number" ? body.rating_value : null,
    rating_scale: typeof body.rating_scale === "number" ? body.rating_scale : 5,
    reviews_count: typeof body.reviews_count === "number" ? body.reviews_count : 0,
    confidence: body.confidence === "low" || body.confidence === "high" ? body.confidence : "medium",
    status: "needs_verification",
    is_public: false,
    source_excerpt: optionalString(body.source_excerpt),
    collected_at: optionalString(body.collected_at),
    admin_note: optionalString(body.admin_note),
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.missingTable ? 503 : 500 });
  }

  return NextResponse.json({ ok: true, created: result.created, id: result.id });
}
