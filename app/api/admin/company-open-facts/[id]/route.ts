// app/api/admin/company-open-facts/[id]/route.ts
// PATCH /api/admin/company-open-facts/[id]
// DELETE /api/admin/company-open-facts/[id]

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth-server";
import type { CompanyOpenFactStatus } from "@/lib/types";

async function checkAdminAuth(
  req: NextRequest
): Promise<{ ok: true } | { ok: false; status: 401 | 403; error: string }> {
  const result = await requireAdmin(req);
  if (result.ok) return { ok: true };
  if (result.status === 403) return result;

  const adminKey = process.env.ADMIN_ACCESS_KEY;
  if (adminKey && req.headers.get("x-admin-key") === adminKey) {
    return { ok: true };
  }

  return result;
}

const VALID_STATUSES = new Set<CompanyOpenFactStatus>([
  "needs_verification",
  "verified",
  "rejected",
]);

function isValidUrl(value: string): boolean {
  try { new URL(value); return true; } catch { return false; }
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

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split(/\r?\n|;/).map((item) => item.trim()).filter(Boolean);
  }
  return [];
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

  for (const field of [
    "source_url",
    "vacancy_title",
    "city",
    "salary_text",
    "employment_type",
    "schedule",
    "experience",
    "education",
    "company_description",
    "vacancy_description",
    "raw_excerpt",
  ]) {
    if (field in body) update[field] = nullableString(body[field]);
  }

  if ("source_url" in update && update.source_url && !isValidUrl(String(update.source_url))) {
    return NextResponse.json({ error: "source_url must be a valid URL" }, { status: 422 });
  }

  for (const field of ["requirements", "responsibilities", "conditions", "benefits", "skills"]) {
    if (field in body) update[field] = stringArray(body[field]);
  }

  for (const field of [
    "mentions_official_employment",
    "mentions_booking",
    "mentions_probation",
    "mentions_bonus",
  ]) {
    if (field in body) update[field] = Boolean(body[field]);
  }

  if ("collected_at" in body) update.collected_at = nullableDate(body.collected_at);

  if ("status" in body) {
    if (!VALID_STATUSES.has(body.status as CompanyOpenFactStatus)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 422 });
    }
    update.status = body.status;
    if (body.status !== "verified") update.is_public = false;
  }

  if ("is_public" in body) update.is_public = Boolean(body.is_public);

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  try {
    const client = getServiceClient();

    if (update.is_public === true && "status" in update && update.status !== "verified") {
      return NextResponse.json(
        { error: "is_public=true is allowed only for verified open facts" },
        { status: 422 }
      );
    }

    if (update.is_public === true && update.status !== "verified") {
      const { data: current, error: currentError } = await client
        .from("company_open_facts")
        .select("status")
        .eq("id", id)
        .single();

      if (currentError || !current) {
        return NextResponse.json({ error: "Open fact not found" }, { status: 404 });
      }

      const currentStatus = (current as { status?: string }).status;
      if (currentStatus !== "verified") {
        return NextResponse.json(
          { error: "is_public=true is allowed only for verified open facts" },
          { status: 422 }
        );
      }
    }

    const { error } = await client
      .from("company_open_facts")
      .update(update)
      .eq("id", id);

    if (error) {
      console.error("[company-open-facts PATCH]", error.message);
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
      .from("company_open_facts")
      .delete()
      .eq("id", id);

    if (error) {
      console.error("[company-open-facts DELETE]", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, deleted: id });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
