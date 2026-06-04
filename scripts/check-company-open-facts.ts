// scripts/check-company-open-facts.ts
//
// Validates company_open_facts integrity.
//
// Usage:
//   npx tsx scripts/check-company-open-facts.ts

import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

interface OpenFactRow {
  id: string;
  company_slug: string | null;
  source_name: string | null;
  source_url: string | null;
  raw_excerpt: string | null;
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

function isMissingTable(message: string): boolean {
  return /company_open_facts|does not exist|schema cache/i.test(message);
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

  const [{ data: facts, error: factsError }, { data: companies, error: companiesError }] =
    await Promise.all([
      client
        .from("company_open_facts")
        .select("id, company_slug, source_name, source_url, raw_excerpt, status, is_public"),
      client.from("companies").select("slug"),
    ]);

  if (factsError) {
    if (isMissingTable(factsError.message)) {
      console.log("Company open facts table not found.");
      console.log("Apply supabase/migrations/20240104_company_open_facts.sql, then rerun this check.");
      return;
    }
    console.error("Failed to load company_open_facts:", factsError.message);
    process.exit(1);
  }
  if (companiesError || !companies) {
    console.error("Failed to load companies:", companiesError?.message ?? "No companies");
    process.exit(1);
  }

  const companySlugs = new Set((companies as { slug: string }[]).map((row) => row.slug));
  const rows = (facts ?? []) as OpenFactRow[];
  const problems: string[] = [];
  const seenSourceUrls = new Map<string, string>();

  for (const row of rows) {
    const slug = row.company_slug ?? "";
    const sourceName = row.source_name ?? "";
    const sourceUrl = row.source_url?.trim() ?? "";
    const rawExcerpt = row.raw_excerpt?.trim() ?? "";

    if (!slug) problems.push(`${row.id}: missing company_slug`);
    if (slug && !companySlugs.has(slug)) problems.push(`${row.id}: orphan company_slug ${slug}`);
    if (!sourceName.trim()) problems.push(`${row.id}: missing source_name`);
    if (row.is_public && row.status !== "verified") {
      problems.push(`${row.id}: public fact with status ${row.status}`);
    }
    if (row.is_public && (!sourceUrl || !rawExcerpt)) {
      problems.push(`${row.id}: public fact requires source_url and raw_excerpt`);
    }
    if (slug && sourceUrl) {
      const key = `${slug}||${sourceUrl}`;
      const existing = seenSourceUrls.get(key);
      if (existing) problems.push(`${row.id}: duplicate source_url for company_slug, first id ${existing}`);
      else seenSourceUrls.set(key, row.id);
    }
  }

  console.log(`Company open facts: ${rows.length}`);
  console.log(`Problems: ${problems.length}`);
  for (const problem of problems.slice(0, 50)) console.error(problem);
  if (problems.length > 50) console.error(`...and ${problems.length - 50} more`);

  if (problems.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
