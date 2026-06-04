// scripts/import-company-discovery.ts
// Imports data/company-discovery-import.csv into company_discovery_queue.

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

import { generateCompanySlug } from "../lib/company-matching";
import { COMPANY_DISCOVERY_CONFIDENCES, COMPANY_DISCOVERY_STATUSES } from "../lib/company-discovery-service";

function bool(value: string): boolean { return ["true", "1", "yes", "так"].includes(value.trim().toLowerCase()); }

async function main() {
  if (!existsSync("data/company-discovery-import.csv")) throw new Error("Missing data/company-discovery-import.csv");
  const rows = parseCsv(readFileSync("data/company-discovery-import.csv", "utf8"));
  const client = getClient();
  let imported = 0;
  let skipped = 0;
  const problems: string[] = [];

  for (const [index, row] of rows.entries()) {
    const line = index + 2;
    const discoveredName = row.discovered_name?.trim() ?? "";
    const sourceName = row.source_name?.trim() ?? "";
    const status = COMPANY_DISCOVERY_STATUSES.includes(row.status as never) ? row.status : "needs_review";
    const confidence = COMPANY_DISCOVERY_CONFIDENCES.includes(row.match_confidence as never) ? row.match_confidence : "low";
    const suggestedSlug = (row.suggested_slug?.trim() || generateCompanySlug(discoveredName)).toLowerCase();
    if (!discoveredName) { problems.push("line " + line + ": discovered_name is required"); skipped += 1; continue; }
    if (!suggestedSlug || /[А-Яа-яІіЇїЄєҐґ]/.test(suggestedSlug)) { problems.push("line " + line + ": invalid suggested_slug"); skipped += 1; continue; }
    if (!sourceName) { problems.push("line " + line + ": source_name is required"); skipped += 1; continue; }
    const isImported = status === "auto_imported" && bool(row.is_imported ?? "");
    const payload = {
      discovered_name: discoveredName,
      suggested_slug: suggestedSlug,
      source_name: sourceName,
      source_url: row.source_url?.trim() || null,
      city: row.city?.trim() || null,
      industry: row.industry?.trim() || null,
      description: row.description?.trim() || null,
      company_size: row.company_size?.trim() || null,
      matched_existing_slug: row.matched_existing_slug?.trim() || null,
      match_confidence: confidence,
      status,
      is_imported: isImported,
      imported_company_slug: row.imported_company_slug?.trim() || null,
      raw_excerpt: row.raw_excerpt?.trim() || null,
      collected_at: row.collected_at?.trim() || new Date().toISOString(),
      admin_note: row.admin_note?.trim() || null,
    };
    const { error } = await client.from("company_discovery_queue").insert(payload);
    if (error) { problems.push("line " + line + ": " + error.message); skipped += 1; }
    else imported += 1;
  }
  console.log("Imported company discovery rows:", imported);
  console.log("Skipped:", skipped);
  console.log("Problems:", problems.length);
  for (const problem of problems.slice(0, 50)) console.error(problem);
  if (problems.length) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
