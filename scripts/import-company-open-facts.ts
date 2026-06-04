// scripts/import-company-open-facts.ts
//
// Imports manually verified company open facts from data/company-open-facts-import.csv.
// This script only writes public.company_open_facts. It never touches reviews,
// external_ratings, external_signals, companies, or internal metrics.
//
// Usage:
//   npx tsx scripts/import-company-open-facts.ts

import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import type { CompanyOpenFactStatus } from "../lib/types";

const INPUT_PATH = "data/company-open-facts-import.csv";
const VALID_STATUSES = new Set<CompanyOpenFactStatus>([
  "needs_verification",
  "verified",
  "rejected",
]);

interface CsvOpenFactRow {
  company_slug: string;
  company_name: string;
  industry: string;
  source_name: string;
  source_url: string;
  vacancy_title: string;
  city: string;
  salary_text: string;
  employment_type: string;
  schedule: string;
  experience: string;
  education: string;
  company_description: string;
  vacancy_description: string;
  requirements: string;
  responsibilities: string;
  conditions: string;
  benefits: string;
  skills: string;
  mentions_official_employment: string;
  mentions_booking: string;
  mentions_probation: string;
  mentions_bonus: string;
  raw_excerpt: string;
  collected_at: string;
  status: string;
  is_public: string;
}

interface ExistingOpenFactRow {
  id: string;
  company_slug: string;
  source_url: string | null;
}

function loadEnvLocal() {
  if (!existsSync(".env.local")) return;
  const content = readFileSync(".env.local", "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (quoted) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") {
      cell += ch;
    }
  }

  if (cell || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

function readCsv(path: string): CsvOpenFactRow[] {
  const rows = parseCsv(readFileSync(path, "utf8"));
  const [header, ...body] = rows;
  const columns = header.map((c) => c.trim());
  return body.map((row) => {
    const item: Record<string, string> = {};
    columns.forEach((column, index) => {
      item[column] = row[index]?.trim() ?? "";
    });
    return item as unknown as CsvOpenFactRow;
  });
}

function parseBoolean(value: string): boolean {
  return ["true", "1", "yes", "так"].includes(value.trim().toLowerCase());
}

function parseDate(value: string): string | null {
  if (!value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseArray(value: string): string[] {
  return value
    .split(/\r?\n|;/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function openFactKey(row: Pick<ExistingOpenFactRow, "company_slug" | "source_url">) {
  return [row.company_slug.trim(), row.source_url?.trim() ?? ""].join("||");
}

async function main() {
  loadEnvLocal();

  if (!existsSync(INPUT_PATH)) {
    console.error(`Missing ${INPUT_PATH}. Copy the template and fill verified rows first.`);
    process.exit(1);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!supabaseUrl || !serviceKey) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }

  const client = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  const rows = readCsv(INPUT_PATH);
  const { data: companies, error: companiesError } = await client
    .from("companies")
    .select("slug, name");

  if (companiesError || !companies) {
    console.error("Could not load companies:", companiesError?.message ?? "No data");
    process.exit(1);
  }

  const companySlugs = new Set((companies as { slug: string }[]).map((c) => c.slug));
  const validRows: Record<string, unknown>[] = [];
  const errors: string[] = [];

  rows.forEach((row, index) => {
    const line = index + 2;
    const rowErrors: string[] = [];
    const companySlug = row.company_slug.trim();
    const sourceName = row.source_name.trim();
    const status = (row.status.trim() || "needs_verification") as CompanyOpenFactStatus;
    const isPublic = parseBoolean(row.is_public);

    if (!companySlug || !companySlugs.has(companySlug)) rowErrors.push(`Line ${line}: invalid company_slug`);
    if (!sourceName) rowErrors.push(`Line ${line}: source_name is required`);
    if (!VALID_STATUSES.has(status)) rowErrors.push(`Line ${line}: invalid status`);
    if (isPublic && status !== "verified") rowErrors.push(`Line ${line}: is_public=true requires status=verified`);
    if (isPublic && (!row.source_url.trim() || !row.raw_excerpt.trim())) {
      rowErrors.push(`Line ${line}: public facts require source_url and raw_excerpt`);
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
      return;
    }

    validRows.push({
      company_slug: companySlug,
      company_name: row.company_name.trim(),
      source_name: sourceName,
      source_url: row.source_url.trim() || null,
      vacancy_title: row.vacancy_title.trim() || null,
      city: row.city.trim() || null,
      salary_text: row.salary_text.trim() || null,
      employment_type: row.employment_type.trim() || null,
      schedule: row.schedule.trim() || null,
      experience: row.experience.trim() || null,
      education: row.education.trim() || null,
      company_description: row.company_description.trim() || null,
      vacancy_description: row.vacancy_description.trim() || null,
      requirements: parseArray(row.requirements),
      responsibilities: parseArray(row.responsibilities),
      conditions: parseArray(row.conditions),
      benefits: parseArray(row.benefits),
      skills: parseArray(row.skills),
      mentions_official_employment: parseBoolean(row.mentions_official_employment),
      mentions_booking: parseBoolean(row.mentions_booking),
      mentions_probation: parseBoolean(row.mentions_probation),
      mentions_bonus: parseBoolean(row.mentions_bonus),
      raw_excerpt: row.raw_excerpt.trim() || null,
      collected_at: parseDate(row.collected_at),
      status,
      is_public: isPublic,
    });
  });

  if (errors.length > 0) {
    console.error(`Validation failed with ${errors.length} error(s):`);
    for (const error of errors.slice(0, 50)) console.error(error);
    if (errors.length > 50) console.error(`...and ${errors.length - 50} more`);
    process.exit(1);
  }

  const { data: existing, error: existingError } = await client
    .from("company_open_facts")
    .select("id, company_slug, source_url");

  if (existingError) {
    console.error("Could not load existing company_open_facts:", existingError.message);
    process.exit(1);
  }

  const existingByKey = new Map<string, string>();
  for (const row of (existing ?? []) as unknown as ExistingOpenFactRow[]) {
    existingByKey.set(openFactKey(row), row.id);
  }

  let inserted = 0;
  let updated = 0;
  let skippedEmpty = 0;

  for (const row of validRows) {
    const hasAnyValue = [
      row.source_url,
      row.vacancy_title,
      row.city,
      row.salary_text,
      row.employment_type,
      row.schedule,
      row.company_description,
      row.vacancy_description,
      row.raw_excerpt,
      row.status === "verified" || row.status === "rejected",
      row.is_public === true,
    ].some(Boolean);

    if (!hasAnyValue) {
      skippedEmpty++;
      continue;
    }

    const key = openFactKey(row as unknown as ExistingOpenFactRow);
    const id = existingByKey.get(key);
    if (id) {
      const { error } = await client.from("company_open_facts").update(row).eq("id", id);
      if (error) {
        console.error(`Update failed for ${key}: ${error.message}`);
        process.exit(1);
      }
      updated++;
    } else {
      const { error } = await client.from("company_open_facts").insert(row);
      if (error) {
        console.error(`Insert failed for ${key}: ${error.message}`);
        process.exit(1);
      }
      inserted++;
    }
  }

  console.log(`Rows in CSV: ${rows.length}`);
  console.log(`Valid rows: ${validRows.length}`);
  console.log(`Inserted: ${inserted}`);
  console.log(`Updated: ${updated}`);
  console.log(`Skipped empty template rows: ${skippedEmpty}`);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
