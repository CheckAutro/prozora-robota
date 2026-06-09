import { loadEnvConfig } from "@next/env";
import { getServiceClient } from "@/lib/supabase/server";
import {
  canAutoPublishExternalSource,
  truncateSourceExcerpt,
  normalizeSourceUrl,
  isSocialMediaSource,
} from "@/lib/external/auto-publish-helpers";
import { upsertExternalCompanySource } from "@/lib/external/company-sources";
import {
  searchExternalSourcesWithWarnings,
  externalSearchIsEnabled,
} from "@/lib/external/search-provider";
import {
  inferSourceTypeFromContent,
  sourceNameFromUrl,
  detectSourceLanguage,
  normalizeExternalSourceForPublic,
} from "@/lib/external/source-normalizer";

loadEnvConfig(process.cwd(), true);

// ── Priority company list ──────────────────────────────────────────────────────

const PRIORITY_SLUGS: string[] = [
  "atb", "eva", "nova-poshta", "silpo", "rozetka",
  "privatbank", "a-bank", "ukrposhta", "glovo", "comfy",
  "foxtrot", "epicentr", "wog", "okko", "ukrzaliznytsia",
  "mcdonalds", "kfc", "softserve", "epam", "dtek",
  "kyivstar", "vodafone", "lifecell", "monobank", "oshchadbank",
  "raiffeisen-bank", "fozzy-group", "metro", "auchan",
];

// ── Arg parsing ────────────────────────────────────────────────────────────────

interface Args {
  apply: boolean;
  limit: number;
  company: string | null;
  minSources: number;
}

function parseArgs(argv: string[]): Args {
  let apply = false;
  let limit = PRIORITY_SLUGS.length;
  let company: string | null = null;
  let minSources = 3;

  for (const arg of argv) {
    if (arg === "--apply") apply = true;
    else if (arg.startsWith("--limit=")) {
      const n = parseInt(arg.slice("--limit=".length), 10);
      if (Number.isFinite(n) && n > 0) limit = Math.min(100, n);
    } else if (arg.startsWith("--company=")) {
      company = arg.slice("--company=".length).trim() || null;
    } else if (arg.startsWith("--min-sources=")) {
      const n = parseInt(arg.slice("--min-sources=".length), 10);
      if (Number.isFinite(n) && n >= 0) minSources = n;
    }
  }

  return { apply, limit, company, minSources };
}

// ── Types ──────────────────────────────────────────────────────────────────────

interface CompanyResult {
  slug: string;
  name: string;
  existingCount: number;
  discovered: number;
  published: number;
  needsVerification: number;
  duplicateSkipped: number;
  rejected: number;
  skippedEnough: boolean;
  error?: string;
  typeBreakdown: Record<string, number>;
}

// ── Per-company processing ─────────────────────────────────────────────────────

function computeConfidence(
  raw: { title: string; snippet: string; url: string }
): "low" | "medium" | "high" {
  const text = `${raw.title} ${raw.snippet}`.toLowerCase();
  const name = sourceNameFromUrl(raw.url);
  if (/відгук|відгуки|оцінк|рейтинг|reviews?|rating/.test(text)) return "high";
  if (["DOU", "Djinni", "Work.ua", "Robota.ua"].includes(name)) return "medium";
  return "low";
}

