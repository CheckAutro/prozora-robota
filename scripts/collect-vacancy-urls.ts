// scripts/collect-vacancy-urls.ts
// Collects Work.ua / Robota.ua vacancy URLs from provided public source pages.
// It only writes a CSV for the existing importer. No Supabase writes.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

type SourceName = "Work.ua" | "Robota.ua";

interface Args {
  input: string;
  output: string;
  dryRun: boolean;
  timeoutMs: number;
  delayMs: number;
}

interface SourcePage {
  company_name: string;
  company_slug: string;
  source_name: SourceName;
  source_url: string;
  html_file: string;
  note: string;
}

interface CollectedVacancyUrl {
  url: string;
  company_slug: string;
  company_name: string;
  source_name: SourceName;
  note: string;
}

interface FetchResult {
  html: string | null;
  status: number | null;
  warning: string | null;
}

interface PageWarning {
  sourceUrl: string;
  companyName: string;
  sourceName: SourceName | string;
  reason: string;
}

interface Stats {
  sourcePagesRead: number;
  sourcePagesFetched: number;
  localHtmlPagesRead: number;
  urlsFoundRaw: number;
  duplicateUrlsRemoved: number;
  blockedPages: PageWarning[];
  missingHtmlFiles: PageWarning[];
  zeroUrlPages: PageWarning[];
  warnings: PageWarning[];
}

const DEFAULT_INPUT = "data/vacancy-source-pages.csv";
const DEFAULT_OUTPUT = "data/vacancy-urls-import.csv";
const CSV_HEADER = "url,company_slug,company_name,source_name,note";

const stats: Stats = {
  sourcePagesRead: 0,
  sourcePagesFetched: 0,
  localHtmlPagesRead: 0,
  urlsFoundRaw: 0,
  duplicateUrlsRemoved: 0,
  blockedPages: [],
  missingHtmlFiles: [],
  zeroUrlPages: [],
  warnings: [],
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    input: DEFAULT_INPUT,
    output: DEFAULT_OUTPUT,
    dryRun: false,
    timeoutMs: 12000,
    delayMs: 1200,
  };

  for (const arg of argv) {
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg.startsWith("--input=")) args.input = arg.slice("--input=".length).trim();
    else if (arg.startsWith("--output=")) args.output = arg.slice("--output=".length).trim();
    else if (arg.startsWith("--timeout-ms=")) args.timeoutMs = Math.max(1000, Number(arg.slice("--timeout-ms=".length)) || args.timeoutMs);
    else if (arg.startsWith("--delay-ms=")) args.delayMs = Math.max(0, Number(arg.slice("--delay-ms=".length)) || args.delayMs);
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

  const [headers = [], ...dataRows] = rows;
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

function toSourceName(value: string): SourceName | null {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "");
  if (normalized === "work.ua" || normalized === "workua") return "Work.ua";
  if (normalized === "robota.ua" || normalized === "robotaua") return "Robota.ua";
  return null;
}

function loadSourcePages(input: string): SourcePage[] {
  if (!existsSync(input)) throw new Error("Input file not found: " + input);
  const rows = parseCsv(readFileSync(input, "utf8"));
  const pages: SourcePage[] = [];

  for (const row of rows) {
    const sourceName = toSourceName(row.source_name ?? "");
    if (!sourceName || !row.source_url?.trim()) {
      stats.warnings.push({
        sourceUrl: row.source_url ?? "",
        companyName: row.company_name ?? "",
        sourceName: row.source_name ?? "",
        reason: "missing source_url or unsupported source_name",
      });
      continue;
    }

    pages.push({
      company_name: row.company_name?.trim() ?? "",
      company_slug: row.company_slug?.trim() ?? "",
      source_name: sourceName,
      source_url: row.source_url.trim(),
      html_file: row.html_file?.trim() ?? "",
      note: row.note?.trim() ?? "",
    });
  }

  return pages;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isBlockedHtml(status: number | null, html: string | null): boolean {
  if (status === 401 || status === 403 || status === 429) return true;
  const text = (html ?? "").toLowerCase();
  return /captcha|cloudflare|access denied|доступ обмежено|перевірте що ви не робот|robot check/.test(text);
}

async function fetchHtml(url: string, timeoutMs: number): Promise<FetchResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "WorkRadar vacancy URL collector (+https://prozora-robota.vercel.app)",
        accept: "text/html,application/xhtml+xml",
      },
    });
    const html = res.ok ? await res.text() : null;
    if (isBlockedHtml(res.status, html)) {
      return { html: null, status: res.status, warning: "blocked or captcha-like response" };
    }
    if (!res.ok || !html) {
      return { html: null, status: res.status, warning: "empty or non-ok response" };
    }
    return { html, status: res.status, warning: null };
  } catch (error) {
    return {
      html: null,
      status: null,
      warning: error instanceof Error ? error.message : "fetch failed",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function readLocalHtml(page: SourcePage): FetchResult {
  if (!existsSync(page.html_file)) {
    return { html: null, status: null, warning: "local HTML file not found" };
  }

  try {
    const html = readFileSync(page.html_file, "utf8");
    return html.trim()
      ? { html, status: null, warning: null }
      : { html: null, status: null, warning: "local HTML file is empty" };
  } catch (error) {
    return {
      html: null,
      status: null,
      warning: error instanceof Error ? error.message : "could not read local HTML file",
    };
  }
}

function decodeAttr(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function extractHrefValues(html: string): string[] {
  const values: string[] = [];
  const pattern = /\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html))) {
    const raw = match[1] ?? match[2] ?? match[3] ?? "";
    const value = decodeAttr(raw).trim();
    if (value) values.push(value);
  }
  return values;
}

