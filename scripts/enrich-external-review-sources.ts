import { loadEnvConfig } from "@next/env";
import { getServiceClient } from "@/lib/supabase/server";
import {
  isGenericExternalSummary,
  getExternalReviewSourceQuality,
  GENERIC_SUMMARY_FALLBACK,
  type ExternalReviewQuality,
} from "@/lib/external/external-review-quality";
import { isWorkOrRobotaSource } from "@/lib/external/auto-publish-helpers";
import { runEmployerAiAnalysisPrompt } from "@/lib/ai/ai-provider";
import { rowToExternalCompanySource } from "@/lib/external/company-sources";
import { readExternalSourceUrl } from "@/lib/external/source-fetcher";
import type { ExternalCompanySource } from "@/lib/types";

loadEnvConfig(process.cwd());

// ── Arg parsing ────────────────────────────────────────────────────────────────

interface Args {
  apply: boolean;
  limit: number;
  company: string | null;
  onlyGeneric: boolean;
  minQuality: "generic" | "partial";
  fetch: boolean; // default true — fetch public pages for richer extraction
}

function parseArgs(argv: string[]): Args {
  let apply = false;
  let limit = 5;
  let company: string | null = null;
  let onlyGeneric = true;
  let minQuality: "generic" | "partial" = "generic";
  let fetch = true;

  for (const arg of argv) {
    if (arg === "--apply") apply = true;
    else if (arg === "--all") onlyGeneric = false;
    else if (arg === "--no-fetch") fetch = false;
    else if (arg.startsWith("--limit=")) {
      const n = parseInt(arg.slice("--limit=".length), 10);
      if (Number.isFinite(n) && n > 0) limit = Math.min(200, n);
    } else if (arg.startsWith("--company=")) {
      company = arg.slice("--company=".length).trim() || null;
    } else if (arg.startsWith("--min-quality=")) {
      const val = arg.slice("--min-quality=".length).trim();
      if (val === "partial" || val === "generic") minQuality = val;
    }
  }

  return { apply, limit, company, onlyGeneric, minQuality, fetch };
}

// ── Safe page fetch ────────────────────────────────────────────────────────────

// Domains that require login, are social media, or won't return useful plain text
const SKIP_FETCH_DOMAINS = [
  "facebook.com", "instagram.com", "twitter.com", "x.com", "t.me", "telegram.me",
  "linkedin.com", "tiktok.com", "youtube.com", "vk.com", "ok.ru",
  "google.com", "apple.com", "microsoft.com",
  // Job boards that block or require JS rendering
  "hh.ua", "hh.ru", "indeed.com",
];

// Ukrainian-specific work-condition keywords for relevance windowing
const WORK_KEYWORDS = [
  "зарплат", "оплат", "графік", "керівн", "колектив", "оформл", "бонус",
  "навантаж", "затримк", "співбесід", "кар'єр", "штраф", "понаднормов",
  "стажуванн", "відгук", "відгуки", "відгуків", "review", "salary",
  "working condition", "работодател", "условия работы",
];

function shouldSkipFetch(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return SKIP_FETCH_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return true;
  }
}

function extractRelevantText(text: string, maxChars = 10000): string {
  const WINDOW = 400;
  const lower = text.toLowerCase();
  const segments: Array<[number, number]> = [];

  for (const kw of WORK_KEYWORDS) {
    let idx = lower.indexOf(kw);
    while (idx !== -1 && idx < text.length) {
      const start = Math.max(0, idx - WINDOW);
      const end = Math.min(text.length, idx + kw.length + WINDOW);
      segments.push([start, end]);
      idx = lower.indexOf(kw, idx + kw.length + 1);
    }
  }

  if (segments.length === 0) return text.slice(0, maxChars);

  // Merge overlapping / nearby segments
  segments.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  let [cs, ce] = segments[0]!;
  for (const [s, e] of segments.slice(1)) {
    if (s <= ce + 80) {
      ce = Math.max(ce, e);
    } else {
      merged.push([cs, ce]);
      [cs, ce] = [s, e];
    }
  }
  merged.push([cs, ce]);

  const parts: string[] = [];
  let total = 0;
  for (const [s, e] of merged) {
    if (total >= maxChars) break;
    const chunk = text.slice(s, e).replace(/\s+/g, " ").trim();
    if (chunk.length < 10) continue;
    parts.push(chunk);
    total += chunk.length + 4;
  }

  return parts.join(" … ").slice(0, maxChars);
}

