// scripts/bulk-enrich-companies.ts
// Full company enrichment currently delegates to the conservative vacancy discovery flow.
// It never writes reviews, external ratings, or external review signals.

import { pathToFileURL } from "node:url";
import { runBulkVacancyDiscovery } from "./bulk-discover-vacancies";

export async function runBulkCompanyEnrichment(argv = process.argv.slice(2)) {
  await runBulkVacancyDiscovery(argv);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runBulkCompanyEnrichment().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
