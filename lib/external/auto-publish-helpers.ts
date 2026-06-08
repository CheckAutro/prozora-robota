import { normalizeExternalUrl, hostFromUrl } from "./source-normalizer";
import { upsertExternalCompanySource } from "./company-sources";
import type { ExternalSourceCandidate } from "@/lib/ai/types";
import type { ExternalCompanySourceType } from "@/lib/types";

export function normalizeSourceUrl(value: string): string | null {
  return normalizeExternalUrl(value, false);
}

export function isWorkOrRobotaSource(sourceName: string, sourceUrl?: string | null): boolean {
  const name = sourceName.toLowerCase();
  const host = hostFromUrl(sourceUrl ?? "");
  return (
    name.includes("work.ua") || name.includes("robota.ua") ||
    host.includes("work.ua") || host.includes("robota.ua")
  );
}

export function isTrustedReviewSource(sourceName: string, sourceUrl?: string | null): boolean {
  const host = hostFromUrl(sourceUrl ?? "");
  const name = sourceName.toLowerCase();
  return (
    host.includes("indeed.com") || host.includes("glassdoor.com") ||
    host.includes("dou.ua") || host.includes("djinni.co") ||
    name.includes("vidhuk") || name.includes("vnutri") ||
    name.includes("pravda-sotrudnikov")
  );
}

export function isSocialMediaSource(sourceName: string, sourceUrl?: string | null): boolean {
  const host = hostFromUrl(sourceUrl ?? "");
  const SOCIAL = [
    "facebook.com", "t.me", "telegram.org", "twitter.com", "x.com",
    "instagram.com", "tiktok.com", "reddit.com", "linkedin.com", "youtube.com",
    "vk.com", "ok.ru",
  ];
  return SOCIAL.some((s) => host === s || host.endsWith(`.${s}`));
}

export function sourceMatchesCompany(
  title: string | null,
  snippet: string | null,
  companyName: string
): boolean {
  const text = `${title ?? ""} ${snippet ?? ""}`.toLowerCase();
  const name = companyName.toLowerCase().trim();
  if (!name) return true;
  if (text.includes(name)) return true;
  return name.split(/\s+/).filter((w) => w.length > 3).some((word) => text.includes(word));
}

export function classifyExternalSource(signalType: string): ExternalCompanySourceType {
  if (signalType === "review") return "reviews";
  if (signalType === "rating") return "rating";
  if (signalType === "vacancy") return "vacancy";
  if (signalType === "company_page") return "company_page";
  if (signalType === "discussion") return "article";
  return "other";
}

export function truncateSourceExcerpt(value: string | null | undefined, limit = 800): string {
  if (!value) return "";
  return value.replace(/\s+/g, " ").trim().slice(0, limit);
}

export function canAutoPublishExternalSource(params: {
  sourceUrl: string | null;
  sourceName: string | null;
  title: string | null;
  snippet: string | null;
  shortSummary: string;
  sourceType: string;
  confidence: string;
  companyName: string;
}): { canPublish: boolean; reason?: string } {
  if (!params.sourceUrl) return { canPublish: false, reason: "no_url" };
  if (!params.sourceName) return { canPublish: false, reason: "no_source_name" };
  if (!["reviews", "rating", "article", "company_page", "vacancy"].includes(params.sourceType)) {
    return { canPublish: false, reason: `unsupported_type:${params.sourceType}` };
  }
  if (params.shortSummary.length > 800) return { canPublish: false, reason: "summary_too_long" };
  if (isSocialMediaSource(params.sourceName, params.sourceUrl)) {
    return { canPublish: false, reason: "social_media" };
  }
  if (!["high", "medium"].includes(params.confidence)) {
    return { canPublish: false, reason: `low_confidence` };
  }
  if (!sourceMatchesCompany(params.title, params.snippet, params.companyName)) {
    return { canPublish: false, reason: "no_company_match" };
  }
  return { canPublish: true };
}

function guardSourceTypeForWorkRobota(
  sourceName: string,
  sourceUrl: string,
  signalType: string
): ExternalCompanySourceType {
  if (isWorkOrRobotaSource(sourceName, sourceUrl)) {
    // Work.ua / Robota.ua must always be vacancy or company_page — never reviews/rating
    if (signalType === "review" || signalType === "rating") {
      return /\/jobs\/\d+|vacancy|ваканс/i.test(sourceUrl) ? "vacancy" : "company_page";
    }
  }
  return classifyExternalSource(signalType);
}

export async function autoPublishSafeDiscoverySources(input: {
  companySlug: string;
  companyName: string;
  sources: ExternalSourceCandidate[];
}): Promise<number> {
  if (!input.companySlug || !input.companyName || input.sources.length === 0) return 0;

  let published = 0;
  const processedUrls = new Set<string>();

  for (const source of input.sources) {
    // Skip internal/Прозора робота entries
    if (source.source_name === "Прозора робота") continue;
    if (!source.source_url) continue;

    const normalizedUrl = normalizeSourceUrl(source.source_url);
    if (!normalizedUrl) continue;

    // Deduplicate by normalized URL within this batch
    if (processedUrls.has(normalizedUrl)) continue;
    processedUrls.add(normalizedUrl);

    const sourceType = guardSourceTypeForWorkRobota(
      source.source_name,
      source.source_url,
      source.signal_type
    );
    const shortSummary = truncateSourceExcerpt(source.snippet, 800);
    const language = source.source_language ?? "unknown";

    const { canPublish } = canAutoPublishExternalSource({
      sourceUrl: normalizedUrl,
      sourceName: source.source_name,
      title: source.title,
      snippet: source.snippet,
      shortSummary,
      sourceType,
      confidence: source.confidence,
      companyName: input.companyName,
    });

    if (!canPublish) continue;

    const result = await upsertExternalCompanySource({
      company_slug: input.companySlug,
      company_name: input.companyName,
      source_name: source.source_name,
      source_url: normalizedUrl,
      source_type: sourceType,
      title: source.title || null,
      short_summary: shortSummary || `Зовнішнє джерело про ${input.companyName}.`,
      confidence: source.confidence,
      status: "verified",
      is_public: true,
      source_excerpt: truncateSourceExcerpt(source.snippet, 800),
      collected_at: new Date().toISOString(),
      admin_note: `Auto-published from external discovery. Original language: ${language}`,
    });

    if (result.ok && result.created) {
      published++;
    }
  }

  return published;
}
