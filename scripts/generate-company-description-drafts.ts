// scripts/generate-company-description-drafts.ts
// Generates neutral local CSV description drafts. No AI API and no DB writes.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

interface Args {
  output: string;
  limit: number | null;
  dryRun: boolean;
}

interface CompanyRow {
  name: string;
  slug: string;
  city?: string | null;
  industry?: string | null;
}

const DEFAULT_OUTPUT = "data/company-description-drafts.csv";

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

function parseArgs(argv: string[]): Args {
  const args: Args = {
    output: DEFAULT_OUTPUT,
    limit: null,
    dryRun: false,
  };

  for (const arg of argv) {
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg.startsWith("--output=")) args.output = arg.slice("--output=".length).trim();
    else if (arg.startsWith("--limit=")) args.limit = Number(arg.slice("--limit=".length));
  }

  return args;
}

function csvEscape(value: string): string {
  if (!/[",\n\r]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

function draftDescription(company: CompanyRow): string {
  const industry = company.industry?.trim() || "своїй сфері";
  const city = company.city?.trim();
  const cityText = city ? ` Компанія вказана з містом: ${city}.` : "";
  return `${company.name} — компанія у сфері ${industry}.${cityText} На сторінці можна переглянути відкриті факти, вакансії та анонімні відгуки користувачів.`;
}

function toCsv(companies: CompanyRow[]): string {
  const header = "company_slug,company_name,industry,city,draft_description,status,is_public,note";
  const rows = companies.map((company) => [
    company.slug,
    company.name,
    company.industry ?? "",
    company.city ?? "",
    draftDescription(company),
    "needs_verification",
    "false",
    "rule-based neutral draft; review before publishing",
  ].map((value) => csvEscape(String(value))).join(","));
  return [header, ...rows].join("\n") + "\n";
}

async function loadCompanies(): Promise<CompanyRow[]> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!supabaseUrl || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL and Supabase key");

  const client = createClient(supabaseUrl, key, { auth: { persistSession: false } });
  const { data, error } = await client
    .from("companies")
    .select("name, slug, city, industry")
    .order("name");
  if (error || !data) throw new Error(error?.message ?? "No companies loaded");
  return data as CompanyRow[];
}

export async function runGenerateCompanyDescriptionDrafts(argv = process.argv.slice(2)) {
  loadEnvLocal();
  const args = parseArgs(argv);
  const allCompanies = await loadCompanies();
  const companies = args.limit && args.limit > 0 ? allCompanies.slice(0, args.limit) : allCompanies;
  const csv = toCsv(companies);

  console.log("Company description draft generator");
  console.log("companies loaded:", allCompanies.length);
  console.log("drafts generated:", companies.length);
  console.log("output:", args.output);
  console.log("status:", "needs_verification");
  console.log("is_public:", "false");
  console.log("DB write:", "none");
  console.log("Schema note:", "No dedicated company description draft table/column is present. Suggested table: company_description_drafts(company_slug, draft_description, status, is_public, source_note, created_at, updated_at).");

  if (args.dryRun) {
    console.log("dry run: CSV was not written");
    return;
  }

  writeFileSync(args.output, csv, "utf8");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runGenerateCompanyDescriptionDrafts().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
