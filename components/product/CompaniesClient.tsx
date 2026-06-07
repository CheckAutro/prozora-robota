"use client";

import { useMemo, useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { CompanyCard, CompanyCardSlim } from "@/components/product/CompanyCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { slugifyCompanyName } from "@/lib/slugify";
import { normalizeIndustry } from "@/lib/industry";
import type { CompanyListItem, ReviewMetricsBySlug } from "@/lib/company-service";
import type { ExternalRatingSummaryBySlug } from "@/lib/external-ratings-service";
import type { CompanyOpenFactSummaryBySlug } from "@/lib/company-open-facts-service";
import type { ExternalReviewSignalSummaryBySlug } from "@/lib/external-review-signals-service";
import type { ExternalCompanySourceSummaryBySlug } from "@/lib/external/company-sources";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  companies: CompanyListItem[];
  cities: string[];
  industries: string[];
  metrics: ReviewMetricsBySlug;
  externalRatingSummaries: ExternalRatingSummaryBySlug;
  openFactSummaries: CompanyOpenFactSummaryBySlug;
  externalReviewSignalSummaries: ExternalReviewSignalSummaryBySlug;
  externalCompanySourceSummaries: ExternalCompanySourceSummaryBySlug;
}

// ── Search helpers ─────────────────────────────────────────────────────────────

function wordStartsWith(text: string, q: string): boolean {
  if (!q) return false;
  return text.split(/[\s\-_/]+/).some((w) => w.startsWith(q));
}

function slugTokenMatch(qSlug: string, cSlug: string): boolean {
  if (!qSlug) return false;
  if (cSlug === qSlug || cSlug.startsWith(qSlug + "-")) return true;
  const qTokens = qSlug.split("-").filter(Boolean);
  const cTokens = cSlug.split("-").filter(Boolean);
  return qTokens.every((qt) => cTokens.some((ct) => ct.startsWith(qt)));
}

function matchesSearch(item: CompanyListItem, rawQuery: string, slugQuery: string): boolean {
  if (!rawQuery) return true;
  const name = (item.data.name ?? "").toLowerCase();
  const city = (item.data.city ?? "").toLowerCase();
  const rawIndustry =
    item.source === "mock" ? item.data.industry : (item.data.industry ?? "");
  const industry = normalizeIndustry(rawIndustry).toLowerCase();
  const companySlug = (item.data.slug ?? "").toLowerCase();

  if (wordStartsWith(name, rawQuery)) return true;
  if (city.includes(rawQuery) || industry.includes(rawQuery)) return true;
  if (slugQuery) {
    const citySlug = slugifyCompanyName(city);
    const industrySlug = slugifyCompanyName(industry);
    if (citySlug.includes(slugQuery) || industrySlug.includes(slugQuery)) return true;
  }
  if (slugQuery && slugTokenMatch(slugQuery, slugifyCompanyName(name))) return true;
  if (slugTokenMatch(rawQuery, companySlug)) return true;
  if (slugQuery && slugTokenMatch(slugQuery, companySlug)) return true;
  return false;
}

