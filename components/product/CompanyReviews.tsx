"use client";

import { useEffect, useState, useMemo } from "react";
import {
  MessageSquare, MapPin, Briefcase, Calendar, Star,
  AlertTriangle, CheckCircle2, X, SlidersHorizontal,
} from "lucide-react";
import { ReviewCard } from "@/components/product/ReviewCard";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";
import { getPublishedReviewsForCompany } from "@/lib/storage";
import type { Review, ReviewType } from "@/lib/types";

// ── Helpers ───────────────────────────────────────────────────────────────────

const RATING_KEYS = ["salary", "schedule", "management", "conditions", "honesty"] as const;
type RatingKey = (typeof RATING_KEYS)[number];

const RATING_LABEL: Record<RatingKey, string> = {
  salary:     "Зарплата",
  schedule:   "Графік",
  management: "Керівництво",
  conditions: "Умови",
  honesty:    "Чесність вакансії",
};

const TYPE_LABEL: Record<ReviewType, string> = {
  employee:  "Працівник",
  interview: "Співбесіда",
  internship: "Стажування",
  applicant: "Кандидат",
};

function safeAvg(nums: number[]): number | null {
  const valid = nums.filter((n) => typeof n === "number" && !isNaN(n));
  if (!valid.length) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

function StarBar({ value, max = 5 }: { value: number; max?: number }) {
  const pct = Math.round((value / max) * 100);
  const color =
    value >= 4 ? "bg-brand-500" : value >= 3 ? "bg-amber-400" : "bg-red-400";
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 overflow-hidden rounded-full bg-ink/[0.08]">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-6 text-right text-xs font-semibold text-ink">
        {value.toFixed(1)}
      </span>
    </div>
  );
}

// ── Ratings block ─────────────────────────────────────────────────────────────

