// scripts/import-vacancy-facts-csv.ts
// Imports manually collected vacancy facts from CSV without fetching external sites.
// Writes only non-public company_open_facts and optional company_discovery_queue rows.

import { existsSync, readFileSync } from "node:fs";
import { extname } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  findBestCompanyMatch,
  generateCompanySlug,
  isConfidentCompanyMatch,
  type MatchableCompany,
} from "../lib/company-matching";
import { upsertCompanyDiscoveryQueue } from "../lib/company-discovery-service";
import { upsertCompanyOpenFactFromVacancy } from "../lib/company-open-facts-service";

interface Args {
  file: string;
  dryRun: boolean;
  limit: number | null;
}

interface CsvVacancyFactRow {
  source_url?: string;
  source_name?: string;
  company_name?: string;
  company_slug?: string;
  vacancy_title?: string;
  city?: string;
  salary_text?: string;
  salary_min?: string;
  salary_max?: string;
  raw_excerpt?: string;
  note?: string;
}

interface PreparedFact {
  sourceUrl: string;
  sourceName: string;
  companyName: string;
  companySlug: string;
  matchedCompany: MatchableCompany | null;
  vacancyTitle: string;
  city: string | null;
  salaryText: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  rawExcerpt: string | null;
  note: string | null;
}

interface ImportStats {
  totalRows: number;
  validRows: number;
  skippedRows: number;
  duplicatesSkipped: number;
  wouldInsertFacts: number;
  wouldUpdateFacts: number;
  wouldQueueCompanies: number;
  insertedFacts: number;
  updatedFacts: number;
  queuedCompanies: number;
  errors: number;
}

interface ImportWarning {
  line: number;
  sourceUrl: string;
  reason: string;
}

const DEFAULT_FILE = "data/vacancy-facts-import.csv";

const stats: ImportStats = {
  totalRows: 0,
  validRows: 0,
  skippedRows: 0,
  duplicatesSkipped: 0,
  wouldInsertFacts: 0,
  wouldUpdateFacts: 0,
  wouldQueueCompanies: 0,
  insertedFacts: 0,
  updatedFacts: 0,
  queuedCompanies: 0,
  errors: 0,
};

const warnings: ImportWarning[] = [];

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
    file: DEFAULT_FILE,
    dryRun: false,
    limit: null,
  };

  for (const arg of argv) {
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg.startsWith("--file=")) args.file = arg.slice("--file=".length).trim();
    else if (arg.startsWith("--limit=")) args.limit = Number(arg.slice("--limit=".length));
  }

  return args;
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
      if (char === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") cell += char;
  }

  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }

  const [headers = [], ...dataRows] = rows.filter((cells) => cells.some((value) => value.trim()));
  return dataRows
    .filter((cells) => cells.some((value) => value.trim()) && !cells[0]?.trim().startsWith("#"))
    .map((cells) => {
      const item: Record<string, string> = {};
      headers.forEach((header, index) => {
        item[header.trim()] = cells[index]?.trim() ?? "";
      });
      return item;
    });
}

function readRows(file: string, limit: number | null): CsvVacancyFactRow[] {
  if (!existsSync(file)) throw new Error("Input file not found: " + file);
  if (extname(file).toLowerCase() !== ".csv") throw new Error("Only CSV input is supported");
  const rows = parseCsv(readFileSync(file, "utf8")) as CsvVacancyFactRow[];
  return limit && limit > 0 ? rows.slice(0, limit) : rows;
}

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed || null;
}

