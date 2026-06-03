// scripts/import-companies-500.ts
//
// Imports the 500+ company seed into public.companies.
// This script only touches public.companies and never writes reviews,
// ratings, external signals, or external ratings.
//
// Usage:
//   npx tsx scripts/import-companies-500.ts

import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import {
  COMPANIES_UA_500,
  REQUIRED_COMPANY_SLUGS,
  type CompanySeedRow,
} from "../data/companies-ua-500";

const CYRILLIC_RE = /[\u0400-\u04ff]/;
const CHUNK_SIZE = 100;
const LEGACY_SLUG_REMAPS = [
  { from: "pryvatbank", to: "privatbank", name: "ПриватБанк" },
  {
    from: "arselormittal-kryvyi-rih",
    to: "arcelormittal-kryvyi-rih",
    name: "АрселорМіттал Кривий Ріг",
  },
] as const;

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

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function findDuplicateSlugs(rows: CompanySeedRow[]): string[] {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.slug, (counts.get(row.slug) ?? 0) + 1);
  return [...counts.entries()].filter(([, count]) => count > 1).map(([slug]) => slug);
}

function validateSeed(rows: CompanySeedRow[]) {
  const duplicateSlugs = findDuplicateSlugs(rows);
  const cyrillicSlugs = rows.filter((row) => CYRILLIC_RE.test(row.slug)).map((row) => row.slug);
  const emptyNames = rows.filter((row) => !row.name.trim()).map((row) => row.slug);
  const emptyCategories = rows.filter((row) => !row.industry.trim()).map((row) => row.slug);
  const missingRequired = REQUIRED_COMPANY_SLUGS.filter(
    (slug) => !rows.some((row) => row.slug === slug)
  );

  return {
    valid:
      rows.length >= 500 &&
      duplicateSlugs.length === 0 &&
      cyrillicSlugs.length === 0 &&
      emptyNames.length === 0 &&
      emptyCategories.length === 0 &&
      missingRequired.length === 0,
    duplicateSlugs,
    cyrillicSlugs,
    emptyNames,
    emptyCategories,
    missingRequired,
  };
}

function failList(label: string, values: string[]) {
  if (values.length === 0) return;
  console.error(`${label}: ${values.join(", ")}`);
}

