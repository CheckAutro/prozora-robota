// scripts/import-external-review-signals.ts
//
// Imports admin-prepared external review signal summaries from
// data/external-review-signals-import.csv.
// This script only writes public.external_review_signals. It never touches
// public.reviews, external_ratings, company_open_facts, or internal metrics.
//
// Usage:
//   npx tsx scripts/import-external-review-signals.ts

import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import {
  EXTERNAL_REVIEW_SIGNAL_CONFIDENCES,
  EXTERNAL_REVIEW_SIGNAL_SENTIMENTS,
  EXTERNAL_REVIEW_SIGNAL_STATUSES,
  EXTERNAL_REVIEW_SIGNAL_TOPICS,
} from "../lib/external-review-signals-service";
import type {
  ExternalReviewSignalConfidence,
  ExternalReviewSignalSentiment,
  ExternalReviewSignalStatus,
  ExternalReviewSignalTopic,
} from "../lib/types";

const INPUT_PATH = "data/external-review-signals-import.csv";

interface CsvSignalRow {
  company_slug: string;
  company_name: string;
  source_name: string;
  source_url: string;
  topic: string;
  sentiment: string;
  summary: string;
  mentions_count: string;
  sample_size: string;
  confidence: string;
  collected_at: string;
  status: string;
  is_public: string;
  admin_note: string;
}

interface ExistingSignalRow {
  id: string;
  company_slug: string;
  source_name: string;
  topic: string;
  summary: string;
}

interface UpsertSignalRow {
  company_slug: string;
  company_name: string;
  source_name: string;
  source_url: string | null;
  topic: ExternalReviewSignalTopic;
  sentiment: ExternalReviewSignalSentiment;
  summary: string;
  mentions_count: number;
  sample_size: number | null;
  confidence: ExternalReviewSignalConfidence;
  collected_at: string | null;
  status: ExternalReviewSignalStatus;
  is_public: boolean;
  admin_note: string | null;
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

function readCsv(path: string): CsvSignalRow[] {
  const rows = parseCsv(readFileSync(path, "utf8"));
  const [header, ...body] = rows;
  const columns = header.map((c) => c.trim());
  return body.map((row) => {
    const item: Record<string, string> = {};
    columns.forEach((column, index) => {
      item[column] = row[index]?.trim() ?? "";
    });
    return item as unknown as CsvSignalRow;
  });
}

function parseInteger(value: string, fallback: number | null): number | null {
  if (!value.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.trunc(parsed));
}

function parseBoolean(value: string): boolean {
  return ["true", "1", "yes", "так"].includes(value.trim().toLowerCase());
}

function parseDate(value: string): string | null {
  if (!value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function signalKey(row: Pick<ExistingSignalRow, "company_slug" | "source_name" | "topic" | "summary">) {
  return [
    row.company_slug.trim(),
    row.source_name.trim().toLowerCase(),
    row.topic.trim(),
    row.summary.trim().toLowerCase(),
  ].join("||");
}

function looksLikeCopiedReview(summary: string): boolean {
  return /\r|\n/.test(summary) || summary.length > 300;
}

async function main() {
  loadEnvLocal();

  if (!existsSync(INPUT_PATH)) {
    console.error(`Missing ${INPUT_PATH}. Copy the template and fill summaries first.`);
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

  const companyBySlug = new Map((companies as { slug: string; name: string }[]).map((c) => [c.slug, c.name]));
  const validRows: UpsertSignalRow[] = [];
  const errors: string[] = [];
  let skippedEmpty = 0;

  rows.forEach((row, index) => {
    const line = index + 2;
    const rowErrors: string[] = [];
    const companySlug = row.company_slug.trim();
    const sourceName = row.source_name.trim();
    const sourceUrl = row.source_url.trim();
    const topic = (row.topic.trim() || "other") as ExternalReviewSignalTopic;
    const sentiment = (row.sentiment.trim() || "neutral") as ExternalReviewSignalSentiment;
    const confidence = (row.confidence.trim() || "medium") as ExternalReviewSignalConfidence;
    const status = (row.status.trim() || "needs_verification") as ExternalReviewSignalStatus;
    const summary = row.summary.trim();
    const isPublic = parseBoolean(row.is_public);

    if (!summary) {
      skippedEmpty++;
      return;
    }

    if (!companySlug || !companyBySlug.has(companySlug)) rowErrors.push(`Line ${line}: invalid company_slug`);
    if (!sourceName) rowErrors.push(`Line ${line}: source_name is required`);
    if (!EXTERNAL_REVIEW_SIGNAL_TOPICS.includes(topic)) rowErrors.push(`Line ${line}: invalid topic`);
    if (!EXTERNAL_REVIEW_SIGNAL_SENTIMENTS.includes(sentiment)) rowErrors.push(`Line ${line}: invalid sentiment`);
    if (!EXTERNAL_REVIEW_SIGNAL_CONFIDENCES.includes(confidence)) rowErrors.push(`Line ${line}: invalid confidence`);
    if (!EXTERNAL_REVIEW_SIGNAL_STATUSES.includes(status)) rowErrors.push(`Line ${line}: invalid status`);
    if (summary.length < 20 || summary.length > 300) rowErrors.push(`Line ${line}: summary must be 20-300 chars`);
    if (looksLikeCopiedReview(summary)) rowErrors.push(`Line ${line}: summary looks like copied long review text`);
    if (isPublic && status !== "verified") rowErrors.push(`Line ${line}: is_public=true requires status=verified`);
    if (isPublic && !sourceUrl) rowErrors.push(`Line ${line}: public signal requires source_url`);

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
      return;
    }

    validRows.push({
      company_slug: companySlug,
      company_name: row.company_name.trim() || companyBySlug.get(companySlug) || companySlug,
      source_name: sourceName,
      source_url: sourceUrl || null,
      topic,
      sentiment,
      summary,
      mentions_count: parseInteger(row.mentions_count, 1) ?? 1,
      sample_size: parseInteger(row.sample_size, null),
      confidence,
      collected_at: parseDate(row.collected_at),
      status,
      is_public: isPublic,
      admin_note: row.admin_note.trim() || null,
    });
  });

  if (errors.length > 0) {
    console.error(`Validation failed with ${errors.length} error(s):`);
    for (const error of errors.slice(0, 50)) console.error(error);
    if (errors.length > 50) console.error(`...and ${errors.length - 50} more`);
    process.exit(1);
  }

  const { data: existing, error: existingError } = await client
    .from("external_review_signals")
    .select("id, company_slug, source_name, topic, summary");

  if (existingError) {
    console.error("Could not load existing external_review_signals:", existingError.message);
    process.exit(1);
  }

  const existingByKey = new Map<string, string>();
  for (const row of (existing ?? []) as unknown as ExistingSignalRow[]) {
    existingByKey.set(signalKey(row), row.id);
  }

  let inserted = 0;
  let updated = 0;

  for (const row of validRows) {
    const key = signalKey(row);
    const id = existingByKey.get(key);
    if (id) {
      const { error } = await client.from("external_review_signals").update(row).eq("id", id);
      if (error) {
        console.error(`Update failed for ${key}: ${error.message}`);
        process.exit(1);
      }
      updated++;
    } else {
      const { error } = await client.from("external_review_signals").insert(row);
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
