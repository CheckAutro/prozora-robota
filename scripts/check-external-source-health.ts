import { loadEnvConfig } from "@next/env";
import { getServiceClient } from "@/lib/supabase/server";

loadEnvConfig(process.cwd());

const AUTO_PUBLISH_MARKER = "Auto-published from external discovery";

async function main() {
  const client = getServiceClient();

  // Load all rows (table is expected to stay under a few thousand rows)
  const { data: rows, error } = await client
    .from("external_company_sources")
    .select("id, company_slug, source_type, status, is_public, source_url, admin_note");

  if (error) {
    console.error("Failed to query external_company_sources:", error.message);
    process.exitCode = 1;
    return;
  }

  const all = (rows ?? []) as Array<{
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

  // Work.ua / Robota.ua sources breakdown
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

  const pad = (s: string, n: number) => s.padEnd(n, " ");

  console.log("=".repeat(60));
  console.log("External Source Health Report");
  console.log("=".repeat(60));

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

  console.log("\nTop 10 companies by source count:");
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

  console.log();
}

main().catch((err) => {
  console.error("[check-external-source-health] fatal:", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
