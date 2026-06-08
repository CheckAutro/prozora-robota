import { loadEnvConfig } from "@next/env";
import { getServiceClient } from "@/lib/supabase/server";
import {
  isGenericExternalSummary,
  getExternalReviewSourceQuality,
} from "@/lib/external/external-review-quality";
import { rowToExternalCompanySource } from "@/lib/external/company-sources";
import { primaryTextLooksUkrainian } from "@/lib/external/source-normalizer";

loadEnvConfig(process.cwd());

const AUTO_PUBLISH_MARKER = "Auto-published from external discovery";

async function main() {
  const client = getServiceClient();

  // ── Load all rows ────────────────────────────────────────────────────────────
  const { data: allRows, error: allError } = await client
    .from("external_company_sources")
    .select("id, company_slug, source_type, status, is_public, source_url, admin_note");

  if (allError) {
    console.error("Failed to query external_company_sources:", allError.message);
    process.exitCode = 1;
    return;
  }

  const all = (allRows ?? []) as Array<{
    id: string;
    company_slug: string;
    source_type: string;
    status: string;
    is_public: boolean;
    source_url: string | null;
    admin_note: string | null;
  }>;

  const total = all.length;
  const autoPublishedCount = all.filter(
    (r) => typeof r.admin_note === "string" && r.admin_note.includes(AUTO_PUBLISH_MARKER)
  ).length;

  // Counts by dimension
  const byType: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  const byIsPublic: Record<string, number> = {};
  const byCompany: Record<string, number> = {};

  for (const row of all) {
    const t = row.source_type ?? "unknown";
    const s = row.status ?? "unknown";
    const p = String(row.is_public ?? false);
    const c = row.company_slug ?? "unknown";
    byType[t] = (byType[t] ?? 0) + 1;
    byStatus[s] = (byStatus[s] ?? 0) + 1;
    byIsPublic[p] = (byIsPublic[p] ?? 0) + 1;
    byCompany[c] = (byCompany[c] ?? 0) + 1;
  }

  // Work.ua / Robota.ua breakdown
  const workRobotaRows = all.filter((row) => {
    const url = row.source_url ?? "";
    return url.includes("work.ua") || url.includes("robota.ua");
  });
  const workRobotaByType: Record<string, number> = {};
  for (const row of workRobotaRows) {
    const t = row.source_type ?? "unknown";
    workRobotaByType[t] = (workRobotaByType[t] ?? 0) + 1;
  }

  // Top 10 companies by source count
  const topCompanies = Object.entries(byCompany)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  // ── Load public review sources for quality analysis ──────────────────────────
  const { data: reviewRows, error: reviewError } = await client
    .from("external_company_sources")
    .select([
      "id", "company_slug", "company_name", "source_name", "source_url", "source_type",
      "title", "short_summary", "positive_points", "negative_points", "neutral_facts",
      "rating_value", "rating_scale", "reviews_count", "confidence", "status", "is_public",
      "source_excerpt", "collected_at", "admin_note", "created_at", "updated_at",
    ].join(", "))
    .eq("source_type", "reviews")
    .eq("status", "verified")
    .eq("is_public", true);

  const publicReviewSources = reviewError
    ? []
    : ((reviewRows ?? []) as unknown as Record<string, unknown>[]).map((row) => rowToExternalCompanySource(row));

  // Exclude Work.ua / Robota.ua from quality analysis
  const nonWorkRobotaReviews = publicReviewSources.filter((s) => {
    const url = s.sourceUrl ?? "";
    const name = s.sourceName.toLowerCase();
    return !url.includes("work.ua") && !url.includes("robota.ua")
      && !name.includes("work.ua") && !name.includes("robota.ua");
  });

  // Quality breakdown
  const qualityCounts = { generic: 0, partial: 0, specific: 0 };
  const genericByCompany: Record<string, number> = {};
  const summaryFrequency: Record<string, number> = {};
  const noUkrainianSummary: Array<{ id: string; slug: string; source: string; summary: string }> = [];

  for (const source of nonWorkRobotaReviews) {
    const qualityResult = getExternalReviewSourceQuality(source);
    qualityCounts[qualityResult.quality] = (qualityCounts[qualityResult.quality] ?? 0) + 1;

    if (qualityResult.quality === "generic") {
      genericByCompany[source.companySlug] = (genericByCompany[source.companySlug] ?? 0) + 1;
    }

    // Track repeated generic summaries
    const summaryKey = source.shortSummary.trim().toLowerCase().slice(0, 80);
    if (summaryKey) {
      summaryFrequency[summaryKey] = (summaryFrequency[summaryKey] ?? 0) + 1;
    }

    // Check for non-Ukrainian summary
    if (!primaryTextLooksUkrainian(source.shortSummary)) {
      noUkrainianSummary.push({
        id: source.id,
        slug: source.companySlug,
        source: source.sourceName,
        summary: source.shortSummary.slice(0, 100),
      });
    }
  }

  // Top 10 repeated summaries
  const topRepeatedSummaries = Object.entries(summaryFrequency)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .filter(([, count]) => count > 1);

  // Top 10 companies with most generic review sources
  const topGenericCompanies = Object.entries(genericByCompany)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  // ── Print report ─────────────────────────────────────────────────────────────
  const pad = (s: string, n: number) => s.padEnd(n, " ");

  console.log("=".repeat(64));
  console.log("External Source Health Report");
  console.log("=".repeat(64));

  console.log(`\nTotal rows              : ${total}`);
  console.log(`Auto-published rows     : ${autoPublishedCount}`);

  console.log("\nBy source_type:");
  for (const [type, count] of Object.entries(byType).sort()) {
    console.log(`  ${pad(type, 20)} ${count}`);
  }

  console.log("\nBy status:");
  for (const [status, count] of Object.entries(byStatus).sort()) {
    console.log(`  ${pad(status, 20)} ${count}`);
  }

  console.log("\nBy is_public:");
  for (const [pub, count] of Object.entries(byIsPublic).sort()) {
    console.log(`  is_public=${pad(pub, 8)} ${count}`);
  }

  console.log("\nTop 10 companies by total source count:");
  for (const [slug, count] of topCompanies) {
    console.log(`  ${pad(slug, 28)} ${count}`);
  }

  console.log("\nWork.ua / Robota.ua sources by source_type:");
  if (workRobotaRows.length === 0) {
    console.log("  (no Work.ua / Robota.ua sources found)");
  } else {
    for (const [type, count] of Object.entries(workRobotaByType).sort()) {
      const violation = type === "reviews" || type === "rating";
      const mark = violation ? "  ← VIOLATION: must be vacancy/company_page" : "  ✓";
      console.log(`  ${pad(type, 20)} ${count}${mark}`);
    }
    const hasViolation = workRobotaByType["reviews"] ?? workRobotaByType["rating"] ?? 0;
    if (!hasViolation) {
      console.log("\n  ✓ No violations: all Work.ua/Robota.ua sources are vacancy or company_page.");
    } else {
      console.log("\n  ⚠ VIOLATIONS FOUND. Work.ua/Robota.ua must never be reviews or rating.");
      process.exitCode = 1;
    }
  }

  // ── Quality breakdown ────────────────────────────────────────────────────────
  if (reviewError) {
    console.log("\n[quality breakdown] failed to load review sources:", reviewError.message);
  } else {
    console.log("\n" + "=".repeat(64));
    console.log("Review Source Quality Breakdown");
    console.log("=".repeat(64));

    console.log(`\nPublic review sources   : ${publicReviewSources.length} total`);
    console.log(`  excl. Work/Robota     : ${nonWorkRobotaReviews.length}`);
    console.log(`\nQuality distribution:`);
    const total3 = nonWorkRobotaReviews.length || 1;
    console.log(`  ${pad("specific", 12)} ${qualityCounts.specific.toString().padStart(4)}  (${Math.round(qualityCounts.specific / total3 * 100)}%)`);
    console.log(`  ${pad("partial", 12)} ${qualityCounts.partial.toString().padStart(4)}  (${Math.round(qualityCounts.partial / total3 * 100)}%)`);
    console.log(`  ${pad("generic", 12)} ${qualityCounts.generic.toString().padStart(4)}  (${Math.round(qualityCounts.generic / total3 * 100)}%)`);

    if (topGenericCompanies.length > 0) {
      console.log("\nTop companies with most generic review sources:");
      for (const [slug, count] of topGenericCompanies) {
        console.log(`  ${pad(slug, 28)} ${count} generic`);
      }
    }

    if (topRepeatedSummaries.length > 0) {
      console.log("\nTop repeated generic summaries:");
      for (const [summary, count] of topRepeatedSummaries) {
        console.log(`  ${count}x  ${summary.slice(0, 70)}…`);
      }
    }

    if (noUkrainianSummary.length > 0 && noUkrainianSummary.length <= 20) {
      console.log(`\nPublic sources with non-Ukrainian summary (${noUkrainianSummary.length}):`);
      for (const item of noUkrainianSummary.slice(0, 10)) {
        console.log(`  ${pad(item.slug, 20)} ${item.source} — ${item.summary.slice(0, 60)}`);
      }
    } else if (noUkrainianSummary.length > 0) {
      console.log(`\nPublic sources with non-Ukrainian summary: ${noUkrainianSummary.length}`);
    }

    const enrichmentTarget = qualityCounts.generic;
    console.log(`\nEnrichment target (generic): ${enrichmentTarget} sources`);
    if (enrichmentTarget > 0) {
      console.log(`  Run: npm run enrich:external-review-sources -- --dry-run --limit=5`);
      console.log(`  Then: npm run enrich:external-review-sources -- --apply --limit=20`);
    } else {
      console.log("  ✓ All review sources have specific or partial quality.");
    }
  }

  console.log();
}

main().catch((err) => {
  console.error("[check-external-source-health] fatal:", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
