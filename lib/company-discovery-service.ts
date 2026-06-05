// Server helpers for public.company_discovery_queue.
// Candidate companies from open sources are reviewed here before insertion.

import { getServiceClient } from "./supabase/server";
import { generateCompanySlug } from "./company-matching";
import type {
  CompanyDiscoveryMatchConfidence,
  CompanyDiscoveryQueueItem,
  CompanyDiscoveryStatus,
} from "./types";

type DiscoveryRow = Record<string, unknown>;

export interface CompanyDiscoveryInput {
  discovered_name: string;
  suggested_slug?: string | null;
  source_name: string;
  source_url?: string | null;
  city?: string | null;
  industry?: string | null;
  description?: string | null;
  company_size?: string | null;
  matched_existing_slug?: string | null;
  match_confidence?: CompanyDiscoveryMatchConfidence;
  status?: CompanyDiscoveryStatus;
  is_imported?: boolean;
  imported_company_slug?: string | null;
  raw_excerpt?: string | null;
  collected_at?: string | null;
  admin_note?: string | null;
}

export const COMPANY_DISCOVERY_STATUSES: CompanyDiscoveryStatus[] = [
  "needs_review",
  "auto_imported",
  "matched_existing",
  "rejected",
];

export const COMPANY_DISCOVERY_CONFIDENCES: CompanyDiscoveryMatchConfidence[] = [
  "low",
  "medium",
  "high",
];

const SELECT_COLUMNS = [
  "id",
  "discovered_name",
  "suggested_slug",
  "source_name",
  "source_url",
  "city",
  "industry",
  "description",
  "company_size",
  "matched_existing_slug",
  "match_confidence",
  "status",
  "is_imported",
  "imported_company_slug",
  "raw_excerpt",
  "collected_at",
  "admin_note",
  "created_at",
  "updated_at",
].join(", ");

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function statusOrDefault(value: unknown): CompanyDiscoveryStatus {
  return COMPANY_DISCOVERY_STATUSES.includes(value as CompanyDiscoveryStatus)
    ? value as CompanyDiscoveryStatus
    : "needs_review";
}

function confidenceOrDefault(value: unknown): CompanyDiscoveryMatchConfidence {
  return COMPANY_DISCOVERY_CONFIDENCES.includes(value as CompanyDiscoveryMatchConfidence)
    ? value as CompanyDiscoveryMatchConfidence
    : "low";
}