interface PageFetchResult {
  text: string;
  fetchStatus: "success" | "blocked" | "timeout" | "failed" | "unsupported" | "skipped";
  chars: number;
}

async function fetchPageText(url: string): Promise<PageFetchResult> {
  if (!url || shouldSkipFetch(url)) {
    return { text: "", fetchStatus: "skipped", chars: 0 };
  }

  const result = await readExternalSourceUrl(url, {
    timeoutMs: 8000,
    maxBytes: 300 * 1024,
    allowAnyPublicHost: true,
  });

  if (result.status !== "success" || !result.text) {
    return { text: "", fetchStatus: result.status, chars: 0 };
  }

  const relevant = extractRelevantText(result.text, 10000);
  return { text: relevant, fetchStatus: "success", chars: relevant.length };
}

// ── Enrichment result ──────────────────────────────────────────────────────────

interface EnrichResult {
  shortSummary: string;
  positivePoints: string[];
  negativePoints: string[];
  neutralFacts: string[];
  quality: ExternalReviewQuality;
  topics: string[];
  method: "ai" | "heuristic" | "skip";
  skipReason?: string;
  fetchStatus?: string;
  fetchedChars?: number;
}

// ── Enhanced heuristics ────────────────────────────────────────────────────────

function cleanBullet(text: string, limit = 200): string {
  return text.replace(/\s+/g, " ").trim().slice(0, limit);
}