// ── FilterChip ────────────────────────────────────────────────────────────────

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
        active
          ? "border-brand-400 bg-brand-50 text-brand-700"
          : "border-ink/[0.12] bg-white text-ink-soft hover:border-brand-200 hover:text-ink"
      )}
    >
      {children}
    </button>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function CompaniesClient({
  companies,
  cities,
  industries,
  metrics,
  externalRatingSummaries,
  openFactSummaries,
  externalReviewSignalSummaries,
  externalCompanySourceSummaries,
}: Props) {
  const [query, setQuery]                           = useState("");
  const [city, setCity]                             = useState("all");
  const [industry, setIndustry]                     = useState("all");
  const [onlyWithReviews, setOnlyWithReviews]       = useState(false);
  const [onlyHighRating, setOnlyHighRating]         = useState(false);
  const [onlyRisky, setOnlyRisky]                   = useState(false);
  const [onlyOfficial, setOnlyOfficial]             = useState(false);
  const [onlyBooking, setOnlyBooking]               = useState(false);
  const [onlyPaidInternship, setOnlyPaidInternship] = useState(false);

  // ── Filter availability ───────────────────────────────────────────────────
  const filterAvailability = useMemo(() => {
    let hasReviews = false;
    let hasHighRating = false;
    let hasRisky = false;
    let hasOfficial = false;
    let hasBooking = false;
    let hasPaidInternship = false;

    for (const item of companies) {
      const m = metrics[item.data.slug ?? ""];
      if (!m) continue;
      if (m.reviewCount > 0) hasReviews = true;
      if (m.hasHighRating) hasHighRating = true;
      if (m.hasRisks) hasRisky = true;
      if (m.hasOfficialEmployment) hasOfficial = true;
      if (m.hasBooking) hasBooking = true;
      if (m.hasPaidInternship) hasPaidInternship = true;
    }
    return { hasReviews, hasHighRating, hasRisky, hasOfficial, hasBooking, hasPaidInternship };
  }, [companies, metrics]);

  const anyFilterActive =
    query !== "" ||
    city !== "all" ||
    industry !== "all" ||
    onlyWithReviews ||
    onlyHighRating ||
    onlyRisky ||
    onlyOfficial ||
    onlyBooking ||
    onlyPaidInternship;

  function resetFilters() {
    setQuery("");
    setCity("all");
    setIndustry("all");
    setOnlyWithReviews(false);
    setOnlyHighRating(false);
    setOnlyRisky(false);
    setOnlyOfficial(false);
    setOnlyBooking(false);
    setOnlyPaidInternship(false);
  }

  // ── Filtering ─────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const rawQuery = query.trim().toLowerCase();
    const slugQuery = rawQuery ? slugifyCompanyName(rawQuery) : "";

    return companies.filter((item) => {
      if (!matchesSearch(item, rawQuery, slugQuery)) return false;

      const itemCity = item.data.city ?? "";
      if (city !== "all" && itemCity !== city) return false;

      const rawInd =
        item.source === "mock" ? item.data.industry : (item.data.industry ?? "");
      const normInd = normalizeIndustry(rawInd);
      if (industry !== "all" && normInd !== industry) return false;

      const m = metrics[item.data.slug ?? ""];
      if (onlyWithReviews && (!m || m.reviewCount === 0)) return false;
      if (onlyHighRating && (!m || !m.hasHighRating)) return false;
      if (onlyRisky && (!m || !m.hasRisks)) return false;
      if (onlyOfficial && (!m || !m.hasOfficialEmployment)) return false;
      if (onlyBooking && (!m || !m.hasBooking)) return false;
      if (onlyPaidInternship && (!m || !m.hasPaidInternship)) return false;

      return true;
    });
  }, [
    companies, metrics, query, city, industry,
    onlyWithReviews, onlyHighRating, onlyRisky,
    onlyOfficial, onlyBooking, onlyPaidInternship,
  ]);

  const selectCls =
    "rounded-lg border border-ink/[0.12] bg-white px-3 py-1.5 text-xs text-ink-soft focus-ring";

  const hasChips =
    filterAvailability.hasReviews ||
    filterAvailability.hasHighRating ||
    filterAvailability.hasRisky ||
    filterAvailability.hasOfficial ||
    filterAvailability.hasBooking ||
    filterAvailability.hasPaidInternship;

  return (
    <div className="container-page py-10">

      {/* ── Hero search zone ──────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-2xl border border-ink/[0.08] bg-white shadow-card-elevated">

        {/* Header: eyebrow + title + search */}
        <div className="px-6 pb-5 pt-6">
          <p className="text-[0.6875rem] font-semibold uppercase tracking-widest text-brand-600">
            Каталог
          </p>
          <h1 className="mt-1.5 font-display text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
            Відгуки про роботодавців
          </h1>
          <p className="mt-1.5 max-w-lg text-sm text-ink-soft">
            Перевірте умови роботи, зарплату та оформлення ще до співбесіди.
          </p>

          {/* Search input */}
          <div className="mt-4 flex items-center gap-3 rounded-xl border-2 border-ink/[0.15] bg-ink/[0.02] px-4 py-3 transition-all focus-within:border-brand-400 focus-within:bg-white focus-within:shadow-glow-brand">
            <Search className="h-5 w-5 shrink-0 text-ink-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Назва компанії, сфера або місто"
              className="w-full bg-transparent text-base focus:outline-none placeholder:text-ink-muted/60"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="text-ink-muted hover:text-ink"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* Filter toolbar */}
        <div className="flex flex-wrap items-center gap-2 border-t border-ink/[0.06] bg-ink/[0.015] px-6 py-3">
          <span className="flex items-center gap-1.5 text-xs text-ink-muted">
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Фільтри:
          </span>
          {cities.length > 0 && (
            <select
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className={selectCls}
            >
              <option value="all">Усі міста</option>
              {cities.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          {industries.length > 0 && (
            <select
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              className={selectCls}
            >
              <option value="all">Усі сфери</option>
              {industries.map((i) => <option key={i} value={i}>{i}</option>)}
            </select>
          )}
          {hasChips && (
            <>
              {filterAvailability.hasReviews && (
                <FilterChip active={onlyWithReviews} onClick={() => setOnlyWithReviews((v) => !v)}>
                  Є відгуки
                </FilterChip>
              )}
              {filterAvailability.hasHighRating && (
                <FilterChip active={onlyHighRating} onClick={() => setOnlyHighRating((v) => !v)}>
                  Оцінка 4+
                </FilterChip>
              )}
              {filterAvailability.hasOfficial && (
                <FilterChip active={onlyOfficial} onClick={() => setOnlyOfficial((v) => !v)}>
                  Офіційне оформлення
                </FilterChip>
              )}
              {filterAvailability.hasBooking && (
                <FilterChip active={onlyBooking} onClick={() => setOnlyBooking((v) => !v)}>
                  Бронювання
                </FilterChip>
              )}
              {filterAvailability.hasPaidInternship && (
                <FilterChip active={onlyPaidInternship} onClick={() => setOnlyPaidInternship((v) => !v)}>
                  Оплачуване стажування
                </FilterChip>
              )}
              {filterAvailability.hasRisky && (
                <FilterChip active={onlyRisky} onClick={() => setOnlyRisky((v) => !v)}>
                  Можливі ризики
                </FilterChip>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Result bar ───────────────────────────────────────────────────── */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-ink-muted">Знайдено</span>
          <span className="inline-flex items-center rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-sm font-bold tabular-nums text-brand-700">
            {filtered.length} {filtered.length === 1 ? "компанія" : filtered.length < 5 ? "компанії" : "компаній"}
          </span>
        </div>
        {anyFilterActive && (
          <Button variant="outline" size="sm" onClick={resetFilters}>
            <X className="h-3.5 w-3.5" /> Скинути фільтри
          </Button>
        )}
      </div>

      {/* ── Company grid ─────────────────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <EmptyState
          className="mt-4"
          icon={<Search className="h-8 w-8" />}
          title="Нічого не знайдено"
          description="Спробуйте змінити фільтри або пошуковий запит."
          action={
            anyFilterActive ? (
              <Button variant="outline" onClick={resetFilters}>Скинути фільтри</Button>
            ) : undefined
          }
        />
      ) : (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {filtered.map((item) =>
            item.source === "mock" ? (
              <CompanyCard
                key={item.data.id}
                company={item.data}
                metrics={metrics[item.data.slug] ?? null}
                externalRatingSummary={externalRatingSummaries[item.data.slug] ?? null}
                externalCompanySourceSummary={externalCompanySourceSummaries[item.data.slug] ?? null}
                openFactSummary={openFactSummaries[item.data.slug] ?? null}
                externalReviewSignalSummary={externalReviewSignalSummaries[item.data.slug] ?? null}
              />
            ) : (
              <CompanyCardSlim
                key={item.data.id}
                company={item.data}
                metrics={metrics[item.data.slug] ?? null}
                externalRatingSummary={externalRatingSummaries[item.data.slug] ?? null}
                externalCompanySourceSummary={externalCompanySourceSummaries[item.data.slug] ?? null}
                openFactSummary={openFactSummaries[item.data.slug] ?? null}
                externalReviewSignalSummary={externalReviewSignalSummaries[item.data.slug] ?? null}
              />
            )
          )}
        </div>
      )}
    </div>
  );
}