async function main() {
  loadEnvLocal();

  console.log("── Прозора робота: company import 500 ─────────────────");
  console.log(`Total in seed: ${COMPANIES_UA_500.length}`);

  const validation = validateSeed(COMPANIES_UA_500);
  console.log(`Valid seed: ${validation.valid ? "yes" : "no"}`);
  console.log(`Duplicate slugs in seed: ${validation.duplicateSlugs.length}`);
  console.log(`Cyrillic slugs in seed: ${validation.cyrillicSlugs.length}`);

  if (!validation.valid) {
    failList("Duplicate slugs", validation.duplicateSlugs);
    failList("Cyrillic slugs", validation.cyrillicSlugs);
    failList("Empty names", validation.emptyNames);
    failList("Empty categories", validation.emptyCategories);
    failList("Missing required slugs", validation.missingRequired);
    if (COMPANIES_UA_500.length < 500) {
      console.error(`Seed must contain at least 500 companies; got ${COMPANIES_UA_500.length}.`);
    }
    process.exit(1);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!supabaseUrl || !serviceKey) {
    console.error(
      "Missing env vars. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
    );
    process.exit(1);
  }

  const client = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  const { data: existing, error: fetchError } = await client
    .from("companies")
    .select("slug, name");

  if (fetchError) {
    console.error("Failed to fetch existing companies:", fetchError.message);
    process.exit(1);
  }

  const existingRows = (existing ?? []) as { slug: string; name: string | null }[];
  const existingSlugs = new Set(existingRows.map((row) => row.slug));

  for (const remap of LEGACY_SLUG_REMAPS) {
    if (!existingSlugs.has(remap.from) || existingSlugs.has(remap.to)) continue;

    const { error: remapError } = await client
      .from("companies")
      .update({ slug: remap.to })
      .eq("slug", remap.from);

    if (remapError) {
      console.warn(
        `Could not remap ${remap.name} ${remap.from} → ${remap.to}: ${remapError.message}`
      );
      continue;
    }

    existingSlugs.delete(remap.from);
    existingSlugs.add(remap.to);
    const existingRow = existingRows.find((row) => row.slug === remap.from);
    if (existingRow) existingRow.slug = remap.to;
    console.log(`Remapped legacy slug: ${remap.from} → ${remap.to}`);
  }

  const existingNameToSlug = new Map<string, string>();
  for (const row of existingRows) {
    if (row.name) existingNameToSlug.set(normalizeName(row.name), row.slug);
  }

  const nameCollisions: { name: string; existingSlug: string; seedSlug: string }[] = [];
  const rowsToUpsert = COMPANIES_UA_500.filter((row) => {
    const existingSlug = existingNameToSlug.get(normalizeName(row.name));
    if (existingSlug && existingSlug !== row.slug && !existingSlugs.has(row.slug)) {
      nameCollisions.push({ name: row.name, existingSlug, seedSlug: row.slug });
      return false;
    }
    return true;
  });

  console.log(`Existing companies in DB: ${existingSlugs.size}`);
  console.log(`Valid rows: ${COMPANIES_UA_500.length}`);
  console.log(`Skipped name collisions: ${nameCollisions.length}`);
  console.log(`Rows to upsert: ${rowsToUpsert.length}`);

  if (nameCollisions.length > 0) {
    for (const item of nameCollisions.slice(0, 20)) {
      console.warn(
        `Name collision skipped: ${item.name} (${item.seedSlug}) already exists as ${item.existingSlug}`
      );
    }
    if (nameCollisions.length > 20) {
      console.warn(`...and ${nameCollisions.length - 20} more collisions.`);
    }
  }

  let inserted = 0;
  let updated = 0;
  let errors = 0;

  for (let i = 0; i < rowsToUpsert.length; i += CHUNK_SIZE) {
    const chunk = rowsToUpsert.slice(i, i + CHUNK_SIZE).map((row) => ({
      slug: row.slug,
      name: row.name,
      city: row.city,
      industry: row.industry,
      verified: row.verified,
    }));

    const { error } = await client
      .from("companies")
      .upsert(chunk, { onConflict: "slug" });

    if (error) {
      errors += chunk.length;
      console.error(`Chunk ${Math.floor(i / CHUNK_SIZE) + 1} error:`, error.message);
      continue;
    }

    for (const row of chunk) {
      if (existingSlugs.has(row.slug)) updated++;
      else inserted++;
    }
    console.log(
      `Chunk ${Math.floor(i / CHUNK_SIZE) + 1}/${Math.ceil(rowsToUpsert.length / CHUNK_SIZE)} upserted (${chunk.length} rows)`
    );
  }

  const { count: totalAfter, error: countError } = await client
    .from("companies")
    .select("*", { count: "exact", head: true });

  if (countError) {
    console.warn("Could not fetch final count:", countError.message);
  }

  const { data: finalRows } = await client.from("companies").select("slug");
  const finalSlugs = (finalRows ?? []).map((row: { slug: string }) => row.slug);
  const duplicateCount = finalSlugs.length - new Set(finalSlugs).size;

  console.log("───────────────────────────────────────────────────────");
  console.log(`Inserted: ${inserted}`);
  console.log(`Updated: ${updated}`);
  console.log(`Skipped name collisions: ${nameCollisions.length}`);
  console.log(`Errors: ${errors}`);
  console.log(`Total in DB after import: ${totalAfter ?? "unknown"}`);
  console.log(`Duplicate slugs in DB: ${duplicateCount}`);

  if (errors > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
