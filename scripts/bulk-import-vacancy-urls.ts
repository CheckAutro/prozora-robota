// scripts/bulk-import-vacancy-urls.ts
// Imports a curated list of Work.ua / Robota.ua vacancy URLs into non-public company_open_facts.
// No browser automation, no login/captcha bypass, no paid APIs, no AI APIs.

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
import {
  createCompanyFromDiscovery,
  upsertCompanyDiscoveryQueue,
} from "../lib/company-discovery-service";
import { upsertCompanyOpenFactFromVacancy } from "../lib/company-open-facts-service";
import {
  detectVacancyInput,
  parseVacancyUrl,
  type ParsedVacancy,
} from "../lib/vacancy-parser";

interface Args {
  file: string;
  dryRun: boolean;
  limit: number | null;
  source: "all" | "workua" | "robotaua";
  autoImportCompanies: boolean;
}

interface VacancyUrlInput {
  url: string;
  company_slug?: string;
  company_name?: string;
  source_name?: string;
  note?: string;
}

interface ImportStats {
  totalUrls: number;
  processedUrls: number;
  validUrls: number;
  factsInserted: number;
  factsUpdated: number;
  reviewSignalsImported: number;
  nonPublicCreated: number;
  wouldInsert: number;
  wouldUpdate: number;
  wouldCreateNonPublic: number;
  newCompaniesQueued: number;
  wouldQueueNewCompanies: number;
  companiesAutoImported: number;
  skippedUnsupported: number;
  skippedBlocked: number;
  skippedWeakMatch: number;
  skippedDuplicate: number;
  errors: number;
}

interface ImportError {
  url: string;
  reason: string;
}

const stats: ImportStats = {
  totalUrls: 0,
  processedUrls: 0,
  validUrls: 0,
  factsInserted: 0,
  factsUpdated: 0,
  reviewSignalsImported: 0,
  nonPublicCreated: 0,
  wouldInsert: 0,
  wouldUpdate: 0,
  wouldCreateNonPublic: 0,
  newCompaniesQueued: 0,
  wouldQueueNewCompanies: 0,
  companiesAutoImported: 0,
  skippedUnsupported: 0,
  skippedBlocked: 0,
  skippedWeakMatch: 0,
  skippedDuplicate: 0,
  errors: 0,
};

const errors: ImportError[] = [];

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
    file: "data/vacancy-urls.txt",
    dryRun: false,
    limit: null,
    source: "all",
    autoImportCompanies: false,
  };

  for (const arg of argv) {
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg.startsWith("--file=")) args.file = arg.slice("--file=".length).trim();
    else if (arg.startsWith("--limit=")) args.limit = Number(arg.slice("--limit=".length));
    else if (arg.startsWith("--source=")) {
      const value = arg.slice("--source=".length);
      if (value === "workua" || value === "robotaua") args.source = value;
    } else if (arg.startsWith("--auto-import-companies=")) {
      args.autoImportCompanies = arg.endsWith("=true");
    }
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
  return dataRows
    .filter((cells) => cells.some((value) => value.trim()))
    .map((cells) => {
      const item: Record<string, string> = {};
      headers.forEach((header, index) => { item[header.trim()] = cells[index]?.trim() ?? ""; });
      return item;
    });
}

function loadInputs(file: string, limit: number | null): VacancyUrlInput[] {
  if (!existsSync(file)) throw new Error("Input file not found: " + file);
  const content = readFileSync(file, "utf8");
  const extension = extname(file).toLowerCase();
  const rows = extension === ".csv"
    ? parseCsv(content).map((row) => ({
        url: row.url ?? "",
        company_slug: row.company_slug || undefined,
        company_name: row.company_name || undefined,
        source_name: row.source_name || undefined,
        note: row.note || undefined,
      }))
    : content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"))
        .map((url) => ({ url }));

  return (limit && limit > 0 ? rows.slice(0, limit) : rows).filter((row) => row.url.trim());
}

function sourceMatchesFilter(inputType: string, source: Args["source"]): boolean {
  if (source === "all") return true;
  if (source === "workua") return inputType === "work.ua URL";
  return inputType === "robota.ua URL";
}

