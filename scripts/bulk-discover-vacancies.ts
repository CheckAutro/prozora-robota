// scripts/bulk-discover-vacancies.ts
// Conservative public-fetch vacancy discovery for Work.ua / Robota.ua.
// No browser automation, no login/captcha bypass, no paid APIs.

import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { findBestCompanyMatch, isConfidentCompanyMatch, type MatchableCompany } from "../lib/company-matching";
import { createCompanyFromDiscovery, upsertCompanyDiscoveryQueue } from "../lib/company-discovery-service";
import { upsertCompanyOpenFactFromVacancy } from "../lib/company-open-facts-service";
import { parseVacancyUrl, type ParsedVacancy } from "../lib/vacancy-parser";

interface Args {
  dryRun: boolean;
  limit: number | null;
  company: string | null;
  source: "all" | "workua" | "robotaua";
  maxVacanciesPerCompany: number;
  autoImportCompanies: boolean;
}

interface Stats {
  companiesScanned: number;
  searchPagesFetched: number;
  vacanciesFound: number;
  factsInserted: number;
  factsUpdated: number;
  discoveryQueued: number;
  companiesAutoImported: number;
  skippedBlocked: number;
  skippedWeakMatch: number;
  skippedDuplicates: number;
  errors: number;
}

const stats: Stats = {
  companiesScanned: 0,
  searchPagesFetched: 0,
  vacanciesFound: 0,
  factsInserted: 0,
  factsUpdated: 0,
  discoveryQueued: 0,
  companiesAutoImported: 0,
  skippedBlocked: 0,
  skippedWeakMatch: 0,
  skippedDuplicates: 0,
  errors: 0,
};

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
    dryRun: false,
    limit: null,
    company: null,
    source: "all",
    maxVacanciesPerCompany: 3,
    autoImportCompanies: false,
  };
  for (const arg of argv) {
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg.startsWith("--limit=")) args.limit = Number(arg.slice("--limit=".length));
    else if (arg.startsWith("--company=")) args.company = arg.slice("--company=".length).trim();
    else if (arg.startsWith("--source=")) {
      const value = arg.slice("--source=".length);
      if (value === "workua" || value === "robotaua") args.source = value;
    } else if (arg.startsWith("--max-vacancies-per-company=")) {
      args.maxVacanciesPerCompany = Math.max(1, Number(arg.slice("--max-vacancies-per-company=".length)) || 3);
    } else if (arg.startsWith("--auto-import-companies=")) {
      args.autoImportCompanies = arg.endsWith("=true");
    }
  }
  return args;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function politeDelayMs(): number {
  return 1000 + Math.floor(Math.random() * 2000);
}

function isBlockedHtml(status: number | null, html: string | null): boolean {
  if (status === 403 || status === 429) return true;
  const text = (html ?? "").toLowerCase();
  return /captcha|cloudflare|access denied|доступ обмежено|перевірте що ви не робот/.test(text);
}

async function fetchText(url: string): Promise<{ html: string | null; status: number | null; blocked: boolean }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "WorkRadar vacancy discovery (+https://prozora-robota.vercel.app)",
        accept: "text/html,application/xhtml+xml",
      },
    });
    const html = res.ok ? await res.text() : null;
    return { html, status: res.status, blocked: isBlockedHtml(res.status, html) };
  } catch {
    return { html: null, status: null, blocked: false };
  } finally {
    clearTimeout(timeout);
  }
}

function unique(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}

function absoluteUrl(base: string, href: string): string | null {
  try { return new URL(href, base).toString(); } catch { return null; }
}