function extractHeuristic(source: ExternalCompanySource, textOverride?: string): EnrichResult {
  const raw = textOverride ?? `${source.shortSummary} ${source.sourceExcerpt ?? ""}`;
  const text = raw.toLowerCase();

  const positivePoints: string[] = [];
  const negativePoints: string[] = [];
  const neutralFacts: string[] = [];
  const topics: string[] = [];

  // Rating with number (e.g. "3.2/5", "4.1 з 5", "3.8 out of 5")
  const ratingMatch = text.match(/(\d+[.,]\d*)\s*(?:\/|з|out of)\s*(\d+)/);
  if (ratingMatch) {
    const rating = Number(ratingMatch[1].replace(",", "."));
    const scale = Number(ratingMatch[2]);
    if (Number.isFinite(rating) && Number.isFinite(scale) && scale > 0 && rating <= scale) {
      neutralFacts.push(cleanBullet(`Оцінка у джерелі: ${rating}/${scale}.`));
    }
  }

  // Review count (e.g. "847 відгуків", "1200 reviews")
  const countMatch = text.match(/(\d[\d\s]{0,6})\s+(?:відгук|відгуки|відгуків|reviews?|оцінок)/i);
  if (countMatch) {
    const count = parseInt(countMatch[1].replace(/\s+/g, ""), 10);
    if (Number.isFinite(count) && count > 0 && count < 999999) {
      neutralFacts.push(cleanBullet(`У джерелі ${count.toLocaleString("uk-UA")} відгуків.`));
    }
  }

  // Payment delays
  if (/затримк[аи]|не платять|борг зарплат|невиплат/.test(text)) {
    negativePoints.push("Є згадки про затримки або проблеми з виплатами.");
    topics.push("затримки виплат");
  }

  // Fines / штрафи
  if (/штраф/.test(text)) {
    negativePoints.push("Є згадки про штрафні санкції.");
    topics.push("штрафи");
  }

  // Salary — positive signals
  if (/стабільн.*зарплат|своєчасн.*виплат|вчасно виплачу|salary.*stable/.test(text)) {
    positivePoints.push("Є позитивні згадки про стабільну виплату зарплати.");
    topics.push("зарплата");
  }

  // Salary — amount
  const salaryAmountMatch = raw.match(/(\d{4,6})\s*(?:грн|₴)/i);
  if (salaryAmountMatch && !topics.includes("зарплата")) {
    neutralFacts.push(cleanBullet(`Згадується зарплата: ${salaryAmountMatch[1]} грн.`));
    topics.push("зарплата");
  } else if (/зарплат|оплат|salary|ставк|оклад/.test(text) && !topics.includes("зарплата")) {
    topics.push("зарплата");
  }

  // Schedule
  if (/5\/2/.test(text)) {
    neutralFacts.push("Є згадка про графік 5/2.");
    topics.push("графік");
  } else if (/позмін|нічн.*зміна|добов.*графік|2\/2/.test(text)) {
    neutralFacts.push("Є згадка про позмінний або нічний графік.");
    topics.push("графік");
  }

  // Official employment
  if (/офіційн.*оформл|трудов[аи].*договір|КЗпП|ТК|белая зарплата/.test(text)) {
    positivePoints.push("Є згадка про офіційне оформлення.");
    topics.push("оформлення");
  }

  // Management issues
  if (/проблем.*керівн|конфлікт.*начальств|токсич.*менеджм/.test(text)) {
    negativePoints.push("Є згадки про проблеми з керівництвом.");
    topics.push("керівництво");
  } else if (/керівн|начальств|менеджмент/.test(text)) {
    topics.push("керівництво");
  }

  // Workload
  if (/понаднормов|перевантаженн|переробки|overtime/.test(text)) {
    negativePoints.push("Є згадки про понаднормове навантаження.");
    topics.push("навантаження");
  }

  // Team / collective
  if (/хорош.*команд|дружн.*колектив|приємн.*команд/.test(text)) {
    positivePoints.push("Є позитивні згадки про команду або колектив.");
    topics.push("колектив");
  } else if (/команда|колектив/.test(text)) {
    topics.push("колектив");
  }

  // Interview
  if (/співбесід|interview/.test(text)) {
    topics.push("співбесіда");
  }

  // Booking / бронювання
  if (/брон[юь]ванн|відстрочк/.test(text)) {
    neutralFacts.push("Є згадка про бронювання або відстрочку.");
    topics.push("бронювання");
  }

  // Career
  if (/кар.єр|підвищенн|career/.test(text)) {
    topics.push("кар'єра");
  }

  // Determine quality
  const allBullets = [...positivePoints, ...negativePoints, ...neutralFacts];
  const uniqueTopics = Array.from(new Set(topics));

  let quality: ExternalReviewQuality;
  if (allBullets.length >= 2 || uniqueTopics.length >= 2) quality = "specific";
  else if (allBullets.length >= 1 || uniqueTopics.length >= 1) quality = "partial";
  else quality = "generic";

  let shortSummary: string;
  if (quality === "generic") {
    shortSummary = GENERIC_SUMMARY_FALLBACK;
  } else {
    const parts = [
      positivePoints[0] ?? null,
      negativePoints[0] ?? null,
      neutralFacts[0] ?? null,
    ].filter(Boolean);
    shortSummary = cleanBullet(parts.slice(0, 2).join(" ") || allBullets[0] || GENERIC_SUMMARY_FALLBACK, 400);
  }

  return {
    shortSummary,
    positivePoints: positivePoints.slice(0, 4),
    negativePoints: negativePoints.slice(0, 4),
    neutralFacts: neutralFacts.slice(0, 5),
    quality,
    topics: uniqueTopics,
    method: "heuristic",
  };
}

// ── AI enrichment ──────────────────────────────────────────────────────────────

function buildAiSystemPrompt(): string {
  return [
    "You analyze Ukrainian employer source excerpts.",
    "Extract concrete work condition signals.",
    "Return valid JSON only. No markdown. No invented facts.",
    "All output text must be in Ukrainian (translate if needed).",
    "Never invent salary amounts, counts, or ratings that are not in the input.",
  ].join(" ");
}

function buildAiUserPrompt(source: ExternalCompanySource, textForAnalysis: string): string {
  return JSON.stringify({
    task: "extract_work_signals",
    company_name: source.companyName,
    source_name: source.sourceName,
    source_text: textForAnalysis,
    output_schema: {
      short_summary_uk: "1-2 sentence Ukrainian summary (max 400 chars)",
      positive_bullets: "max 3 concrete positives in Ukrainian, max 180 chars each",
      risk_bullets: "max 3 concrete risks/complaints in Ukrainian, max 180 chars each",
      neutral_bullets: "max 3 factual mentions (ratings, counts, schedule) in Ukrainian, max 180 chars each",
      topics: "array of matching topics from: зарплата, оформлення, графік, затримки виплат, керівництво, колектив, навантаження, штрафи, бронювання, кар'єра, співбесіда",
      quality: "specific|partial|generic",
    },
    rules: [
      "specific = has 2+ concrete topics OR one strong signal with real details",
      "partial = has 1 concrete topic or one factual mention",
      "generic = no concrete data about work conditions",
      "If no concrete data: set quality='generic', empty arrays, short_summary_uk='Джерело містить сторінку з відгуками або згадками про роботу в компанії, але без достатньо конкретного узагальнення. Деталі варто перевірити за посиланням.'",
      "If source text is Russian or English: translate bullets to Ukrainian",
      "Include actual numbers (ratings, review counts, salary amounts) if present in input",
      "Do NOT invent any data not present in source_text",
    ],
  });
}