function canonicalUrl(input: string): string | null {
  try { return new URL(input.trim()).toString(); } catch { return null; }
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

function hasMinimumFacts(parsed: ParsedVacancy): boolean {
  return Boolean(parsed.title && (parsed.city || parsed.salaryText || parsed.descriptionText || parsed.schedule || parsed.employmentType));
}

function findBySlug(companies: MatchableCompany[], slug: string | undefined): MatchableCompany | null {
  if (!slug) return null;
  return companies.find((company) => company.slug === slug.trim()) ?? null;
}

function chooseCompany(
  input: VacancyUrlInput,
  parsed: ParsedVacancy,
  companies: MatchableCompany[]
): { company: MatchableCompany | null; reason: string; weakReason?: string } {
  const hinted = findBySlug(companies, input.company_slug);
  if (input.company_slug && !hinted) {
    return { company: null, reason: "missing-hinted-company", weakReason: "company_slug not found: " + input.company_slug };
  }

  const parsedName = parsed.companyName ?? input.company_name ?? null;
  const parsedMatch = findBestCompanyMatch(parsedName, companies);

  if (hinted) {
    const parsedSlug = parsedMatch.company?.slug;
    if (parsed.companyName && parsedSlug && isConfidentCompanyMatch(parsedMatch) && parsedSlug !== hinted.slug) {
      return {
        company: null,
        reason: "hint-conflicts-with-parsed-company",
        weakReason: "company_slug hint conflicts with parsed company " + parsedSlug,
      };
    }
    return { company: hinted, reason: "csv-company-slug" };
  }

  if (isConfidentCompanyMatch(parsedMatch) && parsedMatch.company) {
    return { company: parsedMatch.company, reason: parsedMatch.reason };
  }

  return {
    company: null,
    reason: parsedMatch.reason,
    weakReason: parsedName ? "no confident company match for " + parsedName : "company name was not parsed",
  };
}

async function queueDiscoveredCompany(
  parsed: ParsedVacancy,
  input: VacancyUrlInput,
  companies: MatchableCompany[],
  args: Args
): Promise<void> {
  const discoveredName = parsed.companyName ?? input.company_name?.trim() ?? "";
  if (!discoveredName || !parsed.sourceUrl) {
    stats.skippedWeakMatch += 1;
    return;
  }

  const match = findBestCompanyMatch(discoveredName, companies);
  if (args.dryRun) {
    stats.wouldQueueNewCompanies += 1;
    return;
  }

  const queued = await upsertCompanyDiscoveryQueue({
    discovered_name: discoveredName,
    suggested_slug: generateCompanySlug(discoveredName),
    source_name: parsed.source,
    source_url: parsed.sourceUrl,
    city: parsed.city,
    industry: null,
    description: parsed.companyDescription,
    matched_existing_slug: match.company?.slug ?? null,
    match_confidence: match.confidence,
    status: "needs_review",
    is_imported: false,
    raw_excerpt: parsed.descriptionText.slice(0, 1500),
    admin_note: input.note ?? null,
  });

  if (!queued.ok) {
    stats.errors += 1;
    errors.push({ url: parsed.sourceUrl, reason: queued.error });
    return;
  }

  stats.newCompaniesQueued += queued.created ? 1 : 0;
  const canAutoImport = Boolean(
    args.autoImportCompanies &&
    queued.id &&
    !match.company &&
    parsed.sourceUrl &&
    (parsed.city || parsed.companyDescription || parsed.descriptionText || parsed.salaryText || parsed.schedule || parsed.employmentType)
  );

  if (canAutoImport && queued.id) {
    const imported = await createCompanyFromDiscovery(queued.id, {
      city: parsed.city ?? undefined,
      industry: undefined,
      description: parsed.companyDescription ?? undefined,
    });
    if (imported.ok) stats.companiesAutoImported += 1;
    else {
      stats.errors += 1;
      errors.push({ url: parsed.sourceUrl, reason: imported.error });
    }
  }
}

async function saveOpenFact(
  client: SupabaseClient,
  company: MatchableCompany,
  parsed: ParsedVacancy,
  args: Args
): Promise<void> {
  if (!parsed.sourceUrl || !hasMinimumFacts(parsed)) {
    stats.skippedWeakMatch += 1;
    return;
  }

  const existed = await sourceUrlExists(client, company.slug, parsed.sourceUrl);
  if (args.dryRun) {
    if (existed) stats.wouldUpdate += 1;
    else {
      stats.wouldInsert += 1;
      stats.wouldCreateNonPublic += 1;
    }
    return;
  }

  const result = await upsertCompanyOpenFactFromVacancy({
    company_slug: company.slug,
    company_name: company.name,
    source_name: parsed.source,
    source_url: parsed.sourceUrl,
    vacancy_title: parsed.title,
    city: parsed.city,
    salary_text: parsed.salaryText,
    employment_type: parsed.employmentType,
    schedule: parsed.schedule,
    experience: parsed.experience,
    education: parsed.education,
    company_description: parsed.companyDescription,
    vacancy_description: parsed.descriptionText.slice(0, 6000),
    requirements: parsed.requirements,
    responsibilities: parsed.responsibilities,
    conditions: parsed.conditions,
    benefits: parsed.benefits,
    skills: parsed.skills,
    mentions_official_employment: parsed.mentionsOfficialEmployment,
    mentions_booking: parsed.mentionsBooking,
    mentions_probation: parsed.mentionsProbation,
    mentions_bonus: parsed.mentionsBonus,
    raw_excerpt: parsed.descriptionText.slice(0, 2000),
    status: "needs_verification",
    is_public: false,
  });

  if (result.ok) {
    if (existed) stats.factsUpdated += 1;
    else {
      stats.factsInserted += 1;
      stats.nonPublicCreated += 1;
    }
  } else {
    stats.errors += 1;
    errors.push({ url: parsed.sourceUrl, reason: result.error });
  }
}

async function processInput(
  client: SupabaseClient,
  input: VacancyUrlInput,
  companies: MatchableCompany[],
  args: Args
): Promise<void> {
  stats.processedUrls += 1;
  const url = canonicalUrl(input.url);
  if (!url) {
    stats.skippedUnsupported += 1;
    errors.push({ url: input.url, reason: "invalid URL" });
    return;
  }

  const detected = detectVacancyInput(url);
  if ((detected.inputType !== "work.ua URL" && detected.inputType !== "robota.ua URL") || !sourceMatchesFilter(detected.inputType, args.source)) {
    stats.skippedUnsupported += 1;
    return;
  }
  stats.validUrls += 1;

  const parsedResult = await parseVacancyUrl(url);
  if (!parsedResult.ok) {
    stats.skippedBlocked += 1;
    errors.push({ url, reason: parsedResult.fallbackReason ?? "fetch failed or blocked" });
    return;
  }

  const parsed = parsedResult.parseResult.parsed;
  const selected = chooseCompany(input, parsed, companies);
  if (!selected.company) {
    if (selected.weakReason) errors.push({ url, reason: selected.weakReason });
    await queueDiscoveredCompany(parsed, input, companies, args);
    return;
  }

  await saveOpenFact(client, selected.company, parsed, args);
}

function printReport(args: Args) {
  console.log("Bulk vacancy URL import report");
  console.log("total URLs:", stats.totalUrls);
  console.log("processed urls:", stats.processedUrls);
  console.log("valid urls:", stats.validUrls);
  console.log("imported open facts:", stats.factsInserted + stats.factsUpdated);
  console.log("imported review signals:", stats.reviewSignalsImported);
  console.log("skipped duplicates:", stats.skippedDuplicate);
  console.log("failed URLs:", errors.length);
  console.log("non-public created count:", stats.nonPublicCreated);
  console.log("facts inserted:", stats.factsInserted);
  console.log("facts updated:", stats.factsUpdated);
  if (args.dryRun) {
    console.log("would import open facts:", stats.wouldInsert + stats.wouldUpdate);
    console.log("would insert:", stats.wouldInsert);
    console.log("would update:", stats.wouldUpdate);
    console.log("would create non-public records:", stats.wouldCreateNonPublic);
    console.log("would queue new companies:", stats.wouldQueueNewCompanies);
  }
  console.log("new companies queued:", stats.newCompaniesQueued);
  console.log("companies auto-imported:", stats.companiesAutoImported, args.autoImportCompanies ? "" : "(disabled by default)");
  console.log("skipped unsupported:", stats.skippedUnsupported);
  console.log("skipped blocked:", stats.skippedBlocked);
  console.log("skipped weak match:", stats.skippedWeakMatch);
  console.log("skipped duplicate:", stats.skippedDuplicate);
  console.log("errors:", stats.errors);
  if (args.dryRun) console.log("dry run: no rows were written");
  for (const error of errors.slice(0, 50)) {
    console.error(error.url + " -> " + error.reason);
  }
  if (errors.length > 50) console.error("...and " + (errors.length - 50) + " more");
}

export async function runBulkVacancyUrlImport(argv = process.argv.slice(2)) {
  loadEnvLocal();
  const args = parseArgs(argv);
  const inputs = loadInputs(args.file, args.limit);
  stats.totalUrls = inputs.length;
  const seen = new Set<string>();
  const uniqueInputs: VacancyUrlInput[] = [];

  for (const input of inputs) {
    const url = canonicalUrl(input.url);
    if (!url) {
      uniqueInputs.push(input);
      continue;
    }
    if (seen.has(url)) {
      stats.skippedDuplicate += 1;
      continue;
    }
    seen.add(url);
    uniqueInputs.push({ ...input, url });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!supabaseUrl || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");

  const client = createClient(supabaseUrl, key, { auth: { persistSession: false } });
  const companies = await loadCompanies(client);

  for (const input of uniqueInputs) {
    await processInput(client, input, companies, args);
  }

  printReport(args);
  if (stats.errors > 0 && !args.dryRun) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runBulkVacancyUrlImport().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
