import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth-server";
import { discoverExternalSourcesForCompany } from "@/lib/external/source-discovery";
import { slugifyCompanyName } from "@/lib/slugify";

interface CompanyRow {
  slug: string;
  name: string;
  city: string | null;
  industry: string | null;
}

async function checkAdminAuth(
  req: NextRequest
): Promise<{ ok: true } | { ok: false; status: 401 | 403; error: string }> {
  return requireAdmin(req);
}

function optionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function optionalNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function optionalBoolean(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

async function resolveCompany(companySlug: string | null, companyName: string | null): Promise<CompanyRow | null> {
  const client = getServiceClient();
  if (companySlug) {
    const { data } = await client
      .from("companies")
      .select("slug, name, city, industry")
      .eq("slug", companySlug)
      .maybeSingle();
    if (data) return data as CompanyRow;
  }

  if (!companyName) return null;
  const generatedSlug = slugifyCompanyName(companyName);
  if (generatedSlug) {
    const { data } = await client
      .from("companies")
      .select("slug, name, city, industry")
      .eq("slug", generatedSlug)
      .maybeSingle();
    if (data) return data as CompanyRow;
  }

  const { data } = await client
    .from("companies")
    .select("slug, name, city, industry")
    .ilike("name", companyName)
    .maybeSingle();
  return data ? (data as CompanyRow) : null;
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

  const inputCompanySlug = optionalString(body.companySlug) ?? optionalString(body.company_slug);
  const inputCompanyName = optionalString(body.companyName) ?? optionalString(body.company_name);
  const limit = optionalNumber(body.limit, 50);
  const dryRun = optionalBoolean(body.dryRun ?? body.dry_run);

  const company = await resolveCompany(inputCompanySlug, inputCompanyName);
  if (!company && !inputCompanySlug && !inputCompanyName) {
    return NextResponse.json({ error: "companySlug or companyName is required" }, { status: 422 });
  }
  if (!company) {
    return NextResponse.json({ error: "Company not found" }, { status: 422 });
  }

  const result = await discoverExternalSourcesForCompany({
    companySlug: company.slug,
    companyName: company.name,
    aliases: [],
    industry: company.industry,
    limit,
    dryRun,
  });

  return NextResponse.json({
    ok: true,
    company: {
      slug: company.slug,
      name: company.name,
      city: company.city,
      industry: company.industry,
    },
    stats: result.stats,
    warnings: result.warnings,
    candidates: result.sources,
    dryRun,
  });
}

