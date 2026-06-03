#!/usr/bin/env npx ts-node --esm
// scripts/import-companies-batch-2.ts
//
// Imports COMPANY_IMPORT_BATCH_2 into public.companies with full deduplication:
//   1. Reads existing slugs from Supabase.
//   2. Filters out rows whose slug already exists.
//   3. Inserts only new rows (no upsert — avoids accidental overwrites).
//
// Usage:
//   NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
//   SUPABASE_SERVICE_ROLE_KEY=... \
//   npx ts-node --esm scripts/import-companies-batch-2.ts
//
// Requires SUPABASE_SERVICE_ROLE_KEY to bypass RLS on insert.

import { createClient } from "@supabase/supabase-js";
import { COMPANY_IMPORT_BATCH_2 } from "../data/company-import-batch-2.js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    "Missing env vars. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
  );
  process.exit(1);
}

const client = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

async function main() {
  console.log("── Чесна Робота: Company import batch-2 ──────────────────");

  // 1. Read existing slugs from Supabase.
  const { data: existing, error: fetchErr } = await client
    .from("companies")
    .select("slug");

  if (fetchErr) {
    console.error("Failed to fetch existing companies:", fetchErr.message);
    process.exit(1);
  }

  const existingSlugs = new Set((existing ?? []).map((r: { slug: string }) => r.slug));
  console.log(`Existing companies in DB: ${existingSlugs.size}`);

  // 2. Deduplicate.
  const toInsert = COMPANY_IMPORT_BATCH_2.filter((c) => !existingSlugs.has(c.slug));
  const skipped  = COMPANY_IMPORT_BATCH_2.length - toInsert.length;

  console.log(`Batch-2 total:   ${COMPANY_IMPORT_BATCH_2.length}`);
  console.log(`Skipped (exist): ${skipped}`);
  console.log(`To insert:       ${toInsert.length}`);

  if (toInsert.length === 0) {
    console.log("Nothing to import. All companies already exist.");
    return;
  }

  // 3. Insert in chunks of 50 to stay within Supabase limits.
  const CHUNK = 50;
  let inserted = 0;
  let errors   = 0;

  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const chunk = toInsert.slice(i, i + CHUNK);
    const { error: insertErr } = await client.from("companies").insert(chunk);

    if (insertErr) {
      console.error(`  Chunk ${Math.floor(i / CHUNK) + 1} error:`, insertErr.message);
      errors += chunk.length;
    } else {
      inserted += chunk.length;
      console.log(`  Chunk ${Math.floor(i / CHUNK) + 1}/${Math.ceil(toInsert.length / CHUNK)} inserted (${chunk.length} rows)`);
    }
  }

  // 4. Summary.
  const { data: finalCount } = await client
    .from("companies")
    .select("*", { count: "exact", head: true });

  console.log("──────────────────────────────────────────────────────────");
  console.log(`Inserted:  ${inserted}`);
  console.log(`Errors:    ${errors}`);
  console.log(`Skipped:   ${skipped}`);
  console.log(`Total in DB after import: ${(finalCount as unknown as { count: number })?.count ?? "?"}`);

  // 5. Quick duplicate check.
  const { data: dupCheck } = await client.rpc("check_company_slug_duplicates").maybeSingle();
  if (!dupCheck) {
    // RPC doesn't exist — manual check
    const { data: allSlugs } = await client.from("companies").select("slug");
    if (allSlugs) {
      const slugArr = allSlugs.map((r: { slug: string }) => r.slug);
      const unique  = new Set(slugArr);
      const dups    = slugArr.length - unique.size;
      console.log(`Duplicate slugs: ${dups === 0 ? "none ✓" : dups + " ✗"}`);
    }
  }
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
