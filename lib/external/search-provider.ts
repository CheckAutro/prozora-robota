import { sourceNameFromUrl } from "./source-normalizer";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  sourceName: string;
}

export type ExternalSearchProvider = "none" | "brave" | "serpapi" | "google_cse" | "tavily";

export interface SearchProviderResponse {
  results: SearchResult[];
  warnings: string[];
}

const DISABLED_MESSAGE =
  "External search is disabled. Set EXTERNAL_SEARCH_ENABLED=true and EXTERNAL_SEARCH_API_KEY.";
const UNSUPPORTED_MESSAGE = "External search provider is unsupported.";
const TIMEOUT_MS = 8000;
const MAX_RESULTS = 10;

function cleanText(value: unknown, limit = 400): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, limit);
}

function normalizeUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (!["http:", "https:"].includes(url.protocol)) return null;
    url.hash = "";
    for (const param of Array.from(url.searchParams.keys())) {
      if (/^utm_/i.test(param) || /^(gclid|fbclid|yclid|mc_cid|mc_eid)$/i.test(param)) {
        url.searchParams.delete(param);
      }
    }
    return url.toString();
  } catch {
    return null;
  }
}

function resultFromItem(item: Record<string, unknown>): SearchResult | null {
  const url = cleanText(item.link ?? item.url ?? item.href ?? item.destination, 700);
  const normalizedUrl = normalizeUrl(url);
  if (!normalizedUrl) return null;

  const title = cleanText(item.title ?? item.name ?? item.heading, 220);
  const snippet = cleanText(
    item.snippet ?? item.description ?? item.text ?? item.content ?? item.body,
    420
  );
  if (!title && !snippet) return null;

  return {
    title: title || sourceNameFromUrl(normalizedUrl),
    url: normalizedUrl,
    snippet: snippet || title || normalizedUrl,
    sourceName: sourceNameFromUrl(normalizedUrl),
  };
}

function readArray(payload: unknown, path: string[]): unknown[] | null {
  let current: unknown = payload;
  for (const key of path) {
    if (!current || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[key];
  }
  return Array.isArray(current) ? current : null;
}

function parseResults(payload: unknown): SearchResult[] {
  const candidates = [
    readArray(payload, ["web", "results"]),
    readArray(payload, ["organic_results"]),
    readArray(payload, ["organic"]),
    readArray(payload, ["items"]),
    readArray(payload, ["results"]),
    readArray(payload, ["data", "results"]),
  ].find(Boolean) as unknown[] | undefined;

  if (!candidates) return [];

  const results: SearchResult[] = [];
  for (const candidate of candidates.slice(0, MAX_RESULTS * 2)) {
    if (!candidate || typeof candidate !== "object") continue;
    const result = resultFromItem(candidate as Record<string, unknown>);
    if (!result) continue;
    results.push(result);
    if (results.length >= MAX_RESULTS) break;
  }
  return results;
}

function providerFromEnv(): ExternalSearchProvider {
  const provider = String(process.env.EXTERNAL_SEARCH_PROVIDER ?? "none").toLowerCase();
  return provider === "brave" || provider === "serpapi" || provider === "google_cse" || provider === "tavily"
    ? provider
    : "none";
}

function isEnabled(): boolean {
  return String(process.env.EXTERNAL_SEARCH_ENABLED ?? "").toLowerCase() === "true";
}

function headersForProvider(provider: ExternalSearchProvider, apiKey: string): HeadersInit {
  if (provider === "brave") {
    return {
      accept: "application/json",
      "x-subscription-token": apiKey,
      "user-agent": "WorkRadar external search (+https://prozora-robota.vercel.app)",
    };
  }
  if (provider === "tavily") {
    return {
      accept: "application/json",
      "content-type": "application/json",
      "user-agent": "WorkRadar external search (+https://prozora-robota.vercel.app)",
    };
  }
  return {
    accept: "application/json",
    "user-agent": "WorkRadar external search (+https://prozora-robota.vercel.app)",
  };
}

function buildProviderUrl(provider: ExternalSearchProvider, query: string, apiKey: string, cx: string): string | null {
  const encodedQuery = encodeURIComponent(query);
  if (provider === "brave") {
    return `https://api.search.brave.com/res/v1/web/search?q=${encodedQuery}&count=${MAX_RESULTS}&country=ua&search_lang=uk&result_filter=web`;
  }
  if (provider === "serpapi") {
    return `https://serpapi.com/search.json?engine=google&q=${encodedQuery}&num=${MAX_RESULTS}&hl=uk&gl=ua&api_key=${encodeURIComponent(apiKey)}`;
  }
  if (provider === "google_cse") {
    if (!cx) return null;
    return `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(apiKey)}&cx=${encodeURIComponent(cx)}&q=${encodedQuery}&num=${MAX_RESULTS}&hl=uk&gl=ua`;
  }
  if (provider === "tavily") {
    return "https://api.tavily.com/search";
  }
  return null;
}

function buildProviderBody(provider: ExternalSearchProvider, query: string, apiKey: string): string | undefined {
  if (provider !== "tavily") return undefined;
  return JSON.stringify({
    api_key: apiKey,
    query,
    search_depth: "basic",
    max_results: MAX_RESULTS,
    include_answer: false,
    include_raw_content: false,
    include_images: false,
  });
}

export async function searchExternalSources(query: string): Promise<SearchResult[]> {
  const { results } = await searchExternalSourcesWithWarnings(query);
  return results;
}

export async function searchExternalSourcesWithWarnings(query: string): Promise<SearchProviderResponse> {
  const warnings: string[] = [];
  const provider = providerFromEnv();
  const apiKey = process.env.EXTERNAL_SEARCH_API_KEY ?? "";
  const cx = process.env.EXTERNAL_SEARCH_CX ?? "";

  if (!isEnabled() || !apiKey || provider === "none") {
    return { results: [], warnings: [DISABLED_MESSAGE] };
  }

  const url = buildProviderUrl(provider, query, apiKey, cx);
  if (!url) {
    return { results: [], warnings: [UNSUPPORTED_MESSAGE] };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: provider === "tavily" ? "POST" : "GET",
      signal: controller.signal,
      headers: headersForProvider(provider, apiKey),
      body: buildProviderBody(provider, query, apiKey),
    });

    if (!response.ok) {
      warnings.push(`External search provider responded ${response.status}.`);
      return { results: [], warnings };
    }

    const payload = await response.json().catch(() => null);
    if (!payload) {
      warnings.push("External search provider returned empty payload.");
      return { results: [], warnings };
    }

    return { results: parseResults(payload), warnings };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    warnings.push(aborted ? "External search request timed out." : "External search request failed.");
    return { results: [], warnings };
  } finally {
    clearTimeout(timeout);
  }
}

export function externalSearchProviderName(): ExternalSearchProvider {
  return providerFromEnv();
}

export function externalSearchIsEnabled(): boolean {
  if (!isEnabled() || !process.env.EXTERNAL_SEARCH_API_KEY) return false;
  if (providerFromEnv() === "none") return false;
  if (providerFromEnv() === "google_cse" && !process.env.EXTERNAL_SEARCH_CX) return false;
  return true;
}

export function externalSearchDisabledMessage(): string {
  return DISABLED_MESSAGE;
}

export function normalizeSearchResultUrl(value: string): string | null {
  return normalizeUrl(value);
}
