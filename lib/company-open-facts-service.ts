// Server helpers for public.company_open_facts.
// These are facts from open vacancy pages, not reviews or ratings.

import { getServerClient, getServiceClient } from "./supabase/server";
import type { CompanyOpenFact, CompanyOpenFactStatus } from "./types";

type CompanyOpenFactRow = Record<string, unknown>;

export interface CompanyOpenFactSummary {
  companySlug: string;
  factsCount: number;
  sourceCount: number;
  sources: string[];
  cities: string[];
  salaryExamples: string[];
  vacancyTitles: string[];
  schedules: string[];
  employmentTypes: string[];
  benefits: string[];
  requirements: string[];
  conditions: string[];
  hasOfficialEmploymentMention: boolean;
  hasBookingMention: boolean;
  hasBonusMention: boolean;
  companyDescription: string | null;
  latestCollectedAt: string | null;
}

export type CompanyOpenFactSummaryBySlug = Record<string, CompanyOpenFactSummary>;

export interface CompanyOpenFactInput {
  company_slug: string;
  company_name: string;
  source_name: string;
  source_url?: string | null;
  vacancy_title?: string | null;
  city?: string | null;
  salary_text?: string | null;
  employment_type?: string | null;
  schedule?: string | null;
  experience?: string | null;
  education?: string | null;
  company_description?: string | null;
  vacancy_description?: string | null;
  requirements?: string[];
  responsibilities?: string[];
  conditions?: string[];
  benefits?: string[];
  skills?: string[];
  mentions_official_employment?: boolean;
  mentions_booking?: boolean;
  mentions_probation?: boolean;
  mentions_bonus?: boolean;
  raw_excerpt?: string | null;
  collected_at?: string | null;
  status?: CompanyOpenFactStatus;
  is_public?: boolean;
}

const SELECT_COLUMNS = [
  "id",
  "company_slug",
  "company_name",
  "source_name",
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
  "requirements",
  "responsibilities",
  "conditions",
  "benefits",
  "skills",
  "mentions_official_employment",
  "mentions_booking",
  "mentions_probation",
  "mentions_bonus",
  "raw_excerpt",
  "collected_at",
  "status",
  "is_public",
  "created_at",
  "updated_at",
].join(", ");

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function textArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function toStatus(value: unknown): CompanyOpenFactStatus {
  return value === "verified" || value === "rejected" ? value : "needs_verification";
}

export function rowToCompanyOpenFact(row: CompanyOpenFactRow): CompanyOpenFact {
  return {
    id: String(row.id),
    companySlug: String(row.company_slug),
    companyName: String(row.company_name),
    sourceName: String(row.source_name),
    sourceUrl: textOrNull(row.source_url),
    vacancyTitle: textOrNull(row.vacancy_title),
    city: textOrNull(row.city),
    salaryText: textOrNull(row.salary_text),
    employmentType: textOrNull(row.employment_type),
    schedule: textOrNull(row.schedule),
    experience: textOrNull(row.experience),
    education: textOrNull(row.education),
    companyDescription: textOrNull(row.company_description),
    vacancyDescription: textOrNull(row.vacancy_description),
    requirements: textArray(row.requirements),
    responsibilities: textArray(row.responsibilities),
    conditions: textArray(row.conditions),
    benefits: textArray(row.benefits),
    skills: textArray(row.skills),
    mentionsOfficialEmployment: Boolean(row.mentions_official_employment),
    mentionsBooking: Boolean(row.mentions_booking),
    mentionsProbation: Boolean(row.mentions_probation),
    mentionsBonus: Boolean(row.mentions_bonus),
    rawExcerpt: textOrNull(row.raw_excerpt),
    collectedAt: textOrNull(row.collected_at),
    status: toStatus(row.status),
    isPublic: Boolean(row.is_public),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function uniqueLimited(items: Array<string | null | undefined>, limit: number): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const value = item?.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
    if (result.length >= limit) break;
  }
  return result;
}

function emptySummary(companySlug: string): CompanyOpenFactSummary {
  return {
    companySlug,
    factsCount: 0,
    sourceCount: 0,
    sources: [],
    cities: [],
    salaryExamples: [],
    vacancyTitles: [],
    schedules: [],
    employmentTypes: [],
    benefits: [],
    requirements: [],
    conditions: [],
    hasOfficialEmploymentMention: false,
    hasBookingMention: false,
    hasBonusMention: false,
    companyDescription: null,
    latestCollectedAt: null,
  };
}

function buildSummary(companySlug: string, facts: CompanyOpenFact[]): CompanyOpenFactSummary {
  if (facts.length === 0) return emptySummary(companySlug);

  const sources = uniqueLimited(facts.map((fact) => fact.sourceName), 5);
  const collectedTimes = facts
    .map((fact) => fact.collectedAt)
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value));
  const latestTime = collectedTimes.length ? Math.max(...collectedTimes) : null;

  return {
    companySlug,
    factsCount: facts.length,
    sourceCount: sources.length,
    sources,
    cities: uniqueLimited(facts.map((fact) => fact.city), 5),
    salaryExamples: uniqueLimited(facts.map((fact) => fact.salaryText), 5),
    vacancyTitles: uniqueLimited(facts.map((fact) => fact.vacancyTitle), 5),
    schedules: uniqueLimited(facts.map((fact) => fact.schedule), 5),
    employmentTypes: uniqueLimited(facts.map((fact) => fact.employmentType), 5),
    benefits: uniqueLimited(facts.flatMap((fact) => fact.benefits), 5),
    requirements: uniqueLimited(facts.flatMap((fact) => fact.requirements), 5),
    conditions: uniqueLimited(facts.flatMap((fact) => fact.conditions), 5),
    hasOfficialEmploymentMention: facts.some((fact) => fact.mentionsOfficialEmployment),
    hasBookingMention: facts.some((fact) => fact.mentionsBooking),
    hasBonusMention: facts.some((fact) => fact.mentionsBonus),
    companyDescription: uniqueLimited(facts.map((fact) => fact.companyDescription), 1)[0] ?? null,
    latestCollectedAt: latestTime === null ? null : new Date(latestTime).toISOString(),
  };
}

