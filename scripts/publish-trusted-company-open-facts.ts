// scripts/publish-trusted-company-open-facts.ts
//
// Publishes trusted Work.ua / Robota.ua company_open_facts that were created
// before auto-publish was enabled. This script only updates company_open_facts.
// It never touches public.reviews, external_ratings, or external_review_signals.
//
// Usage:
//   npx tsx scripts/publish-trusted-company-open-facts.ts

import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

interface OpenFactRow {
  id: string;
  company_slug: string | null;
  company_name: string | null;
  source_name: string | null;
  source_url: string | null;
  vacancy_title: string | null;
  city: string | null;
  salary_text: string | null;
  vacancy_description: string | null;
  schedule: string | null;
  employment_type: string | null;
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

function hasText(value: string | null): boolean {
  return Boolean(value?.trim());
}

async function main() {
  loadEnvLocal();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!supabaseUrl || !serviceKey) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }

  const client = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  const { data, error } = await client
    .from("company_open_facts")
    .select("id, company_slug, company_name, source_name, source_url, vacancy_title, city, salary_text, vacancy_description, schedule, employment_type")
    .eq("status", "needs_verification")
    .eq("is_public", false)
    .in("source_name", ["Work.ua", "Robota.ua"]);

  if (error) {
    console.error("Failed to load company_open_facts:", error.message);
    process.exit(1);
  }

  const rows = (data ?? []) as unknown as OpenFactRow[];
  const problems: string[] = [];
  const publishIds: string[] = [];
  let skipped = 0;

  for (const row of rows) {
    const reason: string[] = [];
    if (!hasText(row.company_slug)) reason.push("missing company_slug");
    if (!hasText(row.company_name)) reason.push("missing company_name");
    if (!hasText(row.source_url)) reason.push("missing source_url");
    if (!hasText(row.vacancy_title)) reason.push("missing vacancy_title");
    if (![row.city, row.salary_text, row.vacancy_description, row.schedule, row.employment_type].some(hasText)) {
      reason.push("missing useful vacancy facts");
    }

    if (reason.length > 0) {
      skipped++;
      problems.push(`${row.id}: ${reason.join(", ")}`);
      continue;
    }

    publishIds.push(row.id);
  }

  let published = 0;
  if (publishIds.length > 0) {
    const { error: updateError } = await client
      .from("company_open_facts")
      .update({
        status: "verified",
        is_public: true,
        updated_at: new Date().toISOString(),
      })
      .in("id", publishIds);

    if (updateError) {
      console.error("Failed to publish trusted company_open_facts:", updateError.message);
      process.exit(1);
    }
    published = publishIds.length;
  }

  console.log(`Found trusted pending rows: ${rows.length}`);
  console.log(`Published: ${published}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Problems: ${problems.length}`);
  for (const problem of problems.slice(0, 50)) console.error(problem);
  if (problems.length > 50) console.error(`...and ${problems.length - 50} more`);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
