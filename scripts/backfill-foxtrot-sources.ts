/**
 * Targeted Foxtrot employee-review source backfill.
 *
 * Runs focused search queries for Foxtrot employee reviews and adds any
 * new employee-relevant sources. Uses the same auto-publish + employee
 * relevance gates as the rest of the pipeline.
 *
 * Usage:
 *   npm run backfill:foxtrot-sources            # dry run
 *   npm run backfill:foxtrot-sources -- --apply # write to DB
 */

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
import { checkEmployeeRelevance, logRelevanceResult } from "@/lib/evidence/employee-relevance";

loadEnvConfig(process.cwd(), true);

const COMPANY_SLUG = "foxtrot";

const TARGETED_QUERIES = [
  "Foxtrot employee reviews",
  "Фокстрот відгуки співробітників",
  "Фокстрот відгуки працівників",
  "Фокстрот робота відгуки",
  "Фокстрот зарплата умови праці",
  "Foxtrot reviews employees",
  "Foxtrot Indeed reviews",
  "Фокстрот vidhuk otzyvy-sotrudnikov",
  "Фокстрот vnutri.org відгуки",
  "Фокстрот pravda-sotrudnikov відгуки",
  "Фокстрот pro-robotu відгуки",
  "Фокстрот depratsiuiesh відгуки",
  "Фокстрот jobtrue відгуки",
  "Фокстрот neorabote відгуки",
];

interface Args {
  apply: boolean;
}

