import { createHash, randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth-server";
import { getClientIp } from "@/lib/rate-limit";
import { slugifyCompanyName } from "@/lib/slugify";
import { analyzeEmployer, type AnalyzeEmployerContext } from "@/lib/ai/analyze-employer";
import { findEmployerExternalSources } from "@/lib/ai/external-source-finder";
import { readVacancyUrl } from "@/lib/ai/safe-vacancy-url-reader";
import type { AiAnalysisType, AiFetchStatus, ExternalSourceCandidate } from "@/lib/ai/types";
import type { ExternalRating, ExternalReviewSignal, RiskLevel } from "@/lib/types";

export const runtime = "nodejs";

const ANON_COOKIE = "wr_anonymous_id";
const DAY_MS = 24 * 60 * 60 * 1000;

interface AnalyzeBody {
  type?: unknown;
  companySlug?: unknown;
  companyName?: unknown;
  vacancyText?: unknown;
  vacancyUrl?: unknown;
  includeExternalSearch?: unknown;
}

interface CompanyRow {
  slug: string;
  name: string;
  city: string | null;
  industry: string | null;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function ipHash(req: NextRequest): string {
  const ip = getClientIp(req);
  const secret = process.env.AI_ANALYSIS_IP_HASH_SALT ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "workradar-local";
  return createHash("sha256").update(`${secret}:${ip}`).digest("hex");
}

function asAnalysisType(value: unknown): AiAnalysisType | null {
  return value === "vacancy" || value === "company" ? value : null;
}

async function resolveCompany(
  companySlug: string | null,
  companyName: string | null
): Promise<CompanyRow | null> {
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
    .limit(1)
    .maybeSingle();
  return data ? data as CompanyRow : null;
}

async function countUsage(params: {
  userId: string | null;
  anonymousId: string | null;
  ipHashValue: string;
}): Promise<number> {
  const client = getServiceClient();
  const since = new Date(Date.now() - DAY_MS).toISOString();
  let query = client
    .from("ai_analysis_requests")
    .select("id", { count: "exact", head: true })
    .gte("created_at", since);

  if (params.userId) {
    query = query.eq("user_id", params.userId);
  } else if (params.anonymousId) {
    query = query.eq("anonymous_id", params.anonymousId);
  } else {
    query = query.eq("ip_hash", params.ipHashValue);
  }

  const { count, error } = await query;
  if (error) {
    console.warn("[ai/analyze] usage count failed:", error.message);
    return 0;
  }
  return count ?? 0;
}

async function loadContext(company: CompanyRow | null): Promise<{
  reviews: AnalyzeEmployerContext["internalReviews"];
  openFacts: AnalyzeEmployerContext["openFacts"];
  externalRatings: ExternalRating[];
  externalSignals: ExternalReviewSignal[];
}> {
  if (!company) {
    return { reviews: [], openFacts: [], externalRatings: [], externalSignals: [] };
  }

  const client = getServiceClient();
  const [reviews, openFacts, ratings, signals] = await Promise.all([
    client
      .from("reviews")
      .select("id, role_category, city, year, text")
      .eq("company_slug", company.slug)
      .eq("status", "published")
      .order("created_at", { ascending: false })
      .limit(10),
    client
      .from("company_open_facts")
      .select("source_name, source_url, vacancy_title, city, salary_text, employment_type, schedule, raw_excerpt")
      .eq("company_slug", company.slug)
      .eq("status", "verified")
      .eq("is_public", true)
      .order("collected_at", { ascending: false, nullsFirst: false })
      .limit(12),
    client
      .from("external_ratings")
      .select("*")
      .eq("company_slug", company.slug)
      .eq("status", "verified")
      .eq("is_public", true)
      .limit(12),
    client
      .from("external_review_signals")
      .select("*")
      .eq("company_slug", company.slug)
      .eq("status", "verified")
      .eq("is_public", true)
      .limit(12),
  ]);

  return {
    reviews: ((reviews.data ?? []) as Record<string, unknown>[]).map((row) => ({
      id: String(row.id),
      roleCategory: typeof row.role_category === "string" ? row.role_category : null,
      city: typeof row.city === "string" ? row.city : null,
      year: typeof row.year === "number" ? row.year : null,
      text: typeof row.text === "string" ? row.text.slice(0, 700) : null,
    })),
    openFacts: ((openFacts.data ?? []) as Record<string, unknown>[]).map((row) => ({
      sourceName: String(row.source_name ?? ""),
      sourceUrl: typeof row.source_url === "string" ? row.source_url : null,
      vacancyTitle: typeof row.vacancy_title === "string" ? row.vacancy_title : null,
      city: typeof row.city === "string" ? row.city : null,
      salaryText: typeof row.salary_text === "string" ? row.salary_text : null,
      employmentType: typeof row.employment_type === "string" ? row.employment_type : null,
      schedule: typeof row.schedule === "string" ? row.schedule : null,
      rawExcerpt: typeof row.raw_excerpt === "string" ? row.raw_excerpt.slice(0, 1200) : null,
    })),
    externalRatings: ((ratings.data ?? []) as Record<string, unknown>[]).map((row) => ({
      id: String(row.id),
      companySlug: String(row.company_slug),
      companyName: String(row.company_name),
      sourceName: String(row.source_name),
      sourceUrl: typeof row.source_url === "string" ? row.source_url : null,
      ratingValue: typeof row.rating_value === "number" ? row.rating_value : null,
      ratingScale: typeof row.rating_scale === "number" ? row.rating_scale : null,
      reviewsCount: typeof row.reviews_count === "number" ? row.reviews_count : 0,
      fetchedAt: typeof row.fetched_at === "string" ? row.fetched_at : null,
      status: String(row.status) as ExternalRating["status"],
      isPublic: Boolean(row.is_public),
      note: typeof row.note === "string" ? row.note : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    })),
    externalSignals: ((signals.data ?? []) as Record<string, unknown>[]).map((row) => ({
      id: String(row.id),
      companySlug: String(row.company_slug),
      companyName: String(row.company_name),
      sourceName: String(row.source_name),
      sourceUrl: typeof row.source_url === "string" ? row.source_url : null,
      topic: String(row.topic) as ExternalReviewSignal["topic"],
      sentiment: String(row.sentiment) as ExternalReviewSignal["sentiment"],
      summary: String(row.summary ?? ""),
      mentionsCount: Number(row.mentions_count ?? 1),
      sampleSize: typeof row.sample_size === "number" ? row.sample_size : null,
      confidence: String(row.confidence ?? "medium") as ExternalReviewSignal["confidence"],
      collectedAt: typeof row.collected_at === "string" ? row.collected_at : null,
      status: String(row.status) as ExternalReviewSignal["status"],
      isPublic: Boolean(row.is_public),
      adminNote: typeof row.admin_note === "string" ? row.admin_note : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    })),
  };
}

async function insertHistory(params: {
  userId: string | null;
  anonymousId: string | null;
  ipHashValue: string;
  analysisType: AiAnalysisType;
  companySlug: string | null;
  companyName: string | null;
  inputText: string | null;
  inputUrl: string | null;
  fetchedText: string | null;
  fetchStatus: AiFetchStatus;
  resultJson: unknown;
  sourcesJson: ExternalSourceCandidate[];
  riskLevel: RiskLevel;
  riskScore: number | null;
  confidenceLevel: string;
}) {
  const client = getServiceClient();
  const { error } = await client.from("ai_analysis_requests").insert({
    user_id: params.userId,
    anonymous_id: params.anonymousId,
    ip_hash: params.ipHashValue,
    analysis_type: params.analysisType,
    company_slug: params.companySlug,
    company_name: params.companyName,
    input_text: params.inputText,
    input_url: params.inputUrl,
    fetched_text: params.fetchedText,
    fetch_status: params.fetchStatus,
    result_json: params.resultJson,
    sources_json: params.sourcesJson,
    risk_level: params.riskLevel,
    risk_score: params.riskScore,
    confidence_level: params.confidenceLevel,
  });
  if (error) {
    console.warn("[ai/analyze] history insert failed:", error.message);
  }
}

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const existingAnonymousId = req.cookies.get(ANON_COOKIE)?.value ?? null;
  const anonymousId = user ? null : existingAnonymousId ?? randomUUID();
  const ipHashValue = ipHash(req);
  const limit = user ? 5 : 3;
  const used = await countUsage({
    userId: user?.id ?? null,
    anonymousId: existingAnonymousId,
    ipHashValue,
  });

  const response = NextResponse.json({
    usage: {
      limit,
      used,
      remaining: Math.max(0, limit - used),
    },
  });
  if (!user && anonymousId && !existingAnonymousId) {
    response.cookies.set(ANON_COOKIE, anonymousId, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  }
  return response;
}

export async function POST(req: NextRequest) {
  let body: AnalyzeBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const analysisType = asAnalysisType(body.type);
  if (!analysisType) {
    return NextResponse.json({ error: "invalid_type" }, { status: 422 });
  }

  const user = await getAuthUser(req);
  const existingAnonymousId = req.cookies.get(ANON_COOKIE)?.value ?? null;
  const anonymousId = user ? null : existingAnonymousId ?? randomUUID();
  const ipHashValue = ipHash(req);
  const limit = user ? 5 : 3;
  const usedBefore = await countUsage({
    userId: user?.id ?? null,
    anonymousId: existingAnonymousId,
    ipHashValue,
  });

  if (usedBefore >= limit) {
    const response = NextResponse.json(
      {
        error: "daily_limit_exceeded",
        message: "Ліміт безкоштовних перевірок на сьогодні вичерпано. Спробуйте завтра.",
      },
      { status: 429 }
    );
    if (!user && anonymousId && !existingAnonymousId) {
      response.cookies.set(ANON_COOKIE, anonymousId, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
    }
    return response;
  }

  const inputCompanySlug = optionalString(body.companySlug);
  let inputCompanyName = optionalString(body.companyName);
  const vacancyUrl = optionalString(body.vacancyUrl);
  const vacancyText = optionalString(body.vacancyText);
  const includeExternalSearch = body.includeExternalSearch !== false;

  let fetchedText: string | null = null;
  let fetchStatus: AiFetchStatus = "not_requested";
  let fetchMessage: string | null = null;
  let fetchedTitle: string | null = null;

  if (vacancyUrl) {
    const read = await readVacancyUrl(vacancyUrl);
    fetchStatus = read.status;
    fetchMessage = read.reason ?? null;
    if (read.status === "success") {
      fetchedText = read.text ?? null;
      fetchedTitle = read.title ?? null;
      inputCompanyName = inputCompanyName ?? read.companyName ?? null;
    } else if (analysisType === "vacancy" && !vacancyText) {
      const response = NextResponse.json(
        {
          error: "vacancy_text_required",
          message: "Не вдалося автоматично зчитати вакансію. Вставте текст вакансії вручну.",
          fetch: { status: read.status, message: read.reason },
        },
        { status: 422 }
      );
      if (!user && anonymousId && !existingAnonymousId) {
        response.cookies.set(ANON_COOKIE, anonymousId, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
      }
      return response;
    }
  }

  const company = await resolveCompany(inputCompanySlug, inputCompanyName);
  const finalCompanySlug = company?.slug ?? inputCompanySlug;
  const finalCompanyName = company?.name ?? inputCompanyName;

  if (analysisType === "company" && !finalCompanySlug && !finalCompanyName) {
    return NextResponse.json({ error: "company_required" }, { status: 422 });
  }

  if (analysisType === "vacancy" && !vacancyText && !fetchedText) {
    return NextResponse.json({ error: "vacancy_text_required", message: "Вставте текст вакансії або URL." }, { status: 422 });
  }

  const contextData = await loadContext(company);
  const finder = includeExternalSearch
    ? await findEmployerExternalSources({
        companyName: finalCompanyName,
        companySlug: finalCompanySlug,
        vacancyUrl,
        vacancyText: vacancyText ?? fetchedText,
      })
    : { sources: [], warnings: ["Пошук відкритих джерел вимкнено."] };

  const context: AnalyzeEmployerContext = {
    analysisType,
    company: {
      slug: finalCompanySlug ?? null,
      name: finalCompanyName ?? null,
      city: company?.city ?? null,
      industry: company?.industry ?? null,
    },
    vacancyText: vacancyText ?? "",
    vacancyUrl,
    fetchedText: fetchedText ?? "",
    internalReviews: contextData.reviews,
    openFacts: contextData.openFacts,
    externalRatings: contextData.externalRatings,
    externalSignals: contextData.externalSignals,
    foundExternalSources: finder.sources,
  };

  const analysis = await analyzeEmployer(context);
  await insertHistory({
    userId: user?.id ?? null,
    anonymousId,
    ipHashValue,
    analysisType,
    companySlug: finalCompanySlug ?? null,
    companyName: finalCompanyName ?? null,
    inputText: vacancyText,
    inputUrl: vacancyUrl,
    fetchedText,
    fetchStatus,
    resultJson: analysis,
    sourcesJson: finder.sources,
    riskLevel: analysis.risk_level,
    riskScore: analysis.risk_score,
    confidenceLevel: analysis.confidence_level,
  });

  const response = NextResponse.json({
    analysis: {
      ...analysis,
      fetched_title: fetchedTitle,
      finder_warnings: finder.warnings,
    },
    usage: {
      limit,
      used: usedBefore + 1,
      remaining: Math.max(0, limit - usedBefore - 1),
    },
    fetch: {
      status: fetchStatus,
      message: fetchMessage ?? undefined,
    },
    sources: finder.sources,
  });

  if (!user && anonymousId && !existingAnonymousId) {
    response.cookies.set(ANON_COOKIE, anonymousId, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  }
  return response;
}