function normalizeSourceUrl(value: string | undefined): string | null {
  try {
    const url = new URL(value?.trim() ?? "");
    url.hash = "";
    url.search = "";
    const host = url.hostname.replace(/^www\./, "");
    if (host === "work.ua" || host.endsWith(".work.ua")) {
      const match = /^\/jobs\/(\d+)\/?$/i.exec(url.pathname);
      if (match) return `https://www.work.ua/jobs/${match[1]}/`;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function isValidSlug(value: string | undefined): boolean {
  return Boolean(value && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.trim()));
}

function parseNumber(value: string | undefined): number | null {
  const compact = value?.replace(/[\s\u00a0\u202f]/g, "").replace(",", ".").trim();
  if (!compact) return null;
  const parsed = Number(compact);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseSalaryRange(salaryText: string | null): { min: number | null; max: number | null } {
  if (!salaryText) return { min: null, max: null };
  const normalized = salaryText.replace(/[\u00a0\u202f]/g, " ");
  const rangeMatch = /(\d[\d\s.,]*)\s*[–—-]\s*(\d[\d\s.,]*)/.exec(normalized);
  if (rangeMatch) {
    return {
      min: parseNumber(rangeMatch[1]),
      max: parseNumber(rangeMatch[2]),
    };
  }
  const singleMatch = /(?:від|до)?\s*(\d[\d\s.,]*)\s*(?:грн|₴|uah)?/i.exec(normalized);
  if (!singleMatch) return { min: null, max: null };
  const value = parseNumber(singleMatch[1]);
  if (/до\s+/i.test(normalized)) return { min: null, max: value };
  return { min: value, max: null };
}

async function loadCompanies(client: SupabaseClient): Promise<MatchableCompany[]> {
  const { data, error } = await client
    .from("companies")
    .select("name, slug, city, industry")
    .order("name");
  if (error || !data) throw new Error(error?.message ?? "No companies loaded");
  return data as MatchableCompany[];
}

async function sourceUrlExists(client: SupabaseClient, companySlug: string, sourceUrl: string): Promise<boolean> {
  const { data } = await client
    .from("company_open_facts")
    .select("id")
    .eq("company_slug", companySlug)
    .eq("source_url", sourceUrl)
    .maybeSingle();
  return Boolean(data);
}

function findBySlug(companies: MatchableCompany[], slug: string | undefined): MatchableCompany | null {
  if (!isValidSlug(slug)) return null;
  return companies.find((company) => company.slug === slug?.trim()) ?? null;
}

function prepareFact(row: CsvVacancyFactRow, companies: MatchableCompany[], line: number): PreparedFact | null {
  const sourceUrl = normalizeSourceUrl(row.source_url);
  const sourceName = clean(row.source_name);
  const companyName = clean(row.company_name);
  const vacancyTitle = clean(row.vacancy_title);
  if (!sourceUrl || !sourceName || !companyName || !vacancyTitle) {
    stats.skippedRows += 1;
    warnings.push({
      line,
      sourceUrl: row.source_url ?? "",
      reason: "source_url, source_name, company_name and vacancy_title are required",
    });
    return null;
  }

  const slugMatch = findBySlug(companies, row.company_slug);
  const nameMatch = findBestCompanyMatch(companyName, companies);
  const matchedCompany = slugMatch ?? (isConfidentCompanyMatch(nameMatch) ? nameMatch.company : null);
  const companySlug = matchedCompany?.slug ?? (isValidSlug(row.company_slug) ? row.company_slug!.trim() : generateCompanySlug(companyName));
  const salaryText = clean(row.salary_text);
  const parsedSalary = parseSalaryRange(salaryText);
  const salaryMin = parseNumber(row.salary_min) ?? parsedSalary.min;
  const salaryMax = parseNumber(row.salary_max) ?? parsedSalary.max;
  const fallbackSalaryText = !salaryText && (salaryMin !== null || salaryMax !== null)
    ? [salaryMin ?? "", salaryMax ?? ""].filter((item) => item !== "").join("–") + " грн"
    : salaryText;

  return {
    sourceUrl,
    sourceName,
    companyName,
    companySlug,
    matchedCompany,
    vacancyTitle,
    city: clean(row.city),
    salaryText: fallbackSalaryText,
    salaryMin,
    salaryMax,
    rawExcerpt: clean(row.raw_excerpt),
    note: clean(row.note),
  };
}

async function queueCompany(fact: PreparedFact, args: Args): Promise<void> {
  if (fact.matchedCompany) return;
  if (args.dryRun) {
    stats.wouldQueueCompanies += 1;
    return;
  }

  const queued = await upsertCompanyDiscoveryQueue({
    discovered_name: fact.companyName,
    suggested_slug: fact.companySlug,
    source_name: fact.sourceName,
    source_url: fact.sourceUrl,
    city: fact.city,
    description: fact.rawExcerpt,
    match_confidence: "low",
    status: "needs_review",
    is_imported: false,
    raw_excerpt: fact.rawExcerpt,
    admin_note: fact.note,
  });

  if (queued.ok) stats.queuedCompanies += queued.created ? 1 : 0;
  else {
    stats.errors += 1;
    warnings.push({ line: 0, sourceUrl: fact.sourceUrl, reason: queued.error });
  }
}

async function importFact(client: SupabaseClient, fact: PreparedFact, args: Args): Promise<void> {
  const existed = await sourceUrlExists(client, fact.companySlug, fact.sourceUrl);
  if (args.dryRun) {
    if (existed) stats.wouldUpdateFacts += 1;
    else stats.wouldInsertFacts += 1;
    return;
  }

  const result = await upsertCompanyOpenFactFromVacancy({
    company_slug: fact.companySlug,
    company_name: fact.companyName,
    source_name: fact.sourceName,
    source_url: fact.sourceUrl,
    vacancy_title: fact.vacancyTitle,
    city: fact.city,
    salary_text: fact.salaryText,
    raw_excerpt: fact.rawExcerpt,
    vacancy_description: fact.rawExcerpt,
    status: "needs_verification",
    is_public: false,
  });

  if (!result.ok) {
    stats.errors += 1;
    warnings.push({ line: 0, sourceUrl: fact.sourceUrl, reason: result.error });
    return;
  }

  if (existed) stats.updatedFacts += 1;
  else stats.insertedFacts += 1;
}

function printReport(args: Args) {
  console.log("Vacancy facts CSV import report");
  console.log("total rows:", stats.totalRows);
  console.log("valid rows:", stats.validRows);
  console.log("skipped rows:", stats.skippedRows);
  console.log("duplicates skipped:", stats.duplicatesSkipped);
  if (args.dryRun) {
    console.log("would insert facts:", stats.wouldInsertFacts);
    console.log("would update facts:", stats.wouldUpdateFacts);
    console.log("would queue companies:", stats.wouldQueueCompanies);
  } else {
    console.log("inserted facts:", stats.insertedFacts);
    console.log("updated facts:", stats.updatedFacts);
    console.log("queued companies:", stats.queuedCompanies);
  }
  console.log("errors:", stats.errors);
  if (args.dryRun) console.log("dry run: no rows were written");

  for (const warning of warnings.slice(0, 50)) {
    const line = warning.line ? `line ${warning.line}` : "row";
    console.warn(`${line} ${warning.sourceUrl || "(no source_url)"} -> ${warning.reason}`);
  }
  if (warnings.length > 50) console.warn("...and " + (warnings.length - 50) + " more");
}

export async function runVacancyFactsCsvImport(argv = process.argv.slice(2)) {
  loadEnvLocal();
  const args = parseArgs(argv);
  const rows = readRows(args.file, args.limit);
  stats.totalRows = rows.length;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!supabaseUrl || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");

  const client = createClient(supabaseUrl, key, { auth: { persistSession: false } });
  const companies = await loadCompanies(client);
  const seenSourceUrls = new Set<string>();

  for (let index = 0; index < rows.length; index += 1) {
    const fact = prepareFact(rows[index], companies, index + 2);
    if (!fact) continue;
    if (seenSourceUrls.has(fact.sourceUrl)) {
      stats.duplicatesSkipped += 1;
      continue;
    }
    seenSourceUrls.add(fact.sourceUrl);
    stats.validRows += 1;

    await importFact(client, fact, args);
    await queueCompany(fact, args);
  }

  printReport(args);
  if (stats.errors > 0 && !args.dryRun) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runVacancyFactsCsvImport().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
