/**
 * Evidence quality assessment + targeted enrichment for external_company_sources.
 *
 * Usage:
 *   npx tsx scripts/enrich-external-evidence.ts               # dry-run, show evidence audit
 *   npx tsx scripts/enrich-external-evidence.ts --apply        # write improved summaries to DB
 *   npx tsx scripts/enrich-external-evidence.ts --company=slug # single company
 *   npx tsx scripts/enrich-external-evidence.ts --limit=20     # cap targets
 *   npx tsx scripts/enrich-external-evidence.ts --no-fetch     # skip URL fetch (faster)
 *   npx tsx scripts/enrich-external-evidence.ts --all-types    # include non-review sources
 *   npx tsx scripts/enrich-external-evidence.ts --include-useful # show already-useful sources too
 *
 * Safety guarantees (enforced, not configurable):
 *   - NEVER touches public.reviews
 *   - NEVER mutates internal review count or rating
 *   - NEVER turns Work.ua / Robota.ua into reviews
 *   - NEVER modifies source_url, source_name, source_type, status, is_public
 *   - Only writes: short_summary, positive_points, negative_points, neutral_facts
 */

import { loadEnvConfig } from "@next/env";
import { getServiceClient } from "@/lib/supabase/server";
import { rowToExternalCompanySource } from "@/lib/external/company-sources";
import { extractEvidenceFromSource } from "@/lib/external/evidence-extractor";
import { isWorkOrRobotaSource } from "@/lib/external/auto-publish-helpers";
import {
  isGenericExternalSummary,
  getExternalReviewSourceQuality,
  GENERIC_SUMMARY_FALLBACK,
  type ExternalReviewQuality,
} from "@/lib/external/external-review-quality";
import { readExternalSourceUrl } from "@/lib/external/source-fetcher";
import { runEmployerAiAnalysisPrompt } from "@/lib/ai/ai-provider";
import type { ExternalCompanySource } from "@/lib/types";
import type { SourceEvidenceData } from "@/lib/external/evidence-types";
import { checkEmployeeRelevance, logRelevanceResult } from "@/lib/evidence/employee-relevance";

loadEnvConfig(process.cwd(), true);

// ── Args ─────────────────────────────────────────────────────────────────────

interface Args {
  apply: boolean;
  limit: number;
  company: string | null;
  onlyGeneric: boolean;
  allTypes: boolean;
  includeUseful: boolean;
  fetch: boolean;
}