function isMissingTableError(error: { code?: string; message?: string } | null): boolean {
  return error?.code === "42P01" || /company_open_facts/i.test(error?.message ?? "");
}

export async function getPublicCompanyOpenFacts(companySlug: string): Promise<CompanyOpenFact[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!url || !key) return [];

  try {
    const client = getServerClient();
    const { data, error } = await client
      .from("company_open_facts")
      .select(SELECT_COLUMNS)
      .eq("company_slug", companySlug)
      .eq("status", "verified")
      .eq("is_public", true)
      .order("collected_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });

    if (error || !data) return [];
    return data.map((row) => rowToCompanyOpenFact(row as unknown as CompanyOpenFactRow));
  } catch {
    return [];
  }
}

export async function getPublicCompanyOpenFactsSummary(
  companySlug: string
): Promise<CompanyOpenFactSummary> {
  const facts = await getPublicCompanyOpenFacts(companySlug);
  return buildSummary(companySlug, facts);
}

export async function getPublicCompanyOpenFactsSummariesForCompanies(): Promise<CompanyOpenFactSummaryBySlug> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!url || !key) return {};

  try {
    const client = getServerClient();
    const { data, error } = await client
      .from("company_open_facts")
      .select(SELECT_COLUMNS)
      .eq("status", "verified")
      .eq("is_public", true);

    if (error || !data) return {};

    const grouped: Record<string, CompanyOpenFact[]> = {};
    for (const row of data as unknown as CompanyOpenFactRow[]) {
      const fact = rowToCompanyOpenFact(row);
      if (!grouped[fact.companySlug]) grouped[fact.companySlug] = [];
      grouped[fact.companySlug].push(fact);
    }

    const result: CompanyOpenFactSummaryBySlug = {};
    for (const [companySlug, facts] of Object.entries(grouped)) {
      result[companySlug] = buildSummary(companySlug, facts);
    }
    return result;
  } catch {
    return {};
  }
}

export async function getAdminCompanyOpenFacts(): Promise<CompanyOpenFact[]> {
  try {
    const client = getServiceClient();
    const { data, error } = await client
      .from("company_open_facts")
      .select(SELECT_COLUMNS)
      .order("created_at", { ascending: false })
      .limit(300);

    if (error || !data) return [];
    return data.map((row) => rowToCompanyOpenFact(row as unknown as CompanyOpenFactRow));
  } catch {
    return [];
  }
}

export async function upsertCompanyOpenFactFromVacancy(
  input: CompanyOpenFactInput
): Promise<{ ok: true; skipped?: false } | { ok: false; error: string; missingTable?: boolean }> {
  if (!input.company_slug.trim() || !input.company_name.trim() || !input.source_name.trim()) {
    return { ok: false, error: "company_slug, company_name and source_name are required" };
  }

  const row = {
    company_slug: input.company_slug.trim(),
    company_name: input.company_name.trim(),
    source_name: input.source_name.trim(),
    source_url: input.source_url?.trim() || null,
    vacancy_title: input.vacancy_title?.trim() || null,
    city: input.city?.trim() || null,
    salary_text: input.salary_text?.trim() || null,
    employment_type: input.employment_type?.trim() || null,
    schedule: input.schedule?.trim() || null,
    experience: input.experience?.trim() || null,
    education: input.education?.trim() || null,
    company_description: input.company_description?.trim() || null,
    vacancy_description: input.vacancy_description?.trim() || null,
    requirements: input.requirements ?? [],
    responsibilities: input.responsibilities ?? [],
    conditions: input.conditions ?? [],
    benefits: input.benefits ?? [],
    skills: input.skills ?? [],
    mentions_official_employment: Boolean(input.mentions_official_employment),
    mentions_booking: Boolean(input.mentions_booking),
    mentions_probation: Boolean(input.mentions_probation),
    mentions_bonus: Boolean(input.mentions_bonus),
    raw_excerpt: input.raw_excerpt?.trim() || null,
    collected_at: input.collected_at ?? new Date().toISOString(),
    status: input.status ?? "needs_verification",
    is_public: input.status === "verified" ? Boolean(input.is_public) : false,
  };

  try {
    const client = getServiceClient();
    const sourceUrl = row.source_url;

    if (sourceUrl) {
      const { data: existing, error: existingError } = await client
        .from("company_open_facts")
        .select("id")
        .eq("company_slug", row.company_slug)
        .eq("source_url", sourceUrl)
        .maybeSingle();

      if (existingError && !isMissingTableError(existingError)) {
        return { ok: false, error: existingError.message };
      }
      if (existingError && isMissingTableError(existingError)) {
        return { ok: false, error: existingError.message, missingTable: true };
      }

      if (existing && typeof existing.id === "string") {
        const { error } = await client
          .from("company_open_facts")
          .update(row)
          .eq("id", existing.id);
        if (error) return { ok: false, error: error.message, missingTable: isMissingTableError(error) };
        return { ok: true };
      }
    }

    const { error } = await client.from("company_open_facts").insert(row);
    if (error) return { ok: false, error: error.message, missingTable: isMissingTableError(error) };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
