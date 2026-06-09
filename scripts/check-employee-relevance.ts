/**
 * Employee/employer relevance audit for external_company_sources.
 *
 * Usage:
 *   npx tsx scripts/check-employee-relevance.ts               # audit all public review sources
 *   npx tsx scripts/check-employee-relevance.ts --company=atb  # single company
 *   npx tsx scripts/check-employee-relevance.ts --self-check   # run built-in test cases
 *   npx tsx scripts/check-employee-relevance.ts --mark-private # set is_public=false for high-confidence REJECT
 *   npx tsx scripts/check-employee-relevance.ts --mark-private --include-medium-consumer
 *     # also marks medium-confidence REJECT when category is consumer_review / product_service_review / customer_complaint
 *
 * Safety:
 *   - Does NOT delete any rows.
 *   - --mark-private sets is_public=false + status=needs_verification for high-confidence REJECT.
 *   - --include-medium-consumer extends that to medium-confidence obvious consumer categories only.
 *   - REVIEW sources are never touched regardless of flags.
 *   - Never touches public.reviews, internal ratings, or review counts.
 */

import { loadEnvConfig } from "@next/env";
import { getServiceClient } from "@/lib/supabase/server";
import { rowToExternalCompanySource } from "@/lib/external/company-sources";
import {
  checkEmployeeRelevance,
  logRelevanceResult,
  runSelfCheck,
  type EmployeeRelevanceResult,
} from "@/lib/evidence/employee-relevance";

loadEnvConfig(process.cwd(), true);

// ── Args ──────────────────────────────────────────────────────────────────────

const MEDIUM_CONSUMER_CATEGORIES = new Set([
  "consumer_review",
  "product_service_review",
  "customer_complaint",
]);

interface Args {
  company: string | null;
  markPrivate: boolean;
  includeMediumConsumer: boolean;
  selfCheck: boolean;
  allTypes: boolean;
  showAccepted: boolean;
}

function parseArgs(argv: string[]): Args {
  let company: string | null = null;
  let markPrivate = false;
  let includeMediumConsumer = false;
  let selfCheck = false;
  let allTypes = false;
  let showAccepted = false;

  for (const arg of argv) {
    if (arg === "--mark-private") markPrivate = true;
    else if (arg === "--include-medium-consumer") includeMediumConsumer = true;
    else if (arg === "--self-check") selfCheck = true;
    else if (arg === "--all-types") allTypes = true;
    else if (arg === "--show-accepted") showAccepted = true;
    else if (arg.startsWith("--company=")) company = arg.slice("--company=".length).trim() || null;
  }

  return { company, markPrivate, includeMediumConsumer, selfCheck, allTypes, showAccepted };
}

// ── DB operations ─────────────────────────────────────────────────────────────