function parseArgs(argv: string[]): Args {
  let apply = false;
  let limit = 10;
  let company: string | null = null;
  let onlyGeneric = true;
  let allTypes = false;
  let includeUseful = false;
  let fetch = true;

  for (const arg of argv) {
    if (arg === "--apply") apply = true;
    else if (arg === "--all") onlyGeneric = false;
    else if (arg === "--all-types") allTypes = true;
    else if (arg === "--include-useful") includeUseful = true;
    else if (arg === "--no-fetch") fetch = false;
    else if (arg.startsWith("--limit=")) {
      const n = parseInt(arg.slice("--limit=".length), 10);
      if (Number.isFinite(n) && n > 0) limit = Math.min(500, n);
    } else if (arg.startsWith("--company=")) {
      company = arg.slice("--company=".length).trim() || null;
    }
  }

  return { apply, limit, company, onlyGeneric, allTypes, includeUseful, fetch };
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

const SKIP_FETCH_DOMAINS = [
  "facebook.com", "instagram.com", "twitter.com", "x.com", "t.me",
  "linkedin.com", "tiktok.com", "youtube.com", "vk.com", "ok.ru",
  "google.com", "hh.ua", "hh.ru", "indeed.com",
];

const WORK_KEYWORDS = [
  "зарплат", "оплат", "графік", "керівн", "колектив", "оформл", "бонус",
  "навантаж", "затримк", "співбесід", "кар'єр", "штраф", "понаднормов",
  "відгук", "відгуки", "відгуків", "review", "salary",
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
  const segments: [number, number][] = [];

  for (const kw of WORK_KEYWORDS) {
    let idx = lower.indexOf(kw);
    while (idx !== -1) {
      segments.push([Math.max(0, idx - WINDOW), Math.min(text.length, idx + kw.length + WINDOW)]);
      idx = lower.indexOf(kw, idx + kw.length + 1);
    }
  }

  if (segments.length === 0) return text.slice(0, maxChars);
  segments.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  let [cs, ce] = segments[0]!;
  for (const [s, e] of segments.slice(1)) {
    if (s <= ce + 80) { ce = Math.max(ce, e); }
    else { merged.push([cs, ce]); [cs, ce] = [s, e]; }
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

async function fetchPageText(url: string): Promise<{ text: string; status: string }> {
  if (!url || shouldSkipFetch(url)) return { text: "", status: "skipped" };
  const result = await readExternalSourceUrl(url, { timeoutMs: 8000, maxBytes: 300 * 1024, allowAnyPublicHost: true });
  if (result.status !== "success" || !result.text) return { text: "", status: result.status };
  return { text: extractRelevantText(result.text, 10000), status: "success" };
}

// ── AI enrichment ─────────────────────────────────────────────────────────────

function buildAiSystemPrompt(): string {
  return [
    "You analyze Ukrainian employer source excerpts.",
    "FIRST classify whether the text is about employees/employer (workplace, salary, working conditions, hiring) or about customers/consumers (bank services, product reviews, delivery, consumer complaints).",
    "Extract concrete work condition signals ONLY if the text is employee/employer relevant.",
    "Return valid JSON only. No markdown. No invented facts. All output text must be in Ukrainian.",
    "CRITICAL: If text is about customer complaints, bank products, delivery, product returns, ATMs, or consumer satisfaction — set is_employee_relevant=false and return empty arrays.",
    "CRITICAL: Do NOT convert customer/client complaints into employer working condition facts.",
  ].join(" ");
}

function buildAiUserPrompt(source: ExternalCompanySource, text: string): string {
  return JSON.stringify({
    task: "extract_work_signals",
    company_name: source.companyName,
    source_name: source.sourceName,
    source_text: text,
    output_schema: {
      is_employee_relevant: "boolean — true only if text is about working for this employer",
      relevance_confidence: "high|medium|low",
      evidence_category: "employee_review|employer_profile|vacancy|interview|salary|work_conditions|customer_complaint|consumer_review|product_service_review|unknown",
      relevance_reason: "string max 100 chars — why classified this way",
      short_summary_uk: "1-2 sentence Ukrainian summary (max 400 chars). Empty string if not employee relevant.",
      positive_bullets: "max 3 concrete positives in Ukrainian, max 180 chars each. Empty if not employee relevant.",
      risk_bullets: "max 3 concrete risks about WORKING CONDITIONS in Ukrainian, max 180 chars each. Empty if not employee relevant.",
      neutral_bullets: "max 3 factual mentions (ratings, counts, schedule) in Ukrainian, max 180 chars each. Empty if not employee relevant.",
      topics: "array from: зарплата, оформлення, графік, затримки виплат, керівництво, колектив, навантаження, штрафи, бронювання, кар'єра, співбесіда. Empty if not employee relevant.",
      quality: "specific|partial|generic",
    },
    rules: [
      "CRITICAL: is_employee_relevant=false for: bank client complaints, credit/deposit products, customer service issues, delivery to buyers, product returns, ATMs, consumer reviews.",
      "CRITICAL: is_employee_relevant=true only for: working conditions, salary/wages, hiring, team/management, schedule, official employment.",
      "NOT employee relevant: 'банк не повернув кошти клієнту', 'клієнти скаржаться на обслуговування', 'проблема з карткою'.",
      "EMPLOYEE relevant: 'працівники скаржаться на графік/зарплату/керівництво', 'зарплату затримують', 'умови роботи'.",
      "If is_employee_relevant=false: set quality='generic', all arrays empty, short_summary_uk=''.",
      "specific = 2+ concrete employee topics OR one strong signal with real details",
      "partial = 1 concrete employee topic or factual mention",
      "generic = no concrete data about working here",
      "Include actual numbers (ratings, counts, amounts) only if present in input",
      "Do NOT invent any data not in source_text",
      "If source text is Russian or English: translate bullets to Ukrainian",
    ],
  });
}

interface EnrichResult {
  shortSummary: string;
  positivePoints: string[];
  negativePoints: string[];
  neutralFacts: string[];
  quality: ExternalReviewQuality;
  method: "ai" | "skip";
  skipReason?: string;
  rejectedAsConsumer?: boolean;
}

async function runAiEnrichment(source: ExternalCompanySource, text: string): Promise<EnrichResult | null> {
  if (!text || text.trim().length < 20) return null;
  try {
    const raw = await runEmployerAiAnalysisPrompt({
      systemPrompt: buildAiSystemPrompt(),
      userPrompt: buildAiUserPrompt(source, text),
      schemaName: "external_evidence_enrichment_v1",
    });
    if (!raw || typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;

    // AI classified as not employee relevant
    if (r.is_employee_relevant === false && String(r.relevance_confidence ?? "") === "high") {
      console.log(`  [AI] REJECT: ${String(r.relevance_reason ?? "not employee relevant").slice(0, 100)}`);
      return { shortSummary: "", positivePoints: [], negativePoints: [], neutralFacts: [], quality: "generic", method: "ai", rejectedAsConsumer: true };
    }
    if (r.is_employee_relevant === false) {
      console.log(`  [AI] REVIEW: ${String(r.relevance_reason ?? "uncertain relevance").slice(0, 100)}`);
    } else {
      console.log(`  [AI] ACCEPT: ${String(r.evidence_category ?? "employee_review")} — ${String(r.relevance_reason ?? "").slice(0, 80)}`);
    }

    function toArr(v: unknown, n = 4): string[] {
      if (!Array.isArray(v)) return [];
      return v.map((x) => typeof x === "string" ? x.trim().slice(0, 200) : "").filter(Boolean).slice(0, n);
    }
    const positivePoints = toArr(r.positive_bullets);
    const negativePoints = toArr(r.risk_bullets);
    const neutralFacts = toArr(r.neutral_bullets, 5);
    const rawQ = String(r.quality ?? "").toLowerCase();
    const quality: ExternalReviewQuality = rawQ === "specific" ? "specific" : rawQ === "partial" ? "partial" : "generic";
    const shortSummary = typeof r.short_summary_uk === "string" && r.short_summary_uk.trim()
      ? r.short_summary_uk.trim().slice(0, 500)
      : GENERIC_SUMMARY_FALLBACK;
    return { shortSummary, positivePoints, negativePoints, neutralFacts, quality, method: "ai" };
  } catch {
    return null;
  }
}

// ── DB update ─────────────────────────────────────────────────────────────────

async function updateSourceSummary(id: string, result: EnrichResult): Promise<{ ok: boolean; error?: string }> {
  try {
    const { error } = await getServiceClient()
      .from("external_company_sources")
      .update({
        short_summary: result.shortSummary,
        positive_points: result.positivePoints,
        negative_points: result.negativePoints,
        neutral_facts: result.neutralFacts,
      })
      .eq("id", id);
    return error ? { ok: false, error: error.message } : { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ── Reporting helpers ─────────────────────────────────────────────────────────

function truncate(text: string, limit = 100): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > limit ? `${clean.slice(0, limit - 1)}…` : clean;
}

function evidenceStatusLabel(e: SourceEvidenceData): string {
  if (e.useful_for_analysis) return `✓ useful  (score ${e.usefulness_score})`;
  return `✗ useless (score ${e.usefulness_score}, status: ${e.extraction_status})`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const client = getServiceClient();

  const aiEnabled = Boolean(
    process.env.AI_PROVIDER && (process.env.AI_API_KEY || process.env.OPENAI_API_KEY) && process.env.AI_API_URL
  );

  console.log("=".repeat(64));
  console.log("External Evidence Quality Audit + Enrichment");
  console.log("=".repeat(64));
  console.log(`Mode        : ${args.apply ? "APPLY — writes to DB" : "DRY RUN (pass --apply to write)"}`);
  console.log(`Source types: ${args.allTypes ? "all" : "reviews only (use --all-types)"}`);
  console.log(`Target      : ${args.onlyGeneric ? "useless sources only" : "all sources"}`);
  console.log(`Limit       : ${args.limit}`);
  if (args.company) console.log(`Company     : ${args.company}`);
  console.log(`AI          : ${aiEnabled ? "enabled" : "disabled"}`);
  console.log(`Page fetch  : ${args.fetch ? "enabled" : "disabled (--no-fetch)"}`);
  console.log("=".repeat(64));

  let query = client
    .from("external_company_sources")
    .select([
      "id", "company_slug", "company_name", "source_name", "source_url", "source_type",
      "title", "short_summary", "positive_points", "negative_points", "neutral_facts",
      "rating_value", "rating_scale", "reviews_count", "confidence", "status", "is_public",
      "source_excerpt", "collected_at", "admin_note", "created_at", "updated_at",
    ].join(", "))
    .eq("status", "verified")
    .eq("is_public", true)
    .order("company_slug")
    .limit(2000);

  if (!args.allTypes) query = query.eq("source_type", "reviews");
  if (args.company) query = query.eq("company_slug", args.company);

  const { data: rows, error } = await query;
  if (error) {
    console.error("DB error:", error.message);
    process.exitCode = 1;
    return;
  }

  const allSources = ((rows ?? []) as unknown as Record<string, unknown>[]).map(rowToExternalCompanySource);
  const nonWorkRobota = allSources.filter((s) => !isWorkOrRobotaSource(s.sourceName, s.sourceUrl));

  // Pre-assess evidence quality for all sources
  const assessed = nonWorkRobota.map((src) => ({
    src,
    evidence: extractEvidenceFromSource(src),
    quality: getExternalReviewSourceQuality(src).quality,
  }));

  const usefulCount = assessed.filter(({ evidence }) => evidence.useful_for_analysis).length;
  const genericCount = assessed.filter(({ evidence }) => !evidence.useful_for_analysis).length;

  // Evidence quality breakdown
  const byCategory: Record<string, number> = {};
  for (const { evidence } of assessed) {
    for (const fact of evidence.extracted_facts) {
      byCategory[fact.category] = (byCategory[fact.category] ?? 0) + 1;
    }
  }

  // Companies with ZERO useful sources
  const companySlugs = [...new Set(assessed.map(({ src }) => src.companySlug))];
  const companiesWithNoUseful = companySlugs.filter((slug) =>
    assessed.filter(({ src }) => src.companySlug === slug).every(({ evidence }) => !evidence.useful_for_analysis)
  );

  console.log(`\n── Evidence Audit ──────────────────────────────────────`);
  console.log(`Loaded      : ${allSources.length} total verified+public sources`);
  console.log(`Excluded    : ${allSources.length - nonWorkRobota.length} Work.ua/Robota.ua`);
  console.log(`Useful      : ${usefulCount} (useful_for_analysis=true)`);
  console.log(`Useless     : ${genericCount} (no real evidence)`);
  console.log(`Companies with no useful sources: ${companiesWithNoUseful.length}`);
  if (Object.keys(byCategory).length > 0) {
    console.log(`\nFacts by category:`);
    const sorted = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
    for (const [cat, count] of sorted) {
      console.log(`  ${cat.padEnd(18)}: ${count}`);
    }
  }

  // Select targets: sources that need enrichment
  let targets = assessed.filter(({ evidence, src }) => {
    if (!evidence.useful_for_analysis) return true;
    if (args.includeUseful) return true;
    return false;
  });

  if (!args.allTypes) {
    targets = targets.filter(({ src }) => src.sourceType === "reviews");
  }

  targets = targets.slice(0, args.limit);

  console.log(`\nTargets     : ${targets.length} sources to process`);

  if (targets.length === 0) {
    console.log("\nAll sources already have useful evidence. Nothing to enrich.");
    return;
  }

  console.log("\n" + "─".repeat(64));

  let improved = 0;
  let unchanged = 0;
  let errors = 0;
  let aiUsed = 0;
  let fetchSuccess = 0;
  let fetchFailed = 0;

  for (let i = 0; i < targets.length; i++) {
    const { src: source, evidence: beforeEvidence } = targets[i]!;

    console.log(`\n[${i + 1}/${targets.length}] ${source.companySlug} / ${source.sourceName}`);
    if (source.sourceUrl) console.log(`  URL      : ${source.sourceUrl}`);
    console.log(`  Evidence : ${evidenceStatusLabel(beforeEvidence)}`);
    if (beforeEvidence.detected_topics.length > 0) {
      console.log(`  Topics   : ${beforeEvidence.detected_topics.join(", ")}`);
    }
    if (beforeEvidence.extracted_facts.length > 0) {
      const negs = beforeEvidence.extracted_facts.filter((f) => f.polarity === "negative");
      const pos = beforeEvidence.extracted_facts.filter((f) => f.polarity === "positive");
      if (negs.length) console.log(`  Neg facts: ${negs.slice(0, 2).map((f) => truncate(f.text_uk, 70)).join(" | ")}`);
      if (pos.length) console.log(`  Pos facts: ${pos.slice(0, 2).map((f) => truncate(f.text_uk, 70)).join(" | ")}`);
    }

    // Employee/employer relevance gate
    const relevance = checkEmployeeRelevance({
      url: source.sourceUrl,
      sourceName: source.sourceName,
      sourceType: source.sourceType,
      title: source.title,
      snippet: source.sourceExcerpt,
      summary: source.shortSummary,
      bullets: [...source.positivePoints, ...source.negativePoints, ...source.neutralFacts],
    });
    logRelevanceResult(relevance, source.companySlug, source.sourceName);
    if (!relevance.isEmployeeRelevant && (relevance.confidence === "high" || relevance.confidence === "medium")) {
      console.log(`  → SKIPPED (not employee relevant: ${relevance.category})`);
      unchanged++;
      continue;
    }

    // Skip if nothing can help
    const hasText = Boolean(source.sourceExcerpt || source.shortSummary);
    if (!hasText && !source.sourceUrl) {
      console.log(`  → SKIP: no text and no URL to fetch`);
      unchanged++;
      continue;
    }

    // Fetch page if needed
    let pageText = "";
    if (args.fetch && source.sourceUrl) {
      const { text, status } = await fetchPageText(source.sourceUrl);
      pageText = text;
      if (status === "success") { fetchSuccess++; console.log(`  Fetch    : success (${text.length} chars)`); }
      else { fetchFailed++; console.log(`  Fetch    : ${status}`); }
    }

    const textForAnalysis = pageText
      ? `${pageText}\n\n[snippet]: ${source.sourceExcerpt ?? ""}`.slice(0, 12000)
      : `${source.sourceExcerpt ?? ""} ${source.shortSummary}`;

    if (!textForAnalysis.trim() || textForAnalysis.trim().length < 20) {
      console.log(`  → SKIP: no usable text even after fetch`);
      unchanged++;
      continue;
    }

    // Run AI enrichment
    if (!aiEnabled) {
      console.log(`  → AI disabled — cannot enrich. Run with AI env vars set.`);
      unchanged++;
      continue;
    }

    const aiResult = await runAiEnrichment(source, textForAnalysis);
    if (!aiResult) {
      console.log(`  → AI failed — no result`);
      unchanged++;
      continue;
    }

    aiUsed++;

    // Re-assess after enrichment
    const enrichedSource = {
      ...source,
      shortSummary: aiResult.shortSummary,
      positivePoints: aiResult.positivePoints,
      negativePoints: aiResult.negativePoints,
      neutralFacts: aiResult.neutralFacts,
    };
    const afterEvidence = extractEvidenceFromSource(enrichedSource);

    const wasImproved = afterEvidence.useful_for_analysis && !beforeEvidence.useful_for_analysis;
    const scoreImproved = afterEvidence.usefulness_score > beforeEvidence.usefulness_score;

    console.log(`  AI result: ${evidenceStatusLabel(afterEvidence)}`);
    if (aiResult.negativePoints.length > 0) {
      console.log(`  Neg      : ${aiResult.negativePoints.slice(0, 2).map((p) => truncate(p, 80)).join(" | ")}`);
    }
    if (aiResult.positivePoints.length > 0) {
      console.log(`  Pos      : ${aiResult.positivePoints.slice(0, 2).map((p) => truncate(p, 80)).join(" | ")}`);
    }
    if (aiResult.neutralFacts.length > 0) {
      console.log(`  Facts    : ${aiResult.neutralFacts.slice(0, 2).map((p) => truncate(p, 80)).join(" | ")}`);
    }

    if (!wasImproved && !scoreImproved) {
      console.log(`  → No improvement. Keeping existing data.`);
      unchanged++;
      continue;
    }

    if (args.apply) {
      const { ok, error } = await updateSourceSummary(source.id, aiResult);
      if (ok) { improved++; console.log(`  → UPDATED (${wasImproved ? "now useful" : `score +${afterEvidence.usefulness_score - beforeEvidence.usefulness_score}`})`); }
      else { errors++; console.log(`  → ERROR: ${error}`); }
    } else {
      improved++;
      console.log(`  → (dry-run — would update, improvement: ${wasImproved ? "now useful" : `score +${afterEvidence.usefulness_score - beforeEvidence.usefulness_score}`})`);
    }
  }

  console.log("\n" + "=".repeat(64));
  console.log("SUMMARY");
  console.log("=".repeat(64));
  console.log(`Processed  : ${targets.length}`);
  console.log(`Improved   : ${improved}`);
  console.log(`Unchanged  : ${unchanged}`);
  console.log(`Errors     : ${errors}`);
  console.log(`AI used    : ${aiUsed}`);
  if (args.fetch) {
    console.log(`Fetch ok   : ${fetchSuccess}`);
    console.log(`Fetch fail : ${fetchFailed}`);
  }
  if (!args.apply && improved > 0) {
    console.log("\n(DRY RUN — no rows written. Re-run with --apply to write.)");
  }

  console.log("\n" + "=".repeat(64));
  console.log("SAFETY — invariants verified");
  console.log("=".repeat(64));
  console.log("public.reviews writes              : 0");
  console.log("internal rating / review mutations : 0");
  console.log("Work.ua / Robota.ua                : excluded");
  console.log("source_url, source_name, type      : unchanged");
  console.log("status, is_public                  : unchanged");
  console.log("Only fields written (if --apply)   : short_summary, positive_points, negative_points, neutral_facts");
}

main().catch((err) => {
  console.error("[enrich-external-evidence] fatal:", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
