// scripts/export-external-review-signals-template.ts
//
// Exports a manual-fill CSV template for external review signals.
// It creates empty summary rows only: no copied reviews, no invented signals,
// and nothing is public until admin verification.
//
// Usage:
//   npx tsx scripts/export-external-review-signals-template.ts

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createClient } from "@supabase/supabase-js";

const OUTPUT_PATH = "data/external-review-signals-template.csv";

interface CompanyRow {
  slug: string;
  name: string;
  industry: string | null;
}

const BASE_SOURCES = ["Google", "Work.ua", "Robota.ua"] as const;
const IT_SOURCES = ["DOU", "Djinni"] as const;
const EXTRA_SOURCES = ["Indeed", "Glassdoor"] as const;

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

function sourcesForCompany(company: CompanyRow): string[] {
  const sources: string[] = [...BASE_SOURCES];
  if (company.industry === "IT") sources.push(...IT_SOURCES);
  if (company.industry && ["IT", "Telecom", "Банки і фінанси", "FMCG"].includes(company.industry)) {
    sources.push(...EXTRA_SOURCES);
  }
  return [...new Set(sources)];
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
    "source_name",
    "source_url",
    "topic",
    "sentiment",
    "summary",
    "mentions_count",
    "sample_size",
    "confidence",
    "collected_at",
    "status",
    "is_public",
    "admin_note",
  ];

  const lines = [columns.join(",")];
  let rowCount = 0;

  for (const company of data as CompanyRow[]) {
    for (const source of sourcesForCompany(company)) {
      lines.push([
        company.slug,
        company.name,
        source,
        "",
        "other",
        "neutral",
        "",
        "1",
        "",
        "medium",
        "",
        "needs_verification",
        "false",
        "",
      ].map(csvEscape).join(","));
      rowCount++;
    }
  }

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, `${lines.join("\n")}\n`, "utf8");

  console.log(`Companies: ${(data as CompanyRow[]).length}`);
  console.log(`Template rows: ${rowCount}`);
  console.log(`Output: ${OUTPUT_PATH}`);
  console.log("Fill summary with short paraphrased meaning only. Do not paste external reviews.");
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