async function markSourcePrivate(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { error } = await getServiceClient()
      .from("external_company_sources")
      .update({ is_public: false, status: "needs_verification" })
      .eq("id", id);
    return error ? { ok: false, error: error.message } : { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // Self-check mode: run built-in test cases
  if (args.selfCheck) {
    console.log("=".repeat(64));
    console.log("Employee Relevance Self-Check");
    console.log("=".repeat(64));
    const { passed, failed, results } = runSelfCheck();
    for (const line of results) console.log(line);
    console.log(`\nPassed: ${passed}  Failed: ${failed}`);
    if (failed > 0) process.exitCode = 1;
    return;
  }

  const client = getServiceClient();

  console.log("=".repeat(64));
  console.log("Employee Relevance Audit");
  console.log("=".repeat(64));
  if (args.company) console.log(`Company     : ${args.company}`);
  const modeLabel = args.markPrivate
    ? `MARK-PRIVATE — high-confidence REJECT${args.includeMediumConsumer ? " + medium consumer categories" : ""}`
    : "audit only (pass --mark-private to act)";
  console.log(`Mode        : ${modeLabel}`);
  console.log(`Source types: ${args.allTypes ? "all" : "reviews + rating only"}`);
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

  if (!args.allTypes) {
    query = query.in("source_type", ["reviews", "rating"]);
  }
  if (args.company) {
    query = query.eq("company_slug", args.company);
  }

  const { data: rows, error } = await query;
  if (error) {
    console.error("DB error:", error.message);
    process.exitCode = 1;
    return;
  }

  const sources = ((rows ?? []) as unknown as Record<string, unknown>[]).map(rowToExternalCompanySource);

  const accepted: Array<{ slug: string; name: string; url: string; result: EmployeeRelevanceResult }> = [];
  const rejected: Array<{ id: string; slug: string; name: string; url: string; result: EmployeeRelevanceResult }> = [];
  const review: Array<{ slug: string; name: string; url: string; result: EmployeeRelevanceResult }> = [];

  for (const source of sources) {
    const relevance = checkEmployeeRelevance({
      url: source.sourceUrl,
      sourceName: source.sourceName,
      sourceType: source.sourceType,
      title: source.title,
      snippet: source.sourceExcerpt,
      summary: source.shortSummary,
      bullets: [...source.positivePoints, ...source.negativePoints, ...source.neutralFacts],
    });

    const entry = {
      id: source.id,
      slug: source.companySlug,
      name: source.sourceName,
      url: source.sourceUrl ?? "",
      result: relevance,
    };

    if (!relevance.isEmployeeRelevant && (relevance.confidence === "high" || relevance.confidence === "medium")) {
      rejected.push(entry);
    } else if (relevance.isEmployeeRelevant && relevance.confidence !== "low") {
      accepted.push(entry);
    } else {
      review.push(entry);
    }
  }

  // Print results
  console.log(`\nTotal sources audited : ${sources.length}`);
  console.log(`ACCEPT (employee rel.): ${accepted.length}`);
  console.log(`REJECT (consumer)     : ${rejected.length}`);
  console.log(`REVIEW (uncertain)    : ${review.length}`);

  if (rejected.length > 0) {
    console.log("\n" + "─".repeat(64));
    console.log("REJECTED sources (consumer/client content, not employee):");
    console.log("─".repeat(64));
    for (const { slug, name, url, result } of rejected) {
      logRelevanceResult(result, slug, name);
      if (url) console.log(`  URL: ${url}`);
      if (result.rejectedSignals.length > 0) {
        console.log(`  Consumer signals: ${result.rejectedSignals.slice(0, 5).join(", ")}`);
      }
    }
  }

  if (review.length > 0) {
    console.log("\n" + "─".repeat(64));
    console.log("REVIEW sources (mixed or unclear signals — manual check recommended):");
    console.log("─".repeat(64));
    for (const { slug, name, url, result } of review) {
      logRelevanceResult(result, slug, name);
      if (url) console.log(`  URL: ${url}`);
    }
  }

  if (args.showAccepted && accepted.length > 0) {
    console.log("\n" + "─".repeat(64));
    console.log("ACCEPTED sources:");
    console.log("─".repeat(64));
    for (const { slug, name, result } of accepted) {
      logRelevanceResult(result, slug, name);
    }
  }

  // Apply --mark-private
  if (args.markPrivate) {
    const toMark = rejected.filter(({ result }) => {
      if (result.confidence === "high") return true;
      if (
        args.includeMediumConsumer &&
        result.confidence === "medium" &&
        MEDIUM_CONSUMER_CATEGORIES.has(result.category)
      ) return true;
      return false;
    });

    if (toMark.length > 0) {
      console.log("\n" + "─".repeat(64));
      const breakdown = [
        `${toMark.filter(({ result }) => result.confidence === "high").length} high-confidence`,
        args.includeMediumConsumer
          ? `${toMark.filter(({ result }) => result.confidence === "medium").length} medium-consumer`
          : "",
      ].filter(Boolean).join(" + ");
      console.log(`Marking ${toMark.length} rejected sources as private (${breakdown})...`);

      let marked = 0;
      let markErrors = 0;
      for (const { id, slug, name, url, result } of toMark) {
        const { ok, error: markError } = await markSourcePrivate(id);
        if (ok) {
          marked++;
          console.log(
            `  ✓ ${slug}/${name}  conf=${result.confidence}  cat=${result.category}` +
            `\n    url=${url}` +
            `\n    reason=${result.reason}`
          );
        } else {
          markErrors++;
          console.log(`  ✗ ${slug}/${name} → ERROR: ${markError}`);
        }
      }
      console.log(`\nMarked private : ${marked}`);
      if (markErrors > 0) console.log(`Errors         : ${markErrors}`);
    } else {
      console.log("\nNo sources eligible to mark private.");
    }
    console.log("\nSAFETY: public.reviews unchanged. Internal ratings unchanged.");
  } else if (!args.markPrivate && rejected.length > 0) {
    console.log(`\n→ ${rejected.length} consumer/client sources found. Run with --mark-private to hide them.`);
  }

  console.log();
}

main().catch((err) => {
  console.error("[check-employee-relevance] fatal:", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
