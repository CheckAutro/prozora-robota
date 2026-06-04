// app/api/admin/company-discovery/route.ts
// GET  /api/admin/company-discovery
// POST /api/admin/company-discovery

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth-server";
import {
  getAdminCompanyDiscoveryQueue,
  rowToCompanyDiscovery,
  upsertCompanyDiscoveryQueue,
  COMPANY_DISCOVERY_CONFIDENCES,
  COMPANY_DISCOVERY_STATUSES,
} from "@/lib/company-discovery-service";
import { generateCompanySlug } from "@/lib/company-matching";
import type { CompanyDiscoveryMatchConfidence, CompanyDiscoveryStatus } from "@/lib/types";

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

function requiredString(value: unknown, field: string): string | NextResponse {
  if (typeof value !== "string" || !value.trim()) {
    return NextResponse.json({ error: field + " is required" }, { status: 422 });
  }
  return value.trim();
}

function optionalDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function validStatus(value: unknown): CompanyDiscoveryStatus {
  return COMPANY_DISCOVERY_STATUSES.includes(value as CompanyDiscoveryStatus)
    ? value as CompanyDiscoveryStatus
    : "needs_review";
}

function validConfidence(value: unknown): CompanyDiscoveryMatchConfidence {
  return COMPANY_DISCOVERY_CONFIDENCES.includes(value as CompanyDiscoveryMatchConfidence)
    ? value as CompanyDiscoveryMatchConfidence
    : "low";
}

export async function GET(req: NextRequest) {
  const auth = await checkAdminAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const items = await getAdminCompanyDiscoveryQueue();
  return NextResponse.json({ items });
}

export async function POST(req: NextRequest) {
  const auth = await checkAdminAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const discoveredName = requiredString(body.discovered_name, "discovered_name");
  if (discoveredName instanceof NextResponse) return discoveredName;
  const sourceName = requiredString(body.source_name, "source_name");
  if (sourceName instanceof NextResponse) return sourceName;
  const suggestedSlug = optionalString(body.suggested_slug) ?? generateCompanySlug(discoveredName);

  const result = await upsertCompanyDiscoveryQueue({
    discovered_name: discoveredName,
    suggested_slug: suggestedSlug,
    source_name: sourceName,
    source_url: optionalString(body.source_url),
    city: optionalString(body.city),
    industry: optionalString(body.industry),
    description: optionalString(body.description),
    company_size: optionalString(body.company_size),
    matched_existing_slug: optionalString(body.matched_existing_slug),
    match_confidence: validConfidence(body.match_confidence),
    status: validStatus(body.status),
    is_imported: Boolean(body.is_imported),
    imported_company_slug: optionalString(body.imported_company_slug),
    raw_excerpt: optionalString(body.raw_excerpt),
    collected_at: optionalDate(body.collected_at),
    admin_note: optionalString(body.admin_note),
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.missingTable ? 503 : 500 });

  try {
    const client = getServiceClient();
    const { data } = await client
      .from("company_discovery_queue")
      .select("*")
      .eq("id", result.id)
      .maybeSingle();
    return NextResponse.json({ ok: true, created: result.created, item: data ? rowToCompanyDiscovery(data) : null });
  } catch {
    return NextResponse.json({ ok: true, created: result.created, id: result.id });
  }
}