function parseArgs(argv: string[]): Args {
  return { apply: argv.includes("--apply") };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const client = getServiceClient();

  console.log("=".repeat(64));
  console.log("Foxtrot Targeted Source Backfill");
  console.log(`Mode   : ${args.apply ? "APPLY — writes to DB" : "DRY RUN — no writes (pass --apply to write)"}`);
  console.log(`Search : ${externalSearchIsEnabled() ? "enabled" : "disabled"}`);
  console.log("=".repeat(64));

  if (!externalSearchIsEnabled()) {
    console.log("\nExternal search is disabled. Set EXTERNAL_SEARCH_ENABLED=true and EXTERNAL_SEARCH_API_KEY.");
    return;
  }

  // Load Foxtrot company record
  const { data: companyRow, error: companyError } = await client
    .from("companies")
    .select("slug, name")
    .eq("slug", COMPANY_SLUG)
    .maybeSingle();

  if (companyError || !companyRow) {
    console.error(`Company '${COMPANY_SLUG}' not found in DB.`);
    process.exitCode = 1;
    return;
  }

  const companyName = (companyRow as { slug: string; name: string }).name;
  console.log(`\nCompany : ${companyName} (${COMPANY_SLUG})\n`);

  // Build set of existing URLs to skip duplicates
  const { data: existingRows } = await client
    .from("external_company_sources")
    .select("source_url")
    .eq("company_slug", COMPANY_SLUG)
    .not("source_url", "is", null);

  const seenUrls = new Set<string>(
    ((existingRows ?? []) as Record<string, unknown>[])
      .map((row) => normalizeSourceUrl(String(row.source_url ?? "")) ?? "")
      .filter(Boolean)
  );

  const now = new Date().toISOString();
  let discovered = 0;
  let published = 0;
  let needsVerification = 0;
  let relevanceRejected = 0;
  let dupeSkipped = 0;
  let otherSkipped = 0;

  for (const query of TARGETED_QUERIES) {
    console.log(`\nQuery: "${query}"`);

    const { results, warnings } = await searchExternalSourcesWithWarnings(query);
    for (const w of warnings) {
      if (!w.includes("disabled")) console.warn(`  [warn] ${w}`);
    }

    for (const item of results) {
      const normalizedUrl = normalizeSourceUrl(item.url);
      if (!normalizedUrl) continue;

      if (seenUrls.has(normalizedUrl)) {
        dupeSkipped++;
        continue;
      }
      if (isSocialMediaSource(item.sourceName || "", normalizedUrl)) {
        otherSkipped++;
        continue;
      }
      seenUrls.add(normalizedUrl);
      discovered++;

      const sourceType = inferSourceTypeFromContent(item.title, item.snippet, normalizedUrl);
      const language = detectSourceLanguage({
        title: item.title,
        snippet: item.snippet,
        sourceUrl: normalizedUrl,
      });
      const normalized = normalizeExternalSourceForPublic({
        title: item.title,
        snippet: item.snippet,
        sourceUrl: normalizedUrl,
        sourceType,
        sourceLanguage: language,
      });
      const sourceName = item.sourceName || sourceNameFromUrl(normalizedUrl);
      const shortSummary = truncateSourceExcerpt(normalized.ukrainianShortSummary, 800);
      const matchHint = `${item.title} ${item.snippet} ${normalizedUrl}`;

      // Employee relevance gate — log result for transparency
      const relevance = checkEmployeeRelevance({
        url: normalizedUrl,
        sourceName,
        sourceType,
        title: item.title,
        snippet: item.snippet,
        summary: shortSummary,
      });
      logRelevanceResult(relevance, COMPANY_SLUG, sourceName);

      // Hard-block consumer sources — canAutoPublishExternalSource also runs
      // the gate, but logging it here makes the output readable.
      if (!relevance.isEmployeeRelevant && relevance.confidence === "high") {
        relevanceRejected++;
        console.log(`  → SKIP (employee-relevance REJECT high: ${relevance.category})`);
        continue;
      }
      if (!relevance.isEmployeeRelevant && relevance.confidence === "medium") {
        relevanceRejected++;
        console.log(`  → SKIP (employee-relevance REJECT medium: ${relevance.category})`);
        continue;
      }

      // Confidence based on keyword presence
      const hasReviewKeyword = /відгук|відгуки|review|отзыв|rating|рейтинг/i.test(
        `${item.title} ${item.snippet}`
      );
      const confidence: "low" | "medium" | "high" = hasReviewKeyword
        ? "high"
        : /foxtrot|фокстрот/i.test(`${item.title} ${item.snippet} ${normalizedUrl}`)
          ? "medium"
          : "low";

      const { canPublish, reason } = canAutoPublishExternalSource({
        sourceUrl: normalizedUrl,
        sourceName,
        title: normalized.ukrainianTitle,
        snippet: normalized.ukrainianShortSummary,
        shortSummary,
        sourceType,
        confidence,
        companyName,
        matchHint,
      });

      console.log(`  ${normalizedUrl}`);
      console.log(
        `  type=${sourceType} conf=${confidence} canPublish=${canPublish}${reason ? `  skip=${reason}` : ""}`
      );

      if (canPublish) {
        if (args.apply) {
          await upsertExternalCompanySource({
            company_slug: COMPANY_SLUG,
            company_name: companyName,
            source_name: sourceName,
            source_url: normalizedUrl,
            source_type: sourceType,
            title: normalized.ukrainianTitle || null,
            short_summary: shortSummary || `Зовнішнє джерело про ${companyName}.`,
            positive_points: normalized.positivePointsUk,
            negative_points: normalized.negativePointsUk,
            neutral_facts: normalized.neutralFactsUk,
            confidence,
            status: "verified",
            is_public: true,
            source_excerpt: truncateSourceExcerpt(`${item.title} — ${item.snippet}`, 800),
            collected_at: now,
            admin_note: `Targeted Foxtrot backfill. Query: "${query}". Language: ${language}`,
          });
        }
        published++;
      } else if (reason === "low_confidence" || reason === "no_company_match") {
        if (args.apply) {
          await upsertExternalCompanySource({
            company_slug: COMPANY_SLUG,
            company_name: companyName,
            source_name: sourceName,
            source_url: normalizedUrl,
            source_type: sourceType,
            title: normalized.ukrainianTitle || null,
            short_summary: shortSummary || `Зовнішнє джерело про ${companyName}.`,
            positive_points: normalized.positivePointsUk,
            negative_points: normalized.negativePointsUk,
            neutral_facts: normalized.neutralFactsUk,
            confidence,
            status: "needs_verification",
            is_public: false,
            source_excerpt: truncateSourceExcerpt(`${item.title} — ${item.snippet}`, 800),
            collected_at: now,
            admin_note: `Targeted Foxtrot backfill (needs review). Skip: ${reason}. Query: "${query}". Language: ${language}`,
          });
        }
        needsVerification++;
      } else {
        // social_media, unsupported_type, summary_too_long, employee_relevance_review, etc.
        otherSkipped++;
      }
    }

    // Small delay between queries to avoid rate limits
    await new Promise((resolve) => setTimeout(resolve, 350));
  }

  console.log("\n" + "=".repeat(64));
  console.log("SUMMARY");
  console.log("=".repeat(64));
  console.log(`Queries run         : ${TARGETED_QUERIES.length}`);
  console.log(`Discovered (new)    : ${discovered}`);
  console.log(`Auto-published      : ${published}`);
  console.log(`Needs verification  : ${needsVerification}`);
  console.log(`Relevance rejected  : ${relevanceRejected}`);
  console.log(`Dupe skipped        : ${dupeSkipped}`);
  console.log(`Other skipped       : ${otherSkipped}`);
  if (!args.apply) {
    console.log("\n(DRY RUN — no rows written. Re-run with --apply to write.)");
  }

  console.log("\n" + "=".repeat(64));
  console.log("SAFETY");
  console.log("=".repeat(64));
  console.log("public.reviews writes              : 0");
  console.log("internal rating mutations          : 0");
  console.log("internal review count mutations    : 0");
  console.log("Work.ua / Robota.ua                : vacancy/company_page only");
  console.log("Employee relevance gate            : active");
  console.log("Auto-publish guard                 : active");
}

main().catch((err) => {
  console.error("[backfill-foxtrot-sources] fatal:", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
