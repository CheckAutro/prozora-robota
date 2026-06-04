// scripts/export-company-open-facts-template.ts
//
// Exports a manual-fill CSV template for company_open_facts.
// No facts are invented: rows are empty placeholders for verification.
//
// Usage:
//   npx tsx scripts/export-company-open-facts-template.ts

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createClient } from "@supabase/supabase-js";

const OUTPUT_PATH = "data/company-open-facts-template.csv";

interface CompanyRow {
  slug: string;
  name: string;
  industry: string | null;
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

function csvEscape(value: string | number | boolean | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
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

  const { data, error } = await client
    .from("companies")
    .select("slug, name, industry")
    .order("name");

  if (error || !data) {
    console.error("Failed to load companies:", error?.message ?? "No data");
    process.exit(1);
  }

  const columns = [
    "company_slug",
    "company_name",
    "industry",
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
  ];

  const lines = [columns.join(",")];
  for (const company of data as CompanyRow[]) {
    for (const source of ["Work.ua", "Robota.ua"]) {
      lines.push([
        company.slug,
        company.name,
        company.industry ?? "",
        source,
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "false",
        "false",
        "false",
        "false",
        "",
        "",
        "needs_verification",
        "false",
      ].map(csvEscape).join(","));
    }
  }

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, `${lines.join("\n")}\n`, "utf8");

  console.log(`Companies: ${(data as CompanyRow[]).length}`);
  console.log(`Template rows: ${(data as CompanyRow[]).length * 2}`);
  console.log(`Output: ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