function extractWorkUaLinks(html: string): string[] {
  const links = [...html.matchAll(/href=["']([^"']*\/jobs\/\d+\/?[^"']*)["']/gi)]
    .map((match) => absoluteUrl("https://www.work.ua", match[1]))
    .filter((value): value is string => Boolean(value));
  return unique(links);
}

function extractRobotaUaLinks(html: string): string[] {
  const links = [...html.matchAll(/href=["']([^"']*\/company\d+\/vacancy\d+[^"']*)["']/gi)]
    .map((match) => absoluteUrl("https://robota.ua", match[1]))
    .filter((value): value is string => Boolean(value));
  return unique(links);
}

function searchUrls(company: MatchableCompany, source: "workua" | "robotaua"): string[] {
  const query = encodeURIComponent(company.name);
  if (source === "workua") return ["https://www.work.ua/jobs/?search=" + query];
  return ["https://robota.ua/zapros/" + query + "/ukraine"];
}

function hasMinimumFacts(parsed: ParsedVacancy): boolean {
  return Boolean(parsed.title && (parsed.city || parsed.salaryText || parsed.descriptionText || parsed.schedule || parsed.employmentType));
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

async function loadCompanies(client: SupabaseClient, args: Args): Promise<MatchableCompany[]> {
  let query = client.from("companies").select("name, slug, city, industry").order("name");
  if (args.company) query = query.eq("slug", args.company);
  if (args.limit && args.limit > 0) query = query.limit(args.limit);
  const { data, error } = await query;
  if (error || !data) throw new Error(error?.message ?? "No companies loaded");
  return data as MatchableCompany[];
}

async function discoverForSource(
  client: SupabaseClient,
  company: MatchableCompany,
  companies: MatchableCompany[],
  source: "workua" | "robotaua",
  args: Args
) {
  const foundLinks: string[] = [];
  for (const url of searchUrls(company, source)) {
    await sleep(politeDelayMs());
    const { html, blocked } = await fetchText(url);
    stats.searchPagesFetched += 1;
    if (blocked) { stats.skippedBlocked += 1; continue; }
    if (!html) { stats.errors += 1; continue; }
    const links = source === "workua" ? extractWorkUaLinks(html) : extractRobotaUaLinks(html);
    foundLinks.push(...links);
  }

  const links = unique(foundLinks).slice(0, args.maxVacanciesPerCompany);
  stats.vacanciesFound += links.length;

  for (const link of links) {
    await sleep(politeDelayMs());
    const parsedResult = await parseVacancyUrl(link);
    if (!parsedResult.ok) {
      stats.skippedBlocked += parsedResult.fetchStatus === 403 ? 1 : 0;
      continue;
    }

    const parsed = parsedResult.parseResult.parsed;
    const match = findBestCompanyMatch(parsed.companyName ?? company.name, companies);
    const isTargetMatch = isConfidentCompanyMatch(match) && match.company?.slug === company.slug;
    if (!isTargetMatch) {
      stats.skippedWeakMatch += 1;
      if (parsed.companyName && parsed.sourceUrl && !args.dryRun) {
        const queued = await upsertCompanyDiscoveryQueue({
          discovered_name: parsed.companyName,
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
        });
        if (queued.ok) {
          stats.discoveryQueued += queued.created ? 1 : 0;
          const canAutoImport = Boolean(
            args.autoImportCompanies &&
            queued.id &&
            !match.company &&
            parsed.companyName &&
            parsed.sourceUrl &&
            (parsed.city || parsed.companyDescription || parsed.descriptionText)
          );
          if (canAutoImport && queued.id) {
            const imported = await createCompanyFromDiscovery(queued.id, {
              city: parsed.city ?? undefined,
              industry: undefined,
              description: parsed.companyDescription ?? undefined,
            });
            if (imported.ok) stats.companiesAutoImported += 1;
            else stats.errors += 1;
          }
        } else stats.errors += 1;
      }
      continue;
    }

    if (!parsed.sourceUrl || !hasMinimumFacts(parsed)) {
      stats.skippedWeakMatch += 1;
      continue;
    }

    if (args.dryRun) continue;
    const existed = await sourceUrlExists(client, company.slug, parsed.sourceUrl);
    const saved = await upsertCompanyOpenFactFromVacancy({
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
      status: "verified",
      is_public: true,
    });
    if (saved.ok) {
      if (existed) stats.factsUpdated += 1;
      else stats.factsInserted += 1;
    } else {
      stats.errors += 1;
    }
  }
}

export async function runBulkVacancyDiscovery(argv = process.argv.slice(2)) {
  loadEnvLocal();
  const args = parseArgs(argv);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!supabaseUrl || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  const client = createClient(supabaseUrl, key, { auth: { persistSession: false } });
  const companies = await loadCompanies(client, args);
  const sources = args.source === "all" ? ["workua", "robotaua"] as const : [args.source] as const;

  for (const company of companies) {
    stats.companiesScanned += 1;
    for (const source of sources) {
      await discoverForSource(client, company, companies, source, args);
    }
  }

  console.log("Bulk vacancy discovery report");
  console.log("companies scanned:", stats.companiesScanned);
  console.log("search pages fetched:", stats.searchPagesFetched);
  console.log("vacancies found:", stats.vacanciesFound);
  console.log("facts inserted:", stats.factsInserted);
  console.log("facts updated:", stats.factsUpdated);
  console.log("discovery queued:", stats.discoveryQueued);
  console.log("companies auto-imported:", stats.companiesAutoImported, args.autoImportCompanies ? "" : "(disabled by default)");
  console.log("skipped blocked:", stats.skippedBlocked);
  console.log("skipped weak match:", stats.skippedWeakMatch);
  console.log("skipped duplicates:", stats.skippedDuplicates);
  console.log("errors:", stats.errors);
  if (args.dryRun) console.log("dry run: no rows were written");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runBulkVacancyDiscovery().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