function coerceAiResult(raw: unknown): EnrichResult | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const shortSummary = typeof r.short_summary_uk === "string" && r.short_summary_uk.trim()
    ? r.short_summary_uk.trim().slice(0, 500)
    : GENERIC_SUMMARY_FALLBACK;

  function toStringArray(value: unknown, limit = 4): string[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => typeof item === "string" ? item.trim().slice(0, 200) : "")
      .filter(Boolean)
      .slice(0, limit);
  }

  const positivePoints = toStringArray(r.positive_bullets);
  const negativePoints = toStringArray(r.risk_bullets);
  const neutralFacts = toStringArray(r.neutral_bullets, 5);
  const topics = toStringArray(r.topics, 12);

  const rawQuality = String(r.quality ?? "").toLowerCase();
  const quality: ExternalReviewQuality =
    rawQuality === "specific" ? "specific"
    : rawQuality === "partial" ? "partial"
    : "generic";

  return {
    shortSummary,
    positivePoints,
    negativePoints,
    neutralFacts,
    quality,
    topics,
    method: "ai",
  };
}

async function enrichWithAi(source: ExternalCompanySource, textForAnalysis: string): Promise<EnrichResult | null> {
  if (!textForAnalysis || textForAnalysis.trim().length < 20) return null;

  try {
    const raw = await runEmployerAiAnalysisPrompt({
      systemPrompt: buildAiSystemPrompt(),
      userPrompt: buildAiUserPrompt(source, textForAnalysis),
      schemaName: "external_source_enrichment_v1",
    });
    return coerceAiResult(raw);
  } catch {
    return null;
  }
}

// ── Main enrichment logic ──────────────────────────────────────────────────────

async function enrichSource(
  source: ExternalCompanySource,
  useAi: boolean,
  pageFetch: boolean,
): Promise<EnrichResult> {
  const excerptText = source.sourceExcerpt ?? "";

  // Attempt to fetch the real page for richer extraction
  let fetchedChars = 0;
  let fetchStatus: string | undefined;
  let pageText = "";

  if (pageFetch && source.sourceUrl) {
    const fetchResult = await fetchPageText(source.sourceUrl);
    fetchStatus = fetchResult.fetchStatus;
    fetchedChars = fetchResult.chars;
    pageText = fetchResult.text;
  }

  // Combine: prioritise fetched page, fall back to excerpt
  const textForAnalysis = pageText
    ? `${pageText}\n\n[snippet]: ${excerptText}`.slice(0, 12000)
    : excerptText;

  // Skip if there's genuinely nothing to work with
  if (!textForAnalysis.trim() && isGenericExternalSummary(source)) {
    return {
      shortSummary: GENERIC_SUMMARY_FALLBACK,
      positivePoints: [],
      negativePoints: [],
      neutralFacts: [],
      quality: "generic",
      topics: [],
      method: "skip",
      skipReason: "no page text, no source_excerpt, no useful existing content",
      fetchStatus,
      fetchedChars,
    };
  }

  // Try AI first if available
  if (useAi) {
    const aiResult = await enrichWithAi(source, textForAnalysis);
    if (aiResult) return { ...aiResult, fetchStatus, fetchedChars };
  }

  // Fallback: enhanced heuristics on combined text
  const hResult = extractHeuristic(source, textForAnalysis);
  return { ...hResult, fetchStatus, fetchedChars };
}

// ── DB update ──────────────────────────────────────────────────────────────────

