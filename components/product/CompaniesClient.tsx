"use client";

import { useMemo, useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { CompanyCard, CompanyCardSlim } from "@/components/product/CompanyCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { slugifyCompanyName } from "@/lib/slugify";
import { normalizeIndustry } from "@/lib/industry";
import type { CompanyListItem, ReviewMetricsBySlug } from "@/lib/company-service";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  companies: CompanyListItem[];
  cities: string[];
  industries: string[];
  /** Per-slug review metrics from Supabase, computed server-side. */
  metrics: ReviewMetricsBySlug;
}

// ── Search helpers (preserved from previous version) ─────────────────────────

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
        "flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "border-brand-400 bg-brand-50 text-brand-700"
          : "border-ink/12 bg-white text-ink-soft hover:border-brand-200 hover:text-ink"
      )}
    >
      {children}
    </button>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function CompaniesClient({ companies, cities, industries, metrics }: Props) {
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
  // A chip is shown only when at least one company in the current list would
  // satisfy it. We check this once against ALL companies (not filtered), so
  // chips don't disappear while the user is interacting with other filters.
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
      // Search
      if (!matchesSearch(item, rawQuery, slugQuery)) return false;

      // City
      const itemCity = item.data.city ?? "";
      if (city !== "all" && itemCity !== city) return false;

      // Industry (normalized comparison)
      const rawInd =
        item.source === "mock" ? item.data.industry : (item.data.industry ?? "");
      const normInd = normalizeIndustry(rawInd);
      if (industry !== "all" && normInd !== industry) return false;

      // Chip filters — use server-computed metrics
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

  const selectCls = "rounded-lg border border-ink/12 bg-white px-3 py-2 text-sm focus-ring";

  return (
    <div className="container-page py-10">
      <SectionTitle
        eyebrow="Каталог"
        title="Відгуки про роботодавців"
        description="Оберіть компанію, щоб побачити рівень довіри, реальність зарплати та умови оформлення."
      />

      {/* ── Filter panel ─────────────────────────────────────────────────── */}
      <div className="mt-6 space-y-3 rounded-2xl border border-ink/[0.06] bg-white p-4 shadow-card">

        {/* Search */}
        <div className="flex items-center gap-2 rounded-xl border border-ink/10 px-3">
          <Search className="h-4 w-4 shrink-0 text-ink-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Пошук за назвою, сферою або містом"
            className="w-full bg-transparent py-2.5 text-sm focus:outline-none"
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} className="text-ink-muted hover:text-ink">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Selects */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 text-sm text-ink-muted">
            <SlidersHorizontal className="h-4 w-4" />
            <span>Фільтри:</span>
          </div>
          {cities.length > 0 && (
            <select value={city} onChange={(e) => setCity(e.target.value)} className={selectCls}>
              <option value="all">Усі міста</option>
              {cities.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          {industries.length > 0 && (
            <select value={industry} onChange={(e) => setIndustry(e.target.value)} className={selectCls}>
              <option value="all">Усі сфери</option>
              {industries.map((i) => <option key={i} value={i}>{i}</option>)}
            </select>
          )}
        </div>

        {/* Chip filters — only rendered when there's backing data */}
        {(filterAvailability.hasReviews ||
          filterAvailability.hasHighRating ||
          filterAvailability.hasRisky ||
          filterAvailability.hasOfficial ||
          filterAvailability.hasBooking ||
          filterAvailability.hasPaidInternship) && (
          <div className="flex flex-wrap gap-2 border-t border-ink/[0.06] pt-3">
            {filterAvailability.hasReviews && (
              <FilterChip active={onlyWithReviews} onClick={() => setOnlyWithReviews((v) => !v)}>
                Є відгуки
              </FilterChip>
            )}
            {filterAvailability.hasHighRating && (
              <FilterChip active={onlyHighRating} onClick={() => setOnlyHighRating((v) => !v)}>
                Висока оцінка (4+)
              </FilterChip>
            )}
            {filterAvailability.hasOfficial && (
              <FilterChip active={onlyOfficial} onClick={() => setOnlyOfficial((v) => !v)}>
                Офіційне оформлення
              </FilterChip>
            )}
            {filterAvailability.hasBooking && (
              <FilterChip active={onlyBooking} onClick={() => setOnlyBooking((v) => !v)}>
                Підтверджене бронювання
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
          </div>
        )}
      </div>

      {/* ── Result bar ───────────────────────────────────────────────────── */}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">
          Знайдено компаній:{" "}
          <span className="font-semibold text-ink">{filtered.length}</span>
        </p>
        {anyFilterActive && (
          <Button variant="outline" size="sm" onClick={resetFilters}>
            <X className="h-3.5 w-3.5" /> Скинути фільтри
          </Button>
        )}
      </div>

      {/* ── Company list ─────────────────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <EmptyState
          className="mt-4"
          icon={<Search className="h-8 w-8" />}
          title="Нічого не знайдено"
          description="Спробуйте змінити фільтри або пошуковий запит."
          action={
            anyFilterActive ? (
              <Button variant="secondary" onClick={resetFilters}>Скинути фільтри</Button>
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
              />
            ) : (
              <CompanyCardSlim
                key={item.data.id}
                company={item.data}
                metrics={metrics[item.data.slug] ?? null}
              />
            )
          )}
        </div>
      )}
    </div>
  );
}