function normalizeWorkUaUrl(href: string, sourceUrl: string): string | null {
  try {
    const url = new URL(href, sourceUrl);
    const host = url.hostname.replace(/^www\./, "");
    if (host !== "work.ua" && !host.endsWith(".work.ua")) return null;
    const match = /^\/jobs\/(\d+)\/?$/i.exec(url.pathname);
    if (!match) return null;
    return `https://www.work.ua/jobs/${match[1]}/`;
  } catch {
    return null;
  }
}

function normalizeRobotaUaUrl(href: string, sourceUrl: string): string | null {
  try {
    const url = new URL(href, sourceUrl);
    const host = url.hostname.replace(/^www\./, "");
    if (host !== "robota.ua" && !host.endsWith(".robota.ua")) return null;

    const segments = url.pathname.split("/").filter(Boolean);
    const vacancyIndex = segments.findIndex((segment) => /^vacancy\d+$/i.test(segment));
    if (vacancyIndex === -1) return null;

    const normalizedPath = "/" + segments.slice(0, vacancyIndex + 1).join("/");
    return `https://robota.ua${normalizedPath}`;
  } catch {
    return null;
  }
}

function extractVacancyUrls(html: string, page: SourcePage): string[] {
  const urls: string[] = [];

  for (const href of extractHrefValues(html)) {
    const normalized = page.source_name === "Work.ua"
      ? normalizeWorkUaUrl(href, page.source_url)
      : normalizeRobotaUaUrl(href, page.source_url);
    if (!normalized) continue;
    urls.push(normalized);
  }

  return urls;
}

function csvEscape(value: string): string {
  if (!/[",\n\r]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

function toCsv(rows: CollectedVacancyUrl[]): string {
  return [
    CSV_HEADER,
    ...rows.map((row) => [
      row.url,
      row.company_slug,
      row.company_name,
      row.source_name,
      row.note,
    ].map(csvEscape).join(",")),
  ].join("\n") + "\n";
}

async function collect(args: Args): Promise<CollectedVacancyUrl[]> {
  const pages = loadSourcePages(args.input);
  stats.sourcePagesRead = pages.length;

  const collected: CollectedVacancyUrl[] = [];
  const seen = new Map<string, CollectedVacancyUrl>();

  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    if (!page.html_file && index > 0 && args.delayMs > 0) await sleep(args.delayMs);

    const source = page.html_file ? readLocalHtml(page) : await fetchHtml(page.source_url, args.timeoutMs);
    if (page.html_file) stats.localHtmlPagesRead += source.html ? 1 : 0;
    else stats.sourcePagesFetched += 1;

    if (source.warning || !source.html) {
      const warning = {
        sourceUrl: page.source_url,
        companyName: page.company_name,
        sourceName: page.source_name,
        reason: source.warning ?? "empty HTML",
      };
      if (page.html_file && source.warning === "local HTML file not found") stats.missingHtmlFiles.push(warning);
      else if (!page.html_file && source.warning === "blocked or captcha-like response") stats.blockedPages.push(warning);
      else stats.warnings.push(warning);
      continue;
    }

    const urls = extractVacancyUrls(source.html, page);
    stats.urlsFoundRaw += urls.length;
    if (urls.length === 0) {
      stats.zeroUrlPages.push({
        sourceUrl: page.source_url,
        companyName: page.company_name,
        sourceName: page.source_name,
        reason: "0 vacancy URLs found in HTML",
      });
      continue;
    }

    for (const url of urls) {
      if (seen.has(url)) {
        stats.duplicateUrlsRemoved += 1;
        continue;
      }
      const row = {
        url,
        company_slug: page.company_slug,
        company_name: page.company_name,
        source_name: page.source_name,
        note: page.note,
      };
      seen.set(url, row);
      collected.push(row);
    }
  }

  return collected;
}

function printReport(args: Args, rows: CollectedVacancyUrl[]) {
  console.log("Vacancy URL collector report");
  console.log("source pages read:", stats.sourcePagesRead);
  console.log("fetched pages:", stats.sourcePagesFetched);
  console.log("local HTML pages read:", stats.localHtmlPagesRead);
  console.log("URLs found:", rows.length);
  console.log("raw URLs found:", stats.urlsFoundRaw);
  console.log("duplicates removed:", stats.duplicateUrlsRemoved);
  console.log("pages with 0 URLs:", stats.zeroUrlPages.length);
  console.log("blocked pages:", stats.blockedPages.length);
  console.log("missing html files:", stats.missingHtmlFiles.length);
  console.log("warnings:", stats.warnings.length + stats.zeroUrlPages.length + stats.blockedPages.length + stats.missingHtmlFiles.length);
  console.log("CSV output:", args.output);
  if (args.dryRun) console.log("dry run: CSV was not written");

  for (const warning of [...stats.warnings, ...stats.zeroUrlPages, ...stats.blockedPages, ...stats.missingHtmlFiles].slice(0, 50)) {
    console.warn(`${warning.sourceName || "unknown"} ${warning.companyName || "(no company)"} ${warning.sourceUrl || "(no url)"} -> ${warning.reason}`);
  }
}

export async function runCollectVacancyUrls(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const rows = await collect(args);
  printReport(args, rows);

  if (!args.dryRun) {
    writeFileSync(args.output, toCsv(rows), "utf8");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCollectVacancyUrls().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