async function updateSourceSummary(
  id: string,
  result: EnrichResult
): Promise<{ ok: boolean; error?: string }> {
  try {
    const client = getServiceClient();
    const { error } = await client
      .from("external_company_sources")
      .update({
        short_summary: result.shortSummary,
        positive_points: result.positivePoints,
        negative_points: result.negativePoints,
        neutral_facts: result.neutralFacts,
      })
      .eq("id", id);

    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ── Format helpers ─────────────────────────────────────────────────────────────

function qualityIcon(q: ExternalReviewQuality): string {
  return q === "specific" ? "✓ specific" : q === "partial" ? "~ partial" : "✗ generic";
}

function truncate(text: string, limit = 100): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > limit ? `${clean.slice(0, limit - 1)}…` : clean;
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const client = getServiceClient();

  const aiEnabled = Boolean(
    process.env.AI_PROVIDER && (process.env.AI_API_KEY || process.env.OPENAI_API_KEY) && process.env.AI_API_URL
  );

  console.log("=".repeat(64));
  console.log("External Review Source Enrichment");
  console.log("=".repeat(64));
  console.log(`Mode        : ${args.apply ? "APPLY — writes to DB" : "DRY RUN — no writes (pass --apply to write)"}`);
  console.log(`Target      : ${args.onlyGeneric ? "generic sources only (use --all to include partial)" : "all review sources"}`);
  console.log(`Min quality : ${args.minQuality}`);
  console.log(`Limit       : ${args.limit}`);
  if (args.company) console.log(`Company     : ${args.company}`);
  console.log(`AI          : ${aiEnabled ? "enabled" : "disabled (fallback to heuristics)"}`);
  console.log(`Page fetch  : ${args.fetch ? "enabled (pass --no-fetch to skip)" : "disabled"}`);
  console.log("=".repeat(64));

  // Build query
  let query = client
    .from("external_company_sources")
    .select([
      "id", "company_slug", "company_name", "source_name", "source_url", "source_type",
      "title", "short_summary", "positive_points", "negative_points", "neutral_facts",
      "rating_value", "rating_scale", "reviews_count", "confidence", "status", "is_public",
      "source_excerpt", "collected_at", "admin_note", "created_at", "updated_at",
    ].join(", "))
    .eq("source_type", "reviews")
    .eq("status", "verified")
    .eq("is_public", true)
    .order("company_slug")
    .limit(2000); // load all, apply limit after quality filter

  if (args.company) {
    query = query.eq("company_slug", args.company);
  }

  const { data: rows, error } = await query;
  if (error) {
    console.error("Failed to load sources:", error.message);
    process.exitCode = 1;
    return;
  }

  // Map rows to typed objects
  const allSources = ((rows ?? []) as unknown as Record<string, unknown>[]).map(
    (row) => rowToExternalCompanySource(row)
  );

  // Exclude Work.ua / Robota.ua
  const nonWorkRobota = allSources.filter(
    (s) => !isWorkOrRobotaSource(s.sourceName, s.sourceUrl)
  );

  // Filter by quality if --only-generic (default)
  let targets: ExternalCompanySource[];
  if (args.onlyGeneric || args.minQuality === "generic") {
    targets = nonWorkRobota.filter((s) => isGenericExternalSummary(s));
  } else {
    targets = nonWorkRobota.filter((s) => {
      const q = getExternalReviewSourceQuality(s).quality;
      return q === "generic" || (args.minQuality === "partial" && q === "partial");
    });
  }

  // Apply final limit
  targets = targets.slice(0, args.limit);

  console.log(`\nLoaded      : ${allSources.length} total review sources (verified+public)`);
  console.log(`Excluded    : ${allSources.length - nonWorkRobota.length} Work.ua/Robota.ua`);
  console.log(`Generic     : ${nonWorkRobota.filter((s) => isGenericExternalSummary(s)).length}`);
  console.log(`Processing  : ${targets.length} sources\n`);

  if (targets.length === 0) {
    console.log("Nothing to process. All review sources already have specific content.");
    return;
  }

  // Stats
  let improved = 0;
  let unchanged = 0;
  let skipped = 0;
  let errors = 0;
  let aiUsed = 0;
  let heuristicUsed = 0;
  let fetchSuccess = 0;
  let fetchFailed = 0;
  let fetchSkipped = 0;

  for (let i = 0; i < targets.length; i++) {
    const source = targets[i];
    if (!source) continue;

    const beforeQuality = getExternalReviewSourceQuality(source);
    console.log(`\n[${i + 1}/${targets.length}] ${source.companySlug} / ${source.sourceName}`);
    if (source.sourceUrl) console.log(`  URL     : ${source.sourceUrl}`);
    console.log(`  Before  : ${qualityIcon(beforeQuality.quality)}`);
    console.log(`  Summary : ${truncate(source.shortSummary, 120)}`);
    if (source.sourceExcerpt) {
      console.log(`  Excerpt : ${truncate(source.sourceExcerpt, 120)}`);
    }

    const result = await enrichSource(source, aiEnabled, args.fetch);

    // Track fetch stats
    if (result.fetchStatus === "success") { fetchSuccess++; }
    else if (result.fetchStatus === "skipped" || result.fetchStatus === undefined) { fetchSkipped++; }
    else { fetchFailed++; }

    if (args.fetch && source.sourceUrl) {
      const fetchLabel = result.fetchStatus === "success"
        ? `success (${result.fetchedChars ?? 0} chars)`
        : result.fetchStatus ?? "skipped";
      console.log(`  Fetch   : ${fetchLabel}`);
    }

    if (result.method === "skip") {
      console.log(`  Result  : SKIP — ${result.skipReason}`);
      skipped++;
      continue;
    }

    if (result.method === "ai") aiUsed++;
    else heuristicUsed++;

    const qualityChanged = result.quality !== beforeQuality.quality;
    const summaryChanged = result.shortSummary !== source.shortSummary;

    console.log(`  Method  : ${result.method}`);
    console.log(`  After   : ${qualityIcon(result.quality)}`);
    if (result.topics.length > 0) {
      console.log(`  Topics  : ${result.topics.join(", ")}`);
    }
    if (summaryChanged) {
      console.log(`  Summary → ${truncate(result.shortSummary, 120)}`);
    }
    if (result.positivePoints.length > 0) {
      console.log(`  Positiv : ${result.positivePoints.slice(0, 2).map((p) => truncate(p, 80)).join(" | ")}`);
    }
    if (result.negativePoints.length > 0) {
      console.log(`  Risks   : ${result.negativePoints.slice(0, 2).map((p) => truncate(p, 80)).join(" | ")}`);
    }
    if (result.neutralFacts.length > 0) {
      console.log(`  Facts   : ${result.neutralFacts.slice(0, 2).map((p) => truncate(p, 80)).join(" | ")}`);
    }

    if (!qualityChanged && !summaryChanged && result.positivePoints.length === 0
        && result.negativePoints.length === 0 && result.neutralFacts.length === 0) {
      console.log(`  → No improvement. Skipping update.`);
      unchanged++;
      continue;
    }

    if (args.apply) {
      const updateResult = await updateSourceSummary(source.id, result);
      if (updateResult.ok) {
        improved++;
        console.log(`  → UPDATED in DB`);
      } else {
        errors++;
        console.log(`  → ERROR: ${updateResult.error}`);
      }
    } else {
      improved++;
      console.log(`  → (dry-run — would update)`);
    }
  }

  console.log("\n" + "=".repeat(64));
  console.log("SUMMARY");
  console.log("=".repeat(64));
  console.log(`Processed   : ${targets.length}`);
  console.log(`Improved    : ${improved}`);
  console.log(`Unchanged   : ${unchanged}`);
  console.log(`Skipped     : ${skipped}`);
  console.log(`Errors      : ${errors}`);
  console.log(`AI used     : ${aiUsed}`);
  console.log(`Heuristic   : ${heuristicUsed}`);
  if (args.fetch) {
    console.log(`Fetch ok    : ${fetchSuccess}`);
    console.log(`Fetch fail  : ${fetchFailed}`);
    console.log(`Fetch skip  : ${fetchSkipped}`);
  }
  if (!args.apply && improved > 0) {
    console.log("\n(DRY RUN — no rows written. Re-run with --apply to write.)");
  }

  console.log("\n" + "=".repeat(64));
  console.log("SAFETY");
  console.log("=".repeat(64));
  console.log("public.reviews writes              : 0");
  console.log("internal rating mutations          : 0");
  console.log("internal review count mutations    : 0");
  console.log("source_url / source_name / type    : unchanged");
  console.log("status / is_public                 : unchanged");
  console.log("Work.ua / Robota.ua                : excluded (0 processed)");
  console.log("Only updated fields                : short_summary, positive_points, negative_points, neutral_facts");
}

main().catch((err) => {
  console.error("[enrich-external-review-sources] fatal:", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
