// scripts/check-companies.ts
//
// Validates the local 500+ company seed and, when Supabase env vars are
// available, validates public.companies after import.
//
// Usage:
//   npx tsx scripts/check-companies.ts

import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import {
  COMPANIES_UA_500,
  REQUIRED_COMPANY_SLUGS,
  type CompanySeedRow,
} from "../data/companies-ua-500";

const CYRILLIC_RE = /[\u0400-\u04ff]/;

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

function duplicateSlugs(rows: { slug: string }[]): string[] {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.slug, (counts.get(row.slug) ?? 0) + 1);
  return [...counts.entries()].filter(([, count]) => count > 1).map(([slug]) => slug);
}

function validateRows(rows: CompanySeedRow[]) {
  const duplicates = duplicateSlugs(rows);
  const cyrillic = rows.filter((row) => CYRILLIC_RE.test(row.slug)).map((row) => row.slug);
  const emptyNames = rows.filter((row) => !row.name.trim()).map((row) => row.slug);
  const emptyCategories = rows.filter((row) => !row.industry.trim()).map((row) => row.slug);
  const missingRequired = REQUIRED_COMPANY_SLUGS.filter(
    (slug) => !rows.some((row) => row.slug === slug)
  );

  return {
    ok:
      rows.length >= 500 &&
      duplicates.length === 0 &&
      cyrillic.length === 0 &&
      emptyNames.length === 0 &&
      emptyCategories.length === 0 &&
      missingRequired.length === 0,
    duplicates,
    cyrillic,
    emptyNames,
    emptyCategories,
    missingRequired,
  };
}

function printList(label: string, values: string[]) {
  console.log(`${label}: ${values.length === 0 ? "none" : values.join(", ")}`);
}

async function validateDatabase() {
  loadEnvLocal();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    "";

  if (!supabaseUrl || !key) {
    console.log("Supabase env not found; DB checks skipped.");
    return true;
  }

  const client = createClient(supabaseUrl, key, {
    auth: { persistSession: false },
  });

  const { data, error } = await client
    .from("companies")
    .select("slug, name, industry");

  if (error || !data) {
    console.error("DB check failed:", error?.message ?? "No data returned");
    return false;
  }

  const rows = data as { slug: string; name: string | null; industry: string | null }[];
  const duplicates = duplicateSlugs(rows);
  const cyrillic = rows.filter((row) => CYRILLIC_RE.test(row.slug)).map((row) => row.slug);
  const emptyNames = rows.filter((row) => !(row.name ?? "").trim()).map((row) => row.slug);
  const emptyCategories = rows
    .filter((row) => !(row.industry ?? "").trim())
    .map((row) => row.slug);
  const missingRequired = REQUIRED_COMPANY_SLUGS.filter(
    (slug) => !rows.some((row) => row.slug === slug)
  );

  console.log("── DB companies check ─────────────────────────────────");
  console.log(`Total companies in DB: ${rows.length}`);
  printList("Duplicate DB slugs", duplicates);
  printList("Cyrillic DB slugs", cyrillic);
  printList("Empty DB names", emptyNames);
  printList("Empty DB categories", emptyCategories);
  printList("Missing required DB slugs", missingRequired);

  return (
    rows.length >= 500 &&
    duplicates.length === 0 &&
    cyrillic.length === 0 &&
    emptyNames.length === 0 &&
    emptyCategories.length === 0 &&
    missingRequired.length === 0
  );
}

async function main() {
  const seedCheck = validateRows(COMPANIES_UA_500);

  console.log("── Local seed check ───────────────────────────────────");
  console.log(`Total companies in seed: ${COMPANIES_UA_500.length}`);
  console.log(`Unique seed slugs: ${new Set(COMPANIES_UA_500.map((row) => row.slug)).size}`);
  printList("Duplicate seed slugs", seedCheck.duplicates);
  printList("Cyrillic seed slugs", seedCheck.cyrillic);
  printList("Empty seed names", seedCheck.emptyNames);
  printList("Empty seed categories", seedCheck.emptyCategories);
  printList("Missing required seed slugs", seedCheck.missingRequired);

  if (!seedCheck.ok) {
    process.exit(1);
  }

  const dbOk = await validateDatabase();
  if (!dbOk) process.exit(1);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
