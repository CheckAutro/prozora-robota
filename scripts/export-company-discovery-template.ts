// scripts/export-company-discovery-template.ts
// Exports existing company_discovery_queue rows or an empty CSV template.

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

const COLUMNS = [
  "discovered_name", "suggested_slug", "source_name", "source_url", "city", "industry",
  "description", "company_size", "matched_existing_slug", "match_confidence", "status",
  "is_imported", "imported_company_slug", "raw_excerpt", "collected_at", "admin_note",
];

async function main() {
  const client = getClient();
  const { data, error } = await client.from("company_discovery_queue").select(COLUMNS.join(", "));
  if (error && /company_discovery_queue|does not exist|schema cache/i.test(error.message)) {
    writeFileSync("data/company-discovery-template.csv", COLUMNS.join(",") + "\n");
    console.log("company_discovery_queue table not found; wrote empty template.");
    return;
  }
  if (error) throw new Error(error.message);
  const lines = [COLUMNS.join(",")];
  for (const row of data ?? []) {
    lines.push(COLUMNS.map((column) => csvEscape((row as unknown as Record<string, unknown>)[column])).join(","));
  }
  writeFileSync("data/company-discovery-template.csv", lines.join("\n") + "\n");
  console.log("Exported company discovery rows:", data?.length ?? 0);
  console.log("Output: data/company-discovery-template.csv");
}

main().catch((err) => { console.error(err); process.exit(1); });
