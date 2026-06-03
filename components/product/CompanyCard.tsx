import Link from "next/link";
import { MapPin, Briefcase, MessageSquare, ChevronRight, Star } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { normalizeIndustry } from "@/lib/industry";
import type { Company } from "@/lib/types";
import type { SupabaseCompany, ReviewMetrics } from "@/lib/company-service";

// ── Shared inner card ─────────────────────────────────────────────────────────

function CompanyCardInner({
  slug,
  name,
  city,
  industry,
  metrics,
}: {
  slug: string;
  name: string;
  city: string | null;
  industry: string | null;
  metrics?: ReviewMetrics | null;
}) {
  const normIndustry = normalizeIndustry(industry);

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

      {/* Metrics from real published reviews only */}
      {metrics && metrics.reviewCount > 0 ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
          <span className="inline-flex items-center gap-1">
            <MessageSquare className="h-3.5 w-3.5" />
            {metrics.reviewCount}{" "}
            {metrics.reviewCount === 1 ? "відгук" : "відгуків"}
          </span>
          {metrics.averageRating !== null && (
            <span className="inline-flex items-center gap-1">
              <Star className="h-3.5 w-3.5 text-amber-400" />
              {metrics.averageRating.toFixed(1)} / 5
            </span>
          )}
        </div>
      ) : (
        <p className="text-sm text-ink-muted">Поки недостатньо відгуків</p>
      )}

      <div className="flex items-center justify-between gap-3 border-t border-ink/[0.06] pt-4">
        <span className="text-xs text-ink-muted">
          {metrics && metrics.reviewCount > 0
            ? metrics.hasHighRating
              ? "Загалом позитивні відгуки"
              : metrics.hasRisks
              ? "Є сигнали ризику"
              : "Відгуки наявні"
            : "Рівень довіри: недостатньо даних"}
        </span>
        <Button href={`/companies/${slug}`} variant="outline" size="sm">
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
}: {
  company: Company;
  metrics?: ReviewMetrics | null;
}) {
  return (
    <CompanyCardInner
      slug={company.slug}
      name={company.name}
      city={company.city}
      industry={company.industry}
      metrics={metrics}
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
}: {
  company: SupabaseCompany;
  metrics?: ReviewMetrics | null;
}) {
  return (
    <CompanyCardInner
      slug={company.slug}
      name={company.name}
      city={company.city ?? null}
      industry={company.industry ?? null}
      metrics={metrics}
    />
  );
}
