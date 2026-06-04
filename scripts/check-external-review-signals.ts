// scripts/check-external-review-signals.ts
//
// Validates external_review_signals integrity.
//
// Usage:
//   npx tsx scripts/check-external-review-signals.ts

import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import {
  EXTERNAL_REVIEW_SIGNAL_SENTIMENTS,
  EXTERNAL_REVIEW_SIGNAL_STATUSES,
  EXTERNAL_REVIEW_SIGNAL_TOPICS,
} from "../lib/external-review-signals-service";

interface SignalRow {
  id: string;
  company_slug: string | null;
  source_name: string | null;
  source_url: string | null;
  topic: string | null;
  sentiment: string | null;
  summary: string | null;
  status: string | null;
  is_public: boolean | null;
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

function isMissingTableError(message: string): boolean {
  return /external_review_signals|does not exist|schema cache/i.test(message);
}

function looksLikeCopiedReview(summary: string): boolean {
  return /\r|\n/.test(summary) || summary.length > 300;
}

async function main() {
  loadEnvLocal();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    "";

  if (!supabaseUrl || !key) {
    console.error("Missing Supabase env vars.");
    process.exit(1);
  }

  const client = createClient(supabaseUrl, key, {
    auth: { persistSession: false },
  });

  const [{ data: signals, error: signalsError }, { data: companies, error: companiesError }] =
    await Promise.all([
      client
        .from("external_review_signals")
        .select("id, company_slug, source_name, source_url, topic, sentiment, summary, status, is_public"),
      client.from("companies").select("slug"),
    ]);

  if (signalsError) {
    if (isMissingTableError(signalsError.message)) {
      console.log("External review signals table not found.");
      console.log("Apply supabase/migrations/20240105_external_review_signals.sql, then rerun this check.");
      return;
    }
    console.error("Failed to load external_review_signals:", signalsError.message);
    process.exit(1);
  }
  if (companiesError || !companies) {
    console.error("Failed to load companies:", companiesError?.message ?? "No companies");
    process.exit(1);
  }

  const companySlugs = new Set((companies as { slug: string }[]).map((row) => row.slug));
  const rows = (signals ?? []) as unknown as SignalRow[];
  const problems: string[] = [];
  const seenKeys = new Map<string, string>();

  for (const row of rows) {
    const slug = row.company_slug ?? "";
    const sourceName = row.source_name ?? "";
    const summary = row.summary?.trim() ?? "";
    const topic = row.topic ?? "";
    const sentiment = row.sentiment ?? "";
    const status = row.status ?? "";
    const duplicateKey = [slug, sourceName.trim().toLowerCase(), topic, summary.toLowerCase()].join("||");
    const duplicateId = seenKeys.get(duplicateKey);

    if (!slug) problems.push(`${row.id}: missing company_slug`);
    if (slug && !companySlugs.has(slug)) problems.push(`${row.id}: orphan company_slug ${slug}`);
    if (!sourceName.trim()) problems.push(`${row.id}: source_name is required`);
    if (!EXTERNAL_REVIEW_SIGNAL_TOPICS.includes(topic as never)) problems.push(`${row.id}: invalid topic ${topic}`);
    if (!EXTERNAL_REVIEW_SIGNAL_SENTIMENTS.includes(sentiment as never)) problems.push(`${row.id}: invalid sentiment ${sentiment}`);
    if (!EXTERNAL_REVIEW_SIGNAL_STATUSES.includes(status as never)) problems.push(`${row.id}: invalid status ${status}`);
    if (row.is_public && status !== "verified") problems.push(`${row.id}: public row with status ${status}`);
    if (row.is_public && !row.source_url?.trim()) problems.push(`${row.id}: public row without source_url`);
    if (summary.length < 20 || summary.length > 300) problems.push(`${row.id}: summary length must be 20-300 chars`);
    if (looksLikeCopiedReview(summary)) problems.push(`${row.id}: summary looks like copied long review text`);
    if (duplicateId) problems.push(`${row.id}: duplicate exact signal of ${duplicateId}`);
    else seenKeys.set(duplicateKey, row.id);
  }

  console.log(`External review signals: ${rows.length}`);
  console.log(`Problems: ${problems.length}`);
  for (const problem of problems.slice(0, 50)) console.error(problem);
  if (problems.length > 50) console.error(`...and ${problems.length - 50} more`);

  if (problems.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