export function rowToCompanyDiscovery(row: DiscoveryRow): CompanyDiscoveryQueueItem {
  return {
    id: String(row.id),
    discoveredName: String(row.discovered_name),
    suggestedSlug: String(row.suggested_slug),
    sourceName: String(row.source_name),
    sourceUrl: textOrNull(row.source_url),
    city: textOrNull(row.city),
    industry: textOrNull(row.industry),
    description: textOrNull(row.description),
    companySize: textOrNull(row.company_size),
    matchedExistingSlug: textOrNull(row.matched_existing_slug),
    matchConfidence: confidenceOrDefault(row.match_confidence),
    status: statusOrDefault(row.status),
    isImported: Boolean(row.is_imported),
    importedCompanySlug: textOrNull(row.imported_company_slug),
    rawExcerpt: textOrNull(row.raw_excerpt),
    collectedAt: textOrNull(row.collected_at),
    adminNote: textOrNull(row.admin_note),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function isMissingTableError(error: { code?: string; message?: string } | null): boolean {
  return error?.code === "42P01" || /company_discovery_queue|schema cache|does not exist/i.test(error?.message ?? "");
}

function cleanInput(input: CompanyDiscoveryInput) {
  const discoveredName = input.discovered_name.trim();
  const suggestedSlug = (input.suggested_slug?.trim() || generateCompanySlug(discoveredName)).toLowerCase();
  const status = input.status ?? "needs_review";
  return {
    discovered_name: discoveredName,
    suggested_slug: suggestedSlug,
    source_name: input.source_name.trim(),
    source_url: input.source_url?.trim() || null,
    city: input.city?.trim() || null,
    industry: input.industry?.trim() || null,
    description: input.description?.trim() || null,
    company_size: input.company_size?.trim() || null,
    matched_existing_slug: input.matched_existing_slug?.trim() || null,
    match_confidence: input.match_confidence ?? "low",
    status,
    is_imported: status === "auto_imported" ? Boolean(input.is_imported) : false,
    imported_company_slug: input.imported_company_slug?.trim() || null,
    raw_excerpt: input.raw_excerpt?.trim().slice(0, 1500) || null,
    collected_at: input.collected_at ?? new Date().toISOString(),
    admin_note: input.admin_note?.trim() || null,
  };
}

export async function getAdminCompanyDiscoveryQueue(): Promise<CompanyDiscoveryQueueItem[]> {
  try {
    const client = getServiceClient();
    const { data, error } = await client
      .from("company_discovery_queue")
      .select(SELECT_COLUMNS)
      .order("created_at", { ascending: false })
      .limit(300);

    if (error || !data) return [];
    return (data as unknown as DiscoveryRow[]).map(rowToCompanyDiscovery);
  } catch {
    return [];
  }
}

export async function upsertCompanyDiscoveryQueue(
  input: CompanyDiscoveryInput
): Promise<{ ok: true; created: boolean; id?: string } | { ok: false; error: string; missingTable?: boolean }> {
  const row = cleanInput(input);
  if (!row.discovered_name || !row.suggested_slug || !row.source_name) {
    return { ok: false, error: "discovered_name, suggested_slug and source_name are required" };
  }

  try {
    const client = getServiceClient();
    if (row.source_url) {
      const { data: existing, error: existingError } = await client
        .from("company_discovery_queue")
        .select("id")
        .eq("source_url", row.source_url)
        .eq("suggested_slug", row.suggested_slug)
        .maybeSingle();

      if (existingError) return { ok: false, error: existingError.message, missingTable: isMissingTableError(existingError) };
      if (existing && typeof existing.id === "string") {
        const { error } = await client
          .from("company_discovery_queue")
          .update(row)
          .eq("id", existing.id);
        if (error) return { ok: false, error: error.message, missingTable: isMissingTableError(error) };
        return { ok: true, created: false, id: existing.id };
      }
    }

    const { data, error } = await client
      .from("company_discovery_queue")
      .insert(row)
      .select("id")
      .single();
    if (error) return { ok: false, error: error.message, missingTable: isMissingTableError(error) };
    return { ok: true, created: true, id: typeof data?.id === "string" ? data.id : undefined };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function createCompanyFromDiscovery(
  id: string,
  override?: Partial<Pick<CompanyDiscoveryInput, "discovered_name" | "suggested_slug" | "city" | "industry" | "description">>
): Promise<{ ok: true; slug: string; created: boolean } | { ok: false; error: string }> {
  try {
    const client = getServiceClient();
    const { data: row, error: rowError } = await client
      .from("company_discovery_queue")
      .select(SELECT_COLUMNS)
      .eq("id", id)
      .single();

    if (rowError || !row) return { ok: false, error: rowError?.message ?? "Discovery row not found" };
    const item = rowToCompanyDiscovery(row as unknown as DiscoveryRow);
    const name = override?.discovered_name?.trim() || item.discoveredName;
    const slug = (override?.suggested_slug?.trim() || item.suggestedSlug || generateCompanySlug(name)).toLowerCase();
    if (!name || !slug) return { ok: false, error: "name and slug are required" };

    const { data: existing, error: existingError } = await client
      .from("companies")
      .select("slug")
      .eq("slug", slug)
      .maybeSingle();
    if (existingError) return { ok: false, error: existingError.message };
    if (existing) return { ok: false, error: "Company slug already exists: " + slug };

    const { error: insertError } = await client.from("companies").insert({
      name,
      slug,
      city: override?.city ?? item.city,
      industry: override?.industry ?? item.industry,
      verified: false,
    });
    if (insertError) return { ok: false, error: insertError.message };

    const { error: updateError } = await client
      .from("company_discovery_queue")
      .update({
        discovered_name: name,
        suggested_slug: slug,
        city: override?.city ?? item.city,
        industry: override?.industry ?? item.industry,
        description: override?.description ?? item.description,
        status: "auto_imported",
        is_imported: true,
        imported_company_slug: slug,
      })
      .eq("id", id);
    if (updateError) return { ok: false, error: updateError.message };

    if (item.sourceUrl) {
      await client
        .from("company_open_facts")
        .update({ company_slug: slug, company_name: name })
        .eq("source_url", item.sourceUrl)
        .eq("company_slug", item.suggestedSlug);
    }

    return { ok: true, slug, created: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function linkDiscoveryToCompany(
  id: string,
  companySlug: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const client = getServiceClient();
    const { data: row, error: rowError } = await client
      .from("company_discovery_queue")
      .select(SELECT_COLUMNS)
      .eq("id", id)
      .single();
    if (rowError || !row) return { ok: false, error: rowError?.message ?? "Discovery row not found" };
    const item = rowToCompanyDiscovery(row as unknown as DiscoveryRow);

    const { data: existing, error: existingError } = await client
      .from("companies")
      .select("slug, name")
      .eq("slug", companySlug)
      .maybeSingle();
    if (existingError) return { ok: false, error: existingError.message };
    if (!existing) return { ok: false, error: "Company not found: " + companySlug };

    const { error } = await client
      .from("company_discovery_queue")
      .update({
        matched_existing_slug: companySlug,
        match_confidence: "high",
        status: "matched_existing",
        is_imported: false,
        imported_company_slug: companySlug,
      })
      .eq("id", id);
    if (error) return { ok: false, error: error.message };

    if (item.sourceUrl) {
      await client
        .from("company_open_facts")
        .update({
          company_slug: companySlug,
          company_name: String((existing as { name?: string }).name ?? item.discoveredName),
        })
        .eq("source_url", item.sourceUrl)
        .eq("company_slug", item.suggestedSlug);
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
