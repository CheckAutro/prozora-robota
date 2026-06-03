// scripts/import-external-ratings.ts
//
// Imports manually verified external ratings from data/external-ratings-import.csv.
// This script only writes public.external_ratings. It never touches reviews,
// companies, external_signals, or internal metrics.
//
// Usage:
//   npx tsx scripts/import-external-ratings.ts

import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import type { ExternalRatingStatus } from "../lib/types";

const INPUT_PATH = "data/external-ratings-import.csv";
const VALID_STATUSES = new Set<ExternalRatingStatus>([
  "needs_verification",
  "verified",
  "rejected",
]);

interface CsvRatingRow {
  company_slug: string;
  company_name: string;
  industry: string;
  source_name: string;
  source_url: string;
  rating_value: string;
  rating_scale: string;
  reviews_count: string;
  fetched_at: string;
  status: string;
  is_public: string;
  note: string;
}

interface ExistingRatingRow {
  id: string;
  company_slug: string;
  source_name: string;
  source_url: string | null;
}

interface UpsertRatingRow {
  company_slug: string;
  company_name: string;
  source_name: string;
  source_url: string | null;
  rating_value: number | null;
  rating_scale: number;
  reviews_count: number;
  fetched_at: string | null;
  status: ExternalRatingStatus;
  is_public: boolean;
  note: string | null;
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

    if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
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

function readCsv(path: string): CsvRatingRow[] {
  const rows = parseCsv(readFileSync(path, "utf8"));
  const [header, ...body] = rows;
  const columns = header.map((c) => c.trim());
  return body.map((row) => {
    const item: Record<string, string> = {};
    columns.forEach((column, index) => {
      item[column] = row[index]?.trim() ?? "";
    });
    return item as unknown as CsvRatingRow;
  });
}

function parseNumber(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseBoolean(value: string): boolean {
  return ["true", "1", "yes", "так"].includes(value.trim().toLowerCase());
}

function parseDate(value: string): string | null {
  if (!value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function ratingKey(row: Pick<ExistingRatingRow, "company_slug" | "source_name" | "source_url">) {
  return [
    row.company_slug.trim(),
    row.source_name.trim().toLowerCase(),
    row.source_url?.trim() ?? "",
  ].join("||");
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
  const validRows: UpsertRatingRow[] = [];
  const errors: string[] = [];

  rows.forEach((row, index) => {
    const line = index + 2;
    const rowErrors: string[] = [];
    const companySlug = row.company_slug.trim();
    const sourceName = row.source_name.trim();
    const sourceUrl = row.source_url.trim();
    const ratingScale = parseNumber(row.rating_scale) ?? 5;
    const ratingValue = parseNumber(row.rating_value);
    const reviewsCount = parseNumber(row.reviews_count);
    const status = (row.status.trim() || "needs_verification") as ExternalRatingStatus;
    const isPublic = parseBoolean(row.is_public);

    if (!companySlug || !companySlugs.has(companySlug)) rowErrors.push(`Line ${line}: invalid company_slug`);
    if (!sourceName) rowErrors.push(`Line ${line}: source_name is required`);
    if (!VALID_STATUSES.has(status)) rowErrors.push(`Line ${line}: invalid status`);
    if (ratingScale <= 0) rowErrors.push(`Line ${line}: rating_scale must be > 0`);
    if (ratingValue !== null && (ratingValue < 0 || ratingValue > ratingScale)) {
      rowErrors.push(`Line ${line}: rating_value must be between 0 and rating_scale`);
    }
    if (reviewsCount !== null && reviewsCount < 0) {
      rowErrors.push(`Line ${line}: reviews_count must be >= 0`);
    }
    if (isPublic && status !== "verified") {
      rowErrors.push(`Line ${line}: is_public=true requires status=verified`);
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
      return;
    }

    validRows.push({
      company_slug: companySlug,
      company_name: row.company_name.trim(),
      source_name: sourceName,
      source_url: sourceUrl || null,
      rating_value: ratingValue,
      rating_scale: ratingScale,
      reviews_count: Math.max(0, Math.trunc(reviewsCount ?? 0)),
      fetched_at: parseDate(row.fetched_at),
      status,
      is_public: isPublic,
      note: row.note.trim() || null,
    });
  });

  if (errors.length > 0) {
    console.error(`Validation failed with ${errors.length} error(s):`);
    for (const error of errors.slice(0, 50)) console.error(error);
    if (errors.length > 50) console.error(`...and ${errors.length - 50} more`);
    process.exit(1);
  }

  const { data: existing, error: existingError } = await client
    .from("external_ratings")
    .select("id, company_slug, source_name, source_url");

  if (existingError) {
    console.error("Could not load existing ratings:", existingError.message);
    process.exit(1);
  }

  const existingByKey = new Map<string, string>();
  for (const row of (existing ?? []) as ExistingRatingRow[]) {
    existingByKey.set(ratingKey(row), row.id);
  }

  let inserted = 0;
  let updated = 0;
  let skippedEmpty = 0;

  for (const row of validRows) {
    const hasAnyValue =
      row.rating_value !== null ||
      row.reviews_count !== 0 ||
      row.source_url !== null ||
      row.note !== null ||
      row.status === "verified" ||
      row.status === "rejected" ||
      row.is_public === true;

    if (!hasAnyValue) {
      skippedEmpty++;
      continue;
    }

    const key = ratingKey(row);
    const id = existingByKey.get(key);
    if (id) {
      const { error } = await client.from("external_ratings").update(row).eq("id", id);
      if (error) {
        console.error(`Update failed for ${key}: ${error.message}`);
        process.exit(1);
      }
      updated++;
    } else {
      const { error } = await client.from("external_ratings").insert(row);
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
