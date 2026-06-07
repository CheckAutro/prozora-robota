import Link from "next/link";
import { MapPin, Briefcase, MessageSquare, ChevronRight, Star, FileText, MessageSquareText } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
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

function formatReviewWord(count: number): string {
  if (count === 1) return "відгук";
  if (count >= 2 && count <= 4) return "відгуки";
  return "відгуків";
}

function formatSourceWord(count: number): string {
  if (count === 1) return "джерело";
  if (count >= 2 && count <= 4) return "джерела";
  return "джерел";
}

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
  const externalSources = externalRatingSummary?.sources.join(" · ") ?? "";
  const externalDetails = externalRatingSummary
    ? [
        externalRatingSummary.averageRating !== null
          ? `${externalRatingSummary.averageRating.toFixed(1)} / 5`
          : null,
        externalSources || `${externalRatingSummary.sourceCount} ${formatSourceWord(externalRatingSummary.sourceCount)}`,
        externalRatingSummary.totalRatingsCount !== null
          ? `${formatNumber(externalRatingSummary.totalRatingsCount)} оцінок`
          : externalSources
            ? `${externalRatingSummary.sourceCount} ${formatSourceWord(externalRatingSummary.sourceCount)}`
            : null,
      ].filter(Boolean).join(" · ")
    : null;
  const sourceDetails = externalCompanySourceSummary
    ? [
        externalCompanySourceSummary.sourceCount > 0
          ? `${externalCompanySourceSummary.sourceCount} ${formatSourceWord(externalCompanySourceSummary.sourceCount)}`
          : null,
        externalCompanySourceSummary.sources.length > 0
          ? externalCompanySourceSummary.sources.slice(0, 3).join(" · ")
          : null,
      ].filter(Boolean).join(" · ")
    : null;
  const hasReviews = Boolean(metrics && metrics.reviewCount > 0);
  const hasExternalRatings = Boolean(externalRatingSummary);
  const hasExternalCompanySources = Boolean(externalCompanySourceSummary && externalCompanySourceSummary.sourceCount > 0);
  const hasOpenFacts = Boolean(openFactSummary && openFactSummary.factsCount > 0);
  const hasExternalReviewSignals = Boolean(
    externalReviewSignalSummary && externalReviewSignalSummary.signalCount > 0
  );
  const vacancyDetails = hasOpenFacts
    ? [
        openFactSummary?.sources.length ? openFactSummary.sources.slice(0, 3).join(" / ") : null,
        `${openFactSummary?.factsCount ?? 0} вакансій`,
      ].filter(Boolean).join(" · ")
    : null;
  const hasAnyExternalData = hasExternalRatings || hasOpenFacts || hasExternalReviewSignals || hasExternalCompanySources;
  const analysisText = hasReviews && hasAnyExternalData
    ? "є відгуки та відкриті джерела"
    : hasReviews
      ? "є відгуки на Прозора робота"
      : hasExternalReviewSignals
        ? "є зовнішні сигнали, але мало відгуків"
        : hasOpenFacts
          ? "є дані з відкритих вакансій, але мало відгуків"
          : hasExternalCompanySources
            ? "є зовнішні джерела, але мало відгуків"
          : hasExternalRatings
            ? "є зовнішні оцінки, але мало відгуків"
            : "поки недостатньо даних";
  const signalDetails = hasExternalReviewSignals
    ? externalReviewSignalSummary?.topics.length
      ? externalReviewSignalSummary.topics
          .slice(0, 3)
          .map((topic) => {
            if (topic === "salary") return "зарплата";
            if (topic === "schedule") return "графік";
            if (topic === "workload") return "навантаження";
            if (topic === "employment") return "оформлення";
            if (topic === "management") return "керівництво";
            if (topic === "payment_delay") return "виплати";
            return "інші теми";
          })
          .join(" · ")
      : "є згадки з відкритих джерел"
    : null;

  return (
    <Card className="flex flex-col gap-4 p-5 transition-shadow hover:shadow-card-hover">
      <div className="min-w-0">
        <Link
          href={`/companies/${slug}`}
          className="font-display text-lg font-bold text-ink hover:text-brand-700"
        >
          {name}
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-soft">
          {city && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" /> {city}
            </span>
          )}
          {normIndustry && (
            <span className="inline-flex items-center gap-1">
              <Briefcase className="h-3.5 w-3.5" /> {normIndustry}
            </span>
          )}
        </div>
      </div>

      <div className="space-y-2 rounded-xl bg-ink/[0.025] px-3 py-3 text-sm">
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-ink-soft">
          <span className="inline-flex items-center gap-1 font-semibold text-ink">
            <MessageSquare className="h-3.5 w-3.5 text-brand-600" />
            Прозора робота:
          </span>
          {metrics && metrics.reviewCount > 0 && metrics.averageRating !== null ? (
            <span>
              {metrics.averageRating.toFixed(1)} / 5 · {formatNumber(metrics.reviewCount)} {formatReviewWord(metrics.reviewCount)}
            </span>
          ) : (
            <span>недостатньо відгуків</span>
          )}
        </p>

        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-ink-soft">
          <span className="inline-flex items-center gap-1 font-semibold text-ink">
            <Star className="h-3.5 w-3.5 text-amber-400" />
            Відкриті джерела:
          </span>
          {sourceDetails ? (
            <span>{sourceDetails}</span>
          ) : (
            <span>поки немає підтверджених джерел</span>
          )}
        </p>

        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-ink-soft">
          <span className="inline-flex items-center gap-1 font-semibold text-ink">
            <Star className="h-3.5 w-3.5 text-brand-600" />
            Оцінки з відкритих джерел:
          </span>
          {externalDetails ? (
            <span>{externalDetails}</span>
          ) : (
            <span>поки немає підтверджених оцінок</span>
          )}
        </p>

        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-ink-soft">
          <span className="inline-flex items-center gap-1 font-semibold text-ink">
            <MessageSquareText className="h-3.5 w-3.5 text-brand-600" />
            Сигнали:
          </span>
          {signalDetails ? <span>{signalDetails}</span> : <span>поки недостатньо даних</span>}
        </p>

        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-ink-soft">
          <span className="inline-flex items-center gap-1 font-semibold text-ink">
            <FileText className="h-3.5 w-3.5 text-brand-600" />
            Вакансії:
          </span>
          {vacancyDetails ? <span>{vacancyDetails}</span> : <span>даних поки немає</span>}
        </p>

        <p className="text-xs text-ink-muted">
          Зовнішні оцінки не впливають на рейтинг Прозора робота.
        </p>

        <p className="text-xs font-medium text-ink-soft">
          <span className="font-semibold text-ink">Аналіз:</span> {analysisText}
        </p>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-ink/[0.06] pt-4">
        <span className="text-xs text-ink-muted">Деталі доступні на сторінці компанії.</span>
        <Button href={`/companies/${slug}`} variant="primary" size="sm">
          Переглянути <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </Card>
  );
}

// ── Public exports ────────────────────────────────────────────────────────────

/**
 * Card for companies from the mock-data list.
 * Shows ONLY real metrics from Supabase (passed via metrics prop).
 * Never renders synthetic indices or counts from mock-data.
 */
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

/**
 * Card for Supabase-only companies (no mock entry).
 * Same visual — accepts optional metrics from server.
 */
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
