// scripts/check-external-ratings.ts
//
// Validates external_ratings integrity.
//
// Usage:
//   npx tsx scripts/check-external-ratings.ts

import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

interface RatingRow {
  id: string;
  company_slug: string | null;
  source_name: string | null;
  rating_value: number | string | null;
  rating_scale: number | string | null;
  reviews_count: number | string | null;
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

function toNumber(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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

  const [{ data: ratings, error: ratingsError }, { data: companies, error: companiesError }] =
    await Promise.all([
      client
        .from("external_ratings")
        .select("id, company_slug, source_name, rating_value, rating_scale, reviews_count, status, is_public"),
      client.from("companies").select("slug"),
    ]);

  if (ratingsError) {
    console.error("Failed to load external_ratings:", ratingsError.message);
    process.exit(1);
  }
  if (companiesError || !companies) {
    console.error("Failed to load companies:", companiesError?.message ?? "No companies");
    process.exit(1);
  }

  const companySlugs = new Set((companies as { slug: string }[]).map((row) => row.slug));
  const rows = (ratings ?? []) as RatingRow[];
  const problems: string[] = [];

  for (const row of rows) {
    const slug = row.company_slug ?? "";
    const sourceName = row.source_name ?? "";
    const ratingValue = toNumber(row.rating_value);
    const ratingScale = toNumber(row.rating_scale) ?? 5;
    const reviewsCount = toNumber(row.reviews_count) ?? 0;

    if (!slug) problems.push(`${row.id}: missing company_slug`);
    if (slug && !companySlugs.has(slug)) problems.push(`${row.id}: orphan company_slug ${slug}`);
    if (row.is_public && row.status !== "verified") {
      problems.push(`${row.id}: public rating with status ${row.status}`);
    }
    if (row.is_public && !sourceName.trim()) {
      problems.push(`${row.id}: public rating without source_name`);
    }
    if (ratingValue !== null && ratingValue > ratingScale) {
      problems.push(`${row.id}: rating_value > rating_scale`);
    }
    if (ratingValue !== null && ratingValue < 0) {
      problems.push(`${row.id}: rating_value < 0`);
    }
    if (reviewsCount < 0) {
      problems.push(`${row.id}: reviews_count < 0`);
    }
  }

  console.log(`External ratings: ${rows.length}`);
  console.log(`Problems: ${problems.length}`);
  for (const problem of problems.slice(0, 50)) console.error(problem);
  if (problems.length > 50) console.error(`...and ${problems.length - 50} more`);

  if (problems.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
