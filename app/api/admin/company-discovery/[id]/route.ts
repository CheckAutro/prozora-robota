// app/api/admin/company-discovery/[id]/route.ts
// PATCH /api/admin/company-discovery/[id]
// DELETE /api/admin/company-discovery/[id]

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth-server";
import {
  COMPANY_DISCOVERY_CONFIDENCES,
  COMPANY_DISCOVERY_STATUSES,
  createCompanyFromDiscovery,
  linkDiscoveryToCompany,
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

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return String(value).trim() || null;
}

function nullableDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function validStatus(value: unknown): CompanyDiscoveryStatus | null {
  return COMPANY_DISCOVERY_STATUSES.includes(value as CompanyDiscoveryStatus)
    ? value as CompanyDiscoveryStatus
    : null;
}

function validConfidence(value: unknown): CompanyDiscoveryMatchConfidence | null {
  return COMPANY_DISCOVERY_CONFIDENCES.includes(value as CompanyDiscoveryMatchConfidence)
    ? value as CompanyDiscoveryMatchConfidence
    : null;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await checkAdminAuth(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const action = nullableString(body.action);
  if (action === "create_company") {
    const result = await createCompanyFromDiscovery(id, {
      discovered_name: nullableString(body.discovered_name) ?? undefined,
      suggested_slug: nullableString(body.suggested_slug) ?? undefined,
      city: nullableString(body.city) ?? undefined,
      industry: nullableString(body.industry) ?? undefined,
      description: nullableString(body.description) ?? undefined,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 422 });
    return NextResponse.json({ ok: true, action, slug: result.slug });
  }

  if (action === "link_existing") {
    const slug = nullableString(body.matched_existing_slug) ?? nullableString(body.imported_company_slug);
    if (!slug) return NextResponse.json({ error: "matched_existing_slug is required" }, { status: 422 });
    const result = await linkDiscoveryToCompany(id, slug);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 422 });
    return NextResponse.json({ ok: true, action, slug });
  }

  const update: Record<string, unknown> = {};
  for (const field of ["discovered_name", "suggested_slug", "source_name"]) {
    if (field in body) {
      const value = String(body[field] ?? "").trim();
      if (!value) return NextResponse.json({ error: field + " is required" }, { status: 422 });
      update[field] = field === "suggested_slug" ? generateCompanySlug(value) : value;
    }
  }
  for (const field of [
    "source_url", "city", "industry", "description", "company_size",
    "matched_existing_slug", "imported_company_slug", "raw_excerpt", "admin_note",
  ]) {
    if (field in body) update[field] = nullableString(body[field]);
  }
  if ("match_confidence" in body) {
    const value = validConfidence(body.match_confidence);
    if (!value) return NextResponse.json({ error: "Invalid match_confidence" }, { status: 422 });
    update.match_confidence = value;
  }
  if ("status" in body) {
    const value = validStatus(body.status);
    if (!value) return NextResponse.json({ error: "Invalid status" }, { status: 422 });
    update.status = value;
    if (value !== "auto_imported") update.is_imported = false;
  }
  if ("is_imported" in body) update.is_imported = Boolean(body.is_imported);
  if ("collected_at" in body) update.collected_at = nullableDate(body.collected_at);
  if (Object.keys(update).length === 0) return NextResponse.json({ error: "No fields to update" }, { status: 400 });

  try {
    const client = getServiceClient();
    const { error } = await client.from("company_discovery_queue").update(update).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
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
    const { error } = await client.from("company_discovery_queue").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, deleted: id });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
