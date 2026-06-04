// scripts/check-company-discovery.ts
// Validates company_discovery_queue integrity.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

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

function getClient() {
  loadEnvLocal();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!supabaseUrl || !key) throw new Error("Missing Supabase env vars");
  return createClient(supabaseUrl, key, { auth: { persistSession: false } });
}

function csvEscape(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function parseCsv(content: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];
    const next = content[i + 1];
    if (quoted) {
      if (char === '"' && next === '"') { cell += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(cell); cell = ""; }
    else if (char === '\n') { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (char !== '\r') cell += char;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [headers = [], ...dataRows] = rows;
  return dataRows.filter((cells) => cells.some((value) => value.trim())).map((cells) => {
    const obj: Record<string, string> = {};
    headers.forEach((header, index) => { obj[header] = cells[index] ?? ""; });
    return obj;
  });
}

function hasCyrillic(value: string): boolean { return /[А-Яа-яІіЇїЄєҐґ]/.test(value); }

async function main() {
  const client = getClient();
  const [{ data: queue, error: queueError }, { data: companies, error: companiesError }] = await Promise.all([
    client.from("company_discovery_queue").select("id, discovered_name, suggested_slug, source_name, source_url, matched_existing_slug, match_confidence, status, is_imported, imported_company_slug"),
    client.from("companies").select("slug"),
  ]);

  if (queueError) {
    if (/company_discovery_queue|does not exist|schema cache/i.test(queueError.message)) {
      console.log("Company discovery queue table not found.");
      console.log("Apply supabase/migrations/20240106_company_discovery_queue.sql, then rerun this check.");
      return;
    }
    throw new Error(queueError.message);
  }
  if (companiesError || !companies) throw new Error(companiesError?.message ?? "No companies loaded");

  const rows = (queue ?? []) as Array<Record<string, unknown>>;
  const companySlugs = new Set((companies as Array<{ slug: string }>).map((row) => row.slug));
  const problems: string[] = [];
  const seenSuggested = new Map<string, string>();

  for (const row of rows) {
    const id = String(row.id);
    const discoveredName = String(row.discovered_name ?? "").trim();
    const suggestedSlug = String(row.suggested_slug ?? "").trim();
    const sourceName = String(row.source_name ?? "").trim();
    const status = String(row.status ?? "");
    const matchedExistingSlug = String(row.matched_existing_slug ?? "").trim();
    const importedCompanySlug = String(row.imported_company_slug ?? "").trim();
    const existing = seenSuggested.get(suggestedSlug);
    if (!discoveredName) problems.push(id + ": discovered_name is required");
    if (!suggestedSlug) problems.push(id + ": suggested_slug is required");
    if (suggestedSlug && hasCyrillic(suggestedSlug)) problems.push(id + ": suggested_slug contains Cyrillic");
    if (!sourceName) problems.push(id + ": source_name is required");
    if (existing) problems.push(id + ": duplicate suggested_slug, first id " + existing);
    else if (suggestedSlug) seenSuggested.set(suggestedSlug, id);
    if (suggestedSlug && companySlugs.has(suggestedSlug) && !matchedExistingSlug && status !== "auto_imported") {
      problems.push(id + ": suggested_slug conflicts with companies without matched_existing_slug");
    }
    if (status === "auto_imported" && !importedCompanySlug) problems.push(id + ": auto_imported without imported_company_slug");
    if (importedCompanySlug && !companySlugs.has(importedCompanySlug)) problems.push(id + ": imported_company_slug not found in companies");
    if (matchedExistingSlug && !companySlugs.has(matchedExistingSlug)) problems.push(id + ": matched_existing_slug not found in companies");
  }

  console.log("Company discovery queue:", rows.length);
  console.log("Problems:", problems.length);
  for (const problem of problems.slice(0, 50)) console.error(problem);
  if (problems.length > 50) console.error("...and " + (problems.length - 50) + " more");
  if (problems.length) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