async function processCompany(
  company: { slug: string; name: string },
  args: Args
): Promise<CompanyResult> {
  const result: CompanyResult = {
    slug: company.slug,
    name: company.name,
    existingCount: 0,
    discovered: 0,
    published: 0,
    needsVerification: 0,
    duplicateSkipped: 0,
    rejected: 0,
    skippedEnough: false,
    typeBreakdown: {},
  };

  const client = getServiceClient();

  // Count verified+public sources already in DB
  const { count: existingCount } = await client
    .from("external_company_sources")
    .select("id", { count: "exact", head: true })
    .eq("company_slug", company.slug)
    .eq("status", "verified")
    .eq("is_public", true);
  result.existingCount = existingCount ?? 0;

  if (result.existingCount >= args.minSources) {
    result.skippedEnough = true;
    return result;
  }

  if (!externalSearchIsEnabled()) return result;

  // Load all existing URLs for this company to skip duplicates
  const { data: existingRows } = await client
    .from("external_company_sources")
    .select("source_url")
    .eq("company_slug", company.slug)
    .not("source_url", "is", null);

  const existingUrls = new Set<string>(
    (existingRows ?? [])
      .map((row: Record<string, unknown>) => normalizeSourceUrl(String(row.source_url ?? "")) ?? "")
      .filter(Boolean)
  );

  // 2 focused queries per company (controlled — no 12-query blast)
  const queries = [
    `${company.name} відгуки працівників`,
    `${company.name} роботодавець відгуки`,
  ];

  const seenUrls = new Set<string>(existingUrls);
  const candidates: Array<{ title: string; snippet: string; url: string; sourceName: string }> = [];

  for (const query of queries) {
    const { results } = await searchExternalSourcesWithWarnings(query);
    for (const item of results) {
      const normalizedUrl = normalizeSourceUrl(item.url);
      if (!normalizedUrl) continue;
      if (seenUrls.has(normalizedUrl)) continue;
      if (isSocialMediaSource(item.sourceName || "", normalizedUrl)) continue;
      seenUrls.add(normalizedUrl);
      candidates.push({ ...item, url: normalizedUrl });
    }
  }

  const now = new Date().toISOString();

  for (const candidate of candidates) {
    const sourceType = inferSourceTypeFromContent(candidate.title, candidate.snippet, candidate.url);
    const language = detectSourceLanguage({
      title: candidate.title,
      snippet: candidate.snippet,
      sourceUrl: candidate.url,
    });
    const confidence = computeConfidence(candidate);

    // Normalize title/snippet to Ukrainian for DB storage (consistent with AI flow)
    const normalized = normalizeExternalSourceForPublic({
      title: candidate.title,
      snippet: candidate.snippet,
      sourceUrl: candidate.url,
      sourceType,
      sourceLanguage: language,
    });

    const sourceName = candidate.sourceName || sourceNameFromUrl(candidate.url);
    const shortSummary = truncateSourceExcerpt(normalized.ukrainianShortSummary, 800);
    // Raw title+snippet passed as matchHint — company name check runs against original text
    const matchHint = `${candidate.title} ${candidate.snippet} ${candidate.url}`;

    result.discovered++;
    result.typeBreakdown[sourceType] = (result.typeBreakdown[sourceType] ?? 0) + 1;

    const { canPublish, reason } = canAutoPublishExternalSource({
      sourceUrl: candidate.url,
      sourceName,
      title: normalized.ukrainianTitle,
      snippet: normalized.ukrainianShortSummary,
      shortSummary,
      sourceType,
      confidence,
      companyName: company.name,
      matchHint,
    });

    if (canPublish) {
      if (args.apply) {
        await upsertExternalCompanySource({
          company_slug: company.slug,
          company_name: company.name,
          source_name: sourceName,
          source_url: candidate.url,
          source_type: sourceType,
          title: normalized.ukrainianTitle || null,
          short_summary: shortSummary || `Зовнішнє джерело про ${company.name}.`,
          positive_points: normalized.positivePointsUk,
          negative_points: normalized.negativePointsUk,
          neutral_facts: normalized.neutralFactsUk,
          confidence,
          status: "verified",
          is_public: true,
          source_excerpt: truncateSourceExcerpt(`${candidate.title} — ${candidate.snippet}`, 800),
          collected_at: now,
          admin_note: `Auto-published from external discovery. Original language: ${language}`,
        });
      }
      result.published++;
    } else if (reason === "low_confidence" || reason === "no_company_match") {
      // Keep low-confidence or unmatched results for admin review
      if (args.apply) {
        await upsertExternalCompanySource({
          company_slug: company.slug,
          company_name: company.name,
          source_name: sourceName,
          source_url: candidate.url,
          source_type: sourceType,
          title: normalized.ukrainianTitle || null,
          short_summary: shortSummary || `Зовнішнє джерело про ${company.name}.`,
          positive_points: normalized.positivePointsUk,
          negative_points: normalized.negativePointsUk,
          neutral_facts: normalized.neutralFactsUk,
          confidence,
          status: "needs_verification",
          is_public: false,
          source_excerpt: truncateSourceExcerpt(`${candidate.title} — ${candidate.snippet}`, 800),
          collected_at: now,
          admin_note: `Priority backfill candidate. Skip reason: ${reason ?? "unknown"}. Original language: ${language}`,
        });
      }
      result.needsVerification++;
    } else {
      // social_media, unsupported_type, summary_too_long — discard
      result.rejected++;
    }
  }

  return result;
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const client = getServiceClient();

  console.log("=".repeat(64));
  console.log("Priority External Source Backfill");
  console.log(`Mode       : ${args.apply ? "APPLY — writes to DB" : "DRY RUN — no writes (pass --apply to write)"}`);
  if (args.company) console.log(`Company    : ${args.company}`);
  console.log(`Limit      : ${args.limit}`);
  console.log(`Min sources: ${args.minSources} (skip company if already has >= this many)`);
  console.log(`Search     : ${externalSearchIsEnabled() ? "enabled" : "disabled (set EXTERNAL_SEARCH_ENABLED=true)"}`);
  console.log("=".repeat(64));

  // Build target list
  let targetSlugs = args.company ? [args.company] : PRIORITY_SLUGS;
  targetSlugs = targetSlugs.slice(0, args.limit);

  const { data: companyRows, error: dbError } = await client
    .from("companies")
    .select("slug, name")
    .in("slug", targetSlugs);

  if (dbError) {
    console.error("Failed to load companies:", dbError.message);
    process.exitCode = 1;
    return;
  }

  const foundSlugs = new Set<string>(
    (companyRows ?? []).map((r: Record<string, unknown>) => String(r.slug))
  );
  const notFoundSlugs = targetSlugs.filter((s) => !foundSlugs.has(s));
  const companies = (companyRows ?? []) as { slug: string; name: string }[];

  if (notFoundSlugs.length > 0) {
    console.log(`\nSlugs not found in DB (skipped): ${notFoundSlugs.join(", ")}`);
  }

  console.log();

  // Process each company
  const results: CompanyResult[] = [];

  for (let i = 0; i < companies.length; i++) {
    const company = companies[i];
    if (!company) continue;

    // Small delay between companies to avoid hammering the search API
    if (i > 0 && externalSearchIsEnabled()) {
      await new Promise((resolve) => setTimeout(resolve, 400));
    }

    process.stdout.write(`  [${i + 1}/${companies.length}] ${company.slug} (${company.name})... `);

    try {
      const r = await processCompany(company, args);
      results.push(r);

      if (r.skippedEnough) {
        console.log(`skipped — already has ${r.existingCount} verified+public sources`);
      } else if (r.error) {
        console.log(`ERROR: ${r.error}`);
      } else {
        const types = Object.entries(r.typeBreakdown)
          .map(([t, n]) => `${t}:${n}`)
          .join(" ");
        console.log(
          `existing=${r.existingCount} discovered=${r.discovered} published=${r.published}` +
          ` needs_review=${r.needsVerification} dupes=${r.duplicateSkipped} rejected=${r.rejected}` +
          (types ? `  [${types}]` : "")
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({
        slug: company.slug, name: company.name, existingCount: 0,
        discovered: 0, published: 0, needsVerification: 0,
        duplicateSkipped: 0, rejected: 0, skippedEnough: false,
        error: msg, typeBreakdown: {},
      });
      console.log(`ERROR: ${msg}`);
    }
  }

  // Totals
  const totalPublished = results.reduce((s, r) => s + r.published, 0);
  const totalNeedsVerification = results.reduce((s, r) => s + r.needsVerification, 0);
  const totalDiscovered = results.reduce((s, r) => s + r.discovered, 0);
  const totalDuplicateSkipped = results.reduce((s, r) => s + r.duplicateSkipped, 0);
  const totalRejected = results.reduce((s, r) => s + r.rejected, 0);
  const totalSkipped = results.filter((r) => r.skippedEnough).length;
  const totalErrors = results.filter((r) => r.error).length;

  console.log("\n" + "=".repeat(64));
  console.log("BATCH SUMMARY");
  console.log("=".repeat(64));
  console.log(`Companies processed       : ${results.length}`);
  console.log(`Skipped (enough sources)  : ${totalSkipped}`);
  console.log(`Not found in DB           : ${notFoundSlugs.length}`);
  console.log(`Total discovered          : ${totalDiscovered}`);
  console.log(`Auto-published (verified) : ${totalPublished}`);
  console.log(`Saved for admin review    : ${totalNeedsVerification}`);
  console.log(`Duplicate skipped         : ${totalDuplicateSkipped}`);
  console.log(`Rejected (blocked)        : ${totalRejected}`);
  console.log(`Errors                    : ${totalErrors}`);
  if (!args.apply) {
    console.log("\n(DRY RUN — no rows were written to DB. Re-run with --apply to write.)");
  }

  console.log("\n" + "=".repeat(64));
  console.log("SAFETY SUMMARY");
  console.log("=".repeat(64));
  console.log("public.reviews writes              : 0");
  console.log("internal rating mutations          : 0");
  console.log("internal review count mutations    : 0");
  console.log("Work.ua / Robota.ua classification : vacancy/company_page only (inferSourceTypeFromContent)");
  console.log("auto-publish guard                 : yes (canAutoPublishExternalSource)");
  console.log("duplicate guard                    : yes (URL pre-check + upsert dedup)");
  console.log("social media blocked               : yes (isSocialMediaSource + canAutoPublish)");
}

main().catch((err) => {
  console.error("[backfill-priority-sources] fatal:", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
