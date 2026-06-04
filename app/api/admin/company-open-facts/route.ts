// app/api/admin/company-open-facts/route.ts
// GET  /api/admin/company-open-facts
// POST /api/admin/company-open-facts
// Open vacancy facts are NEVER inserted into public.reviews or external_ratings.

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth-server";
import {
  getAdminCompanyOpenFacts,
  rowToCompanyOpenFact,
} from "@/lib/company-open-facts-service";
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

function optionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function requiredString(value: unknown, field: string): string | NextResponse {
  if (typeof value !== "string" || !value.trim()) {
    return NextResponse.json({ error: `${field} is required` }, { status: 422 });
  }
  return value.trim();
}

function optionalDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/\r?\n|;/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

export async function GET(req: NextRequest) {
  const auth = await checkAdminAuth(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const facts = await getAdminCompanyOpenFacts();
  return NextResponse.json({ facts });
}

export async function POST(req: NextRequest) {
  const auth = await checkAdminAuth(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const companySlug = requiredString(body.company_slug, "company_slug");
  if (companySlug instanceof NextResponse) return companySlug;
  const companyName = requiredString(body.company_name, "company_name");
  if (companyName instanceof NextResponse) return companyName;
  const sourceName = requiredString(body.source_name, "source_name");
  if (sourceName instanceof NextResponse) return sourceName;

  const sourceUrl = optionalString(body.source_url);
  if (sourceUrl && !isValidUrl(sourceUrl)) {
    return NextResponse.json({ error: "source_url must be a valid URL" }, { status: 422 });
  }

  const status = VALID_STATUSES.has(body.status as CompanyOpenFactStatus)
    ? body.status as CompanyOpenFactStatus
    : "needs_verification";
  const isPublic = Boolean(body.is_public);
  if (isPublic && status !== "verified") {
    return NextResponse.json(
      { error: "is_public=true is allowed only for verified open facts" },
      { status: 422 }
    );
  }

  try {
    const client = getServiceClient();
    const { data, error } = await client
      .from("company_open_facts")
      .insert({
        company_slug: companySlug,
        company_name: companyName,
        source_name: sourceName,
        source_url: sourceUrl,
        vacancy_title: optionalString(body.vacancy_title),
        city: optionalString(body.city),
        salary_text: optionalString(body.salary_text),
        employment_type: optionalString(body.employment_type),
        schedule: optionalString(body.schedule),
        experience: optionalString(body.experience),
        education: optionalString(body.education),
        company_description: optionalString(body.company_description),
        vacancy_description: optionalString(body.vacancy_description),
        requirements: stringArray(body.requirements),
        responsibilities: stringArray(body.responsibilities),
        conditions: stringArray(body.conditions),
        benefits: stringArray(body.benefits),
        skills: stringArray(body.skills),
        mentions_official_employment: Boolean(body.mentions_official_employment),
        mentions_booking: Boolean(body.mentions_booking),
        mentions_probation: Boolean(body.mentions_probation),
        mentions_bonus: Boolean(body.mentions_bonus),
        raw_excerpt: optionalString(body.raw_excerpt),
        collected_at: optionalDate(body.collected_at),
        status,
        is_public: isPublic,
      })
      .select("*")
      .single();

    if (error) {
      console.error("[company-open-facts POST]", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, fact: rowToCompanyOpenFact(data) });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
