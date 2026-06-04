import { Suspense } from "react";
import type { Metadata } from "next";
import { CompaniesClient } from "@/components/product/CompaniesClient";
import {
  getCompanyList,
  getCitiesFromList,
  getIndustriesFromList,
  getPublishedReviewMetrics,
} from "@/lib/company-service";
import { getPublicExternalRatingSummaries } from "@/lib/external-ratings-service";

export const metadata: Metadata = {
  title: "Відгуки про роботодавців — Прозора робота",
  description:
    "Каталог роботодавців з рівнем довіри, бронюванням та реальністю зарплати в Україні.",
};

// Revalidate every 5 minutes so new companies and reviews appear without
// a full redeploy, but the page is still served from cache between fetches.
export const revalidate = 300;

export default async function CompaniesPage() {
  // Fetch companies, internal review metrics, and external rating summaries in parallel.
  const [companies, metrics, externalRatingSummaries] = await Promise.all([
    getCompanyList(),
    getPublishedReviewMetrics(),
    getPublicExternalRatingSummaries(),
  ]);

  const cities = getCitiesFromList(companies);
  const industries = getIndustriesFromList(companies);

  return (
    <Suspense fallback={<div className="container-page py-10 text-ink-muted">Завантаження…</div>}>
      <CompaniesClient
        companies={companies}
        cities={cities}
        industries={industries}
        metrics={metrics}
        externalRatingSummaries={externalRatingSummaries}
      />
    </Suspense>
  );
}
