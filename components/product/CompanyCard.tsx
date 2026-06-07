import Link from "next/link";
import { MapPin, Briefcase, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { MetricTile } from "@/components/ui/MetricTile";
import { normalizeIndustry } from "@/lib/industry";
import type { Company } from "@/lib/types";
import type { SupabaseCompany, ReviewMetrics } from "@/lib/company-service";
import type { ExternalRatingSummary } from "@/lib/external-ratings-service";
import type { CompanyOpenFactSummary } from "@/lib/company-open-facts-service";
import type { ExternalReviewSignalSummary } from "@/lib/external-review-signals-service";
import type { ExternalCompanySourceSummary } from "@/lib/external/company-sources";

function formatNumber(value: number): string {
  return new Intl.NumberFormat("uk-UA").format(value);
}

const TOPIC_UA: Record<string, string> = {
  salary: "зарплата",
  schedule: "графік",
  workload: "навантаження",
  employment: "оформлення",
  management: "керівництво",
  payment_delay: "виплати",
};

// ── Shared inner card ─────────────────────────────────────────────────────────

function CompanyCardInner({
  slug,
  name,
  city,
  industry,
  metrics,
  externalRatingSummary,
  externalCompanySourceSummary,
  openFactSummary,
  externalReviewSignalSummary,
}: {
  slug: string;
  name: string;
  city: string | null;
  industry: string | null;
  metrics?: ReviewMetrics | null;
  externalRatingSummary?: ExternalRatingSummary | null;
  externalCompanySourceSummary?: ExternalCompanySourceSummary | null;
  openFactSummary?: CompanyOpenFactSummary | null;
  externalReviewSignalSummary?: ExternalReviewSignalSummary | null;
}) {
  const normIndustry = normalizeIndustry(industry);
  const hasReviews = Boolean(metrics && metrics.reviewCount > 0);
  const hasExternalRatings = Boolean(externalRatingSummary);
  const hasExternalCompanySources = Boolean(externalCompanySourceSummary && externalCompanySourceSummary.sourceCount > 0);
  const hasOpenFacts = Boolean(openFactSummary && openFactSummary.factsCount > 0);
  const hasExternalReviewSignals = Boolean(
    externalReviewSignalSummary && externalReviewSignalSummary.signalCount > 0
  );
  const hasAnyExternalData =
    hasExternalRatings || hasOpenFacts || hasExternalReviewSignals || hasExternalCompanySources;

  // Short label for the analysis badge
  const badgeLabel =
    hasReviews && hasAnyExternalData ? "Відгуки + дані"
    : hasReviews ? "Є відгуки"
    : hasExternalReviewSignals ? "Є сигнали"
    : hasOpenFacts ? "Є вакансії"
    : hasExternalCompanySources ? "Є джерела"
    : hasExternalRatings ? "Є оцінки"
    : "Мало даних";

  const badgeTone: "brand" | "warning" | "muted" =
    hasReviews ? "brand"
    : hasAnyExternalData ? "warning"
    : "muted";

  // Signal topic tags for footer
  const signalTopics = externalReviewSignalSummary?.topics
    .slice(0, 3)
    .map((t) => TOPIC_UA[t] ?? t) ?? [];

  const reviewCount = metrics?.reviewCount ?? 0;
  const sourceCount = externalCompanySourceSummary?.sourceCount ?? 0;
  const avgRating = metrics?.averageRating;

  return (
    <Card className="flex flex-col overflow-hidden transition-shadow hover:shadow-card-hover">
      <div className="h-0.5 bg-gradient-to-r from-brand-500 via-brand-600 to-brand-400" />
      {/* ── Zone 1: Identity ─────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3 px-5 pb-4 pt-5">
        <div className="min-w-0">
          <Link
            href={`/companies/${slug}`}
            className="font-display text-xl font-bold leading-snug text-ink hover:text-brand-700"
          >
            {name}
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {city && (
              <span className="inline-flex items-center gap-1 rounded-full border border-ink/[0.1] bg-ink/[0.025] px-2.5 py-0.5 text-xs text-ink-soft">
                <MapPin className="h-3 w-3" /> {city}
              </span>
            )}
            {normIndustry && (
              <span className="inline-flex items-center gap-1 rounded-full border border-ink/[0.1] bg-ink/[0.025] px-2.5 py-0.5 text-xs text-ink-soft">
                <Briefcase className="h-3 w-3" /> {normIndustry}
              </span>
            )}
          </div>
        </div>
        <Badge tone={badgeTone} className="shrink-0 whitespace-nowrap">
          {badgeLabel}
        </Badge>
      </div>

      {/* ── Zone 2: Metrics ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-2 border-t border-ink/[0.06] bg-ink/[0.015] px-5 py-4">
        <MetricTile
          label="Відгуки"
          value={formatNumber(reviewCount)}
          accent={hasReviews}
        />
        <MetricTile
          label="Джерела"
          value={sourceCount}
          accent={hasExternalCompanySources}
        />
        <MetricTile
          label="Рейтинг"
          value={avgRating != null ? avgRating.toFixed(1) : "—"}
          accent={hasReviews && avgRating != null}
          sub={avgRating != null ? "/ 5" : undefined}
        />
      </div>

      {/* ── Zone 3: Signals + CTA ────────────────────────────────────────── */}
      <div className="mt-auto flex items-center justify-between gap-3 border-t border-brand-100/60 bg-brand-50/30 px-5 py-3">
        <div className="flex min-w-0 flex-wrap gap-1.5">
          {signalTopics.map((topic) => (
            <span
              key={topic}
              className="rounded-full border border-ink/[0.08] bg-white px-2 py-0.5 text-xs text-ink-soft"
            >
              {topic}
            </span>
          ))}
        </div>
        <Button href={`/companies/${slug}`} variant="primary" size="sm" className="shrink-0">
          Переглянути <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </Card>
  );
}

// ── Public exports ────────────────────────────────────────────────────────────

export function CompanyCard({
  company,
  metrics,
  externalRatingSummary,
  externalCompanySourceSummary,
  openFactSummary,
  externalReviewSignalSummary,
}: {
  company: Company;
  metrics?: ReviewMetrics | null;
  externalRatingSummary?: ExternalRatingSummary | null;
  externalCompanySourceSummary?: ExternalCompanySourceSummary | null;
  openFactSummary?: CompanyOpenFactSummary | null;
  externalReviewSignalSummary?: ExternalReviewSignalSummary | null;
}) {
  return (
    <CompanyCardInner
      slug={company.slug}
      name={company.name}
      city={company.city}
      industry={company.industry}
      metrics={metrics}
      externalRatingSummary={externalRatingSummary}
      externalCompanySourceSummary={externalCompanySourceSummary}
      openFactSummary={openFactSummary}
      externalReviewSignalSummary={externalReviewSignalSummary}
    />
  );
}

export function CompanyCardSlim({
  company,
  metrics,
  externalRatingSummary,
  externalCompanySourceSummary,
  openFactSummary,
  externalReviewSignalSummary,
}: {
  company: SupabaseCompany;
  metrics?: ReviewMetrics | null;
  externalRatingSummary?: ExternalRatingSummary | null;
  externalCompanySourceSummary?: ExternalCompanySourceSummary | null;
  openFactSummary?: CompanyOpenFactSummary | null;
  externalReviewSignalSummary?: ExternalReviewSignalSummary | null;
}) {
  return (
    <CompanyCardInner
      slug={company.slug}
      name={company.name}
      city={company.city ?? null}
      industry={company.industry ?? null}
      metrics={metrics}
      externalRatingSummary={externalRatingSummary}
      externalCompanySourceSummary={externalCompanySourceSummary}
      openFactSummary={openFactSummary}
      externalReviewSignalSummary={externalReviewSignalSummary}
    />
  );
}