function RatingsBlock({ reviews }: { reviews: Review[] }) {
  const perField = useMemo(() => {
    return RATING_KEYS.map((key) => {
      const vals = reviews
        .map((r) => r.ratings?.[key])
        .filter((v): v is number => typeof v === "number" && !isNaN(v));
      return { key, avg: safeAvg(vals) };
    }).filter((x) => x.avg !== null) as { key: RatingKey; avg: number }[];
  }, [reviews]);

  if (!perField.length) {
    return (
      <p className="text-sm text-ink-muted">Поки що недостатньо оцінок для висновків.</p>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {perField.map(({ key, avg }) => (
        <div key={key} className="flex items-center justify-between gap-3">
          <span className="text-sm text-ink-soft">{RATING_LABEL[key]}</span>
          <StarBar value={avg} />
        </div>
      ))}
    </div>
  );
}

// ── Risk signals block ────────────────────────────────────────────────────────

function RisksBlock({ reviews }: { reviews: Review[] }) {
  const risks = useMemo(() => {
    return RATING_KEYS.filter((key) => {
      const vals = reviews
        .map((r) => r.ratings?.[key])
        .filter((v): v is number => typeof v === "number" && !isNaN(v));
      const a = safeAvg(vals);
      return a !== null && a <= 2;
    });
  }, [reviews]);

  if (!reviews.length) return null;

  if (!risks.length) {
    return (
      <div className="flex items-center gap-2 text-sm text-brand-700">
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        Критичних сигналів за відгуками поки не видно.
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {risks.map((key) => (
        <li key={key} className="flex items-start gap-2 text-sm text-ink-soft">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          {`Є відгуки з низькою оцінкою ${RATING_LABEL[key].toLowerCase()}`}
        </li>
      ))}
    </ul>
  );
}

// ── Geo & roles block ─────────────────────────────────────────────────────────

function GeoRolesBlock({ reviews }: { reviews: Review[] }) {
  const cities = useMemo(
    () => Array.from(new Set(reviews.map((r) => r.city).filter(Boolean))).sort(),
    [reviews]
  );
  const roles = useMemo(
    () =>
      Array.from(new Set(reviews.map((r) => r.roleCategory).filter(Boolean)))
        .slice(0, 6),
    [reviews]
  );
  const types = useMemo(
    () => Array.from(new Set(reviews.map((r) => r.type).filter(Boolean))),
    [reviews]
  );

  if (!cities.length && !roles.length) return null;

  return (
    <div className="space-y-2 text-sm text-ink-soft">
      {cities.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <MapPin className="h-4 w-4 shrink-0 text-brand-600" />
          <span className="font-medium text-ink">Міста:</span>
          {cities.map((c) => (
            <span key={c} className="rounded-md bg-ink/[0.05] px-2 py-0.5 text-xs">{c}</span>
          ))}
        </div>
      )}
      {roles.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Briefcase className="h-4 w-4 shrink-0 text-brand-600" />
          <span className="font-medium text-ink">Посади:</span>
          {roles.map((r) => (
            <span key={r} className="rounded-md bg-ink/[0.05] px-2 py-0.5 text-xs">{r}</span>
          ))}
        </div>
      )}
      {types.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <MessageSquare className="h-4 w-4 shrink-0 text-brand-600" />
          <span className="font-medium text-ink">Тип досвіду:</span>
          {types.map((t) => (
            <span key={t} className="rounded-md bg-ink/[0.05] px-2 py-0.5 text-xs">
              {TYPE_LABEL[t as ReviewType] ?? t}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Filter bar ────────────────────────────────────────────────────────────────

interface ReviewFilters {
  city: string;
  role: string;
  type: string;
  year: string;
}

const EMPTY_FILTERS: ReviewFilters = { city: "", role: "", type: "", year: "" };

function FilterBar({
  reviews,
  filters,
  onChange,
}: {
  reviews: Review[];
  filters: ReviewFilters;
  onChange: (f: ReviewFilters) => void;
}) {
  const cities = useMemo(
    () => Array.from(new Set(reviews.map((r) => r.city).filter(Boolean))).sort(),
    [reviews]
  );
  const roles = useMemo(
    () => Array.from(new Set(reviews.map((r) => r.roleCategory).filter(Boolean))).sort(),
    [reviews]
  );
  const types = useMemo(
    () => Array.from(new Set(reviews.map((r) => r.type).filter(Boolean))).sort(),
    [reviews]
  );
  const years = useMemo(
    () =>
      Array.from(new Set(reviews.map((r) => String(r.year)).filter(Boolean))).sort(
        (a, b) => Number(b) - Number(a)
      ),
    [reviews]
  );

  const hasFilters = Object.values(filters).some(Boolean);
  const selectCls =
    "rounded-lg border border-ink/12 bg-white px-2.5 py-1.5 text-xs focus-ring";

  // Only show filter bar if there's at least 2 options in some dimension
  if (cities.length < 2 && roles.length < 2 && types.length < 2 && years.length < 2) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <SlidersHorizontal className="h-3.5 w-3.5 text-ink-muted" />
      {cities.length >= 2 && (
        <select
          value={filters.city}
          onChange={(e) => onChange({ ...filters, city: e.target.value })}
          className={selectCls}
        >
          <option value="">Усі міста</option>
          {cities.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      )}
      {roles.length >= 2 && (
        <select
          value={filters.role}
          onChange={(e) => onChange({ ...filters, role: e.target.value })}
          className={selectCls}
        >
          <option value="">Усі посади</option>
          {roles.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      )}
      {types.length >= 2 && (
        <select
          value={filters.type}
          onChange={(e) => onChange({ ...filters, type: e.target.value })}
          className={selectCls}
        >
          <option value="">Будь-який тип</option>
          {types.map((t) => (
            <option key={t} value={t}>{TYPE_LABEL[t as ReviewType] ?? t}</option>
          ))}
        </select>
      )}
      {years.length >= 2 && (
        <select
          value={filters.year}
          onChange={(e) => onChange({ ...filters, year: e.target.value })}
          className={selectCls}
        >
          <option value="">Будь-який рік</option>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      )}
      {hasFilters && (
        <button
          type="button"
          onClick={() => onChange(EMPTY_FILTERS)}
          className="inline-flex items-center gap-1 rounded-lg border border-ink/12 px-2.5 py-1.5 text-xs text-ink-muted hover:text-ink"
        >
          <X className="h-3 w-3" /> Скинути
        </button>
      )}
    </div>
  );
}

// ── CompanyReviews (for mock companies, merges stored + mock reviews) ──────────

export function CompanyReviews({
  companySlug,
}: {
  companySlug: string;
}) {
  const [stored, setStored] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getPublishedReviewsForCompany(companySlug).then((reviews) => {
      if (!cancelled) { setStored(reviews); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [companySlug]);

  if (loading) return <p className="text-sm text-ink-muted">Завантаження відгуків…</p>;
  if (!stored.length) return null;

  return (
    <div className="space-y-4">
      {stored.map((r) => <ReviewCard key={r.id} review={r} />)}
    </div>
  );
}

// ── CompanyReviewsSection (for Supabase-only companies) ──────────────────────

export function CompanyReviewsSection({
  companySlug,
  companyName,
}: {
  companySlug: string;
  companyName: string;
}) {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<ReviewFilters>(EMPTY_FILTERS);

  useEffect(() => {
    let cancelled = false;
    getPublishedReviewsForCompany(companySlug).then((data) => {
      if (!cancelled) { setReviews(data); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [companySlug]);

  const addReviewHref = `/add-review?company=${encodeURIComponent(companySlug)}`;

  // ── Computed summary values ──────────────────────────────────────────────
  const overallAvg = useMemo(() => {
    if (!reviews.length) return null;
    const allVals = reviews.flatMap((r) =>
      RATING_KEYS.map((k) => r.ratings?.[k]).filter(
        (v): v is number => typeof v === "number" && !isNaN(v)
      )
    );
    return safeAvg(allVals);
  }, [reviews]);

  const latestYear = useMemo(
    () => (reviews.length ? Math.max(...reviews.map((r) => r.year)) : null),
    [reviews]
  );

  // ── Filtered list ────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return reviews.filter((r) => {
      if (filters.city && r.city !== filters.city) return false;
      if (filters.role && r.roleCategory !== filters.role) return false;
      if (filters.type && r.type !== filters.type) return false;
      if (filters.year && String(r.year) !== filters.year) return false;
      return true;
    });
  }, [reviews, filters]);

  if (loading) return <p className="text-sm text-ink-muted">Завантаження відгуків…</p>;

  // ── Empty state ──────────────────────────────────────────────────────────
  if (!reviews.length) {
    return (
      <Card className="space-y-4 p-6 text-center">
        <MessageSquare className="mx-auto h-10 w-10 text-brand-200" />
        <div>
          <p className="font-semibold text-ink">
            На Прозора робота ще немає опублікованих відгуків про цю компанію.
          </p>
          <p className="mt-1 text-sm text-ink-soft">
            Ваш досвід допоможе іншим кандидатам.
          </p>
        </div>
        <Button href={addReviewHref} variant="primary">
          Залишити перший відгук
        </Button>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Summary strip ──────────────────────────────────────────────── */}
      <Card className="p-5">
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          <div className="flex items-center gap-2 text-sm">
            <MessageSquare className="h-4 w-4 text-brand-600" />
            <span className="text-ink-soft">Відгуків:</span>
            <span className="font-semibold text-ink">{reviews.length}</span>
          </div>
          {overallAvg !== null && (
            <div className="flex items-center gap-2 text-sm">
              <Star className="h-4 w-4 text-amber-400" />
              <span className="text-ink-soft">Середня оцінка:</span>
              <span className="font-semibold text-ink">{overallAvg.toFixed(1)} / 5</span>
            </div>
          )}
          {latestYear && (
            <div className="flex items-center gap-2 text-sm">
              <Calendar className="h-4 w-4 text-brand-600" />
              <span className="text-ink-soft">Останній відгук:</span>
              <span className="font-semibold text-ink">{latestYear}</span>
            </div>
          )}
        </div>
      </Card>

      {/* ── Ratings + Risks (2-col on desktop) ─────────────────────────── */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="space-y-3 p-5">
          <h3 className="text-sm font-semibold text-ink">Що показують відгуки</h3>
          <RatingsBlock reviews={reviews} />
        </Card>
        <Card className="space-y-3 p-5">
          <h3 className="text-sm font-semibold text-ink">Сигнали ризику</h3>
          <RisksBlock reviews={reviews} />
        </Card>
      </div>

      {/* ── Geography & roles ──────────────────────────────────────────── */}
      {reviews.length > 0 && (
        <Card className="space-y-3 p-5">
          <h3 className="text-sm font-semibold text-ink">Географія та ролі</h3>
          <GeoRolesBlock reviews={reviews} />
        </Card>
      )}

      {/* ── Review filters + list ───────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-ink">
            Відгуки ({filtered.length})
          </h3>
          <FilterBar reviews={reviews} filters={filters} onChange={setFilters} />
        </div>

        {filtered.length === 0 ? (
          <Card className="p-5 text-center text-sm text-ink-muted">
            Немає відгуків за вибраними фільтрами.{" "}
            <button
              type="button"
              onClick={() => setFilters(EMPTY_FILTERS)}
              className="text-brand-700 underline"
            >
              Скинути
            </button>
          </Card>
        ) : (
          <div className="space-y-4">
            {filtered.map((r) => <ReviewCard key={r.id} review={r} />)}
          </div>
        )}
      </div>

      <p className="text-xs text-ink-muted">
        Відгуки публікуються анонімно після модерації.
      </p>
    </div>
  );
}
