"use client";

import { useState, useRef } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Search, AlertTriangle, CheckCircle2, MessageSquare,
  Star, RefreshCw, ChevronRight, MapPin, Briefcase,
} from "lucide-react";
import { Card, SectionTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { normalizeIndustry } from "@/lib/industry";
import {
  findCompaniesInVacancyText,
  getCompanyCheckResult,
  type FoundCompany,
  type CompanyCheckResult,
} from "@/lib/vacancy-search";
import type { Review } from "@/lib/types";

// ── Star display ──────────────────────────────────────────────────────────────

function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={cn(
            "h-3.5 w-3.5",
            n <= Math.round(value) ? "fill-amber-400 text-amber-400" : "text-ink/15"
          )}
        />
      ))}
    </span>
  );
}

// ── Mini review card ──────────────────────────────────────────────────────────

function MiniReview({ review }: { review: Review }) {
  return (
    <div className="rounded-xl border border-ink/[0.06] bg-white p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-ink-muted">
        <span>{review.roleCategory}</span>
        <span>·</span>
        <span className="flex items-center gap-1">
          <MapPin className="h-3 w-3" /> {review.city}
        </span>
        <span>·</span>
        <span>{review.year}</span>
      </div>
      <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-ink-soft">
        {review.text}
      </p>
    </div>
  );
}

// ── Single company result card ────────────────────────────────────────────────

function CompanyResult({ result }: { result: CompanyCheckResult }) {
  const { company, reviewCount, averageRating, riskSignals, recentReviews } = result;
  const industry = normalizeIndustry(company.industry);

  // ── Zero reviews: single clean empty state card ─────────────────────────
  if (reviewCount === 0) {
    return (
      <Card className="space-y-5 p-6">
        {/* Company header */}
        <div>
          <h2 className="font-display text-xl font-bold text-ink">{company.name}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-soft">
            {company.city && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" /> {company.city}
              </span>
            )}
            {industry && (
              <span className="flex items-center gap-1">
                <Briefcase className="h-3.5 w-3.5" /> {industry}
              </span>
            )}
          </div>
        </div>

        {/* Empty state */}
        <div className="flex items-start gap-3 rounded-xl bg-ink/[0.03] px-4 py-4">
          <MessageSquare className="mt-0.5 h-5 w-5 shrink-0 text-ink-muted" />
          <p className="text-sm text-ink-soft">
            Компанія є в базі, але опублікованих відгуків поки немає. Ваш досвід
            допоможе іншим кандидатам.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Button href={`/add-review?company=${encodeURIComponent(company.slug)}`} variant="primary">
            Залишити перший відгук
          </Button>
          <Button href={`/companies/${company.slug}`} variant="secondary">
            Перейти до сторінки компанії
          </Button>
        </div>
      </Card>
    );
  }

  // ── Has reviews ──────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Company header */}
      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-bold text-ink">{company.name}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-soft">
              {company.city && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" /> {company.city}
                </span>
              )}
              {industry && (
                <span className="flex items-center gap-1">
                  <Briefcase className="h-3.5 w-3.5" /> {industry}
                </span>
              )}
            </div>
          </div>

          {averageRating !== null && (
            <div className="flex flex-col items-center gap-1 rounded-xl bg-brand-50 px-4 py-2.5">
              <Stars value={averageRating} />
              <span className="text-xs font-semibold text-brand-700">
                {averageRating.toFixed(1)} / 5
              </span>
            </div>
          )}
        </div>

        <div className="mt-4 flex items-center gap-2 text-sm text-ink-soft">
          <MessageSquare className="h-4 w-4 text-brand-600" />
          <span>
            <span className="font-semibold text-ink">{reviewCount}</span>{" "}
            {reviewCount === 1 ? "опублікований відгук" : "опублікованих відгуків"}
          </span>
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          <Button href={`/companies/${company.slug}`} variant="primary">
            Дивитися всі відгуки <ChevronRight className="h-4 w-4" />
          </Button>
          <Button href={`/add-review?company=${encodeURIComponent(company.slug)}`} variant="secondary">
            Залишити відгук
          </Button>
        </div>
      </Card>

      {/* Risk signals */}
      {riskSignals.length > 0 && (
        <Card className="space-y-3 p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-amber-700">
            <AlertTriangle className="h-4 w-4" /> Сигнали, на які варто звернути увагу
          </h3>
          <ul className="space-y-1.5">
            {riskSignals.map((s) => (
              <li key={s.field} className="flex items-start gap-2 text-sm text-ink-soft">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                {s.label}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Good signal */}
      {reviewCount > 0 && riskSignals.length === 0 && averageRating !== null && averageRating >= 4 && (
        <Card className="flex items-center gap-3 p-5">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-brand-600" />
          <p className="text-sm text-ink-soft">
            Відгуки загалом позитивні. Рекомендуємо уточнити умови особисто на співбесіді.
          </p>
        </Card>
      )}

      {/* Insufficient data */}
      {reviewCount > 0 && riskSignals.length === 0 && averageRating === null && (
        <Card className="flex items-center gap-3 p-5">
          <MessageSquare className="h-5 w-5 shrink-0 text-ink-muted" />
          <p className="text-sm text-ink-soft">
            Поки що недостатньо даних для повних висновків.
          </p>
        </Card>
      )}

      {/* Recent reviews */}
      {recentReviews.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-ink">Останні відгуки</h3>
          {recentReviews.map((r) => (
            <MiniReview key={r.id} review={r} />
          ))}
          <Link
            href={`/companies/${company.slug}`}
            className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:text-brand-800"
          >
            Дивитися всі відгуки <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      )}
    </div>
  );
}

// ── Multiple matches ──────────────────────────────────────────────────────────

function MultipleMatches({
  companies,
  onSelect,
}: {
  companies: FoundCompany[];
  onSelect: (c: FoundCompany) => void;
}) {
  return (
    <Card className="space-y-4 p-6">
      <h2 className="font-display text-lg font-bold text-ink">
        Ми знайшли кілька можливих роботодавців
      </h2>
      <p className="text-sm text-ink-soft">Оберіть потрібну компанію:</p>
      <div className="space-y-3">
        {companies.map((c) => (
          <div
            key={c.slug}
            className="flex items-center justify-between gap-4 rounded-xl border border-ink/[0.06] bg-white p-4"
          >
            <div>
              <p className="font-semibold text-ink">{c.name}</p>
              <p className="mt-0.5 text-xs text-ink-muted">
                {[c.city, normalizeIndustry(c.industry)].filter(Boolean).join(" · ")}
              </p>
            </div>
            <Button size="sm" variant="secondary" onClick={() => onSelect(c)}>
              Перевірити <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── URL with no employer info ─────────────────────────────────────────────────

function UrlUnclear() {
  return (
    <Card className="space-y-4 p-6 text-center">
      <Search className="mx-auto h-10 w-10 text-ink-muted/40" />
      <div className="space-y-2">
        <h2 className="font-display text-lg font-bold text-ink">
          За цим посиланням не вдалося визначити роботодавця
        </h2>
        <p className="text-sm text-ink-soft">
          Ми поки не відкриваємо зовнішні сайти автоматично. Вставте назву
          компанії або скопіюйте текст вакансії з Work.ua / Robota.ua.
        </p>
        <p className="text-xs text-ink-muted">
          Наприклад: <span className="font-medium">Нова Пошта курʼєр Київ</span>
        </p>
      </div>
      <Button href="/add-review" variant="primary">
        Додати відгук
      </Button>
    </Card>
  );
}

// ── Not found ─────────────────────────────────────────────────────────────────

function NotFound() {
  return (
    <Card className="space-y-4 p-6 text-center">
      <Search className="mx-auto h-10 w-10 text-ink-muted/40" />
      <div>
        <h2 className="font-display text-lg font-bold text-ink">
          Ми ще не знайшли цю компанію в базі
        </h2>
        <p className="mt-2 text-sm text-ink-soft">
          Можна залишити перший відгук і допомогти іншим кандидатам.
        </p>
      </div>
      <Button href="/add-review" variant="primary">
        Додати відгук
      </Button>
    </Card>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

type Stage =
  | { type: "idle" }
  | { type: "loading" }
  | { type: "multiple"; companies: FoundCompany[] }
  | { type: "result"; result: CompanyCheckResult }
  | { type: "not-found" }
  | { type: "url-unclear" };

export function VacancyCheckClient() {
  const searchParams = useSearchParams();
  const qParam = searchParams.get("q") ?? "";

  const [input, setInput] = useState(qParam);
  const [stage, setStage] = useState<Stage>({ type: "idle" });
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  async function handleCheck() {
    const q = input.trim();
    if (q.length < 2) return;

    setStage({ type: "loading" });
    window.scrollTo({ top: 0, behavior: "smooth" });

    const { companies, topScore, isJobBoard } = await findCompaniesInVacancyText(q);

    if (companies.length === 0) {
      // If the input was a job-board URL with no company info, show targeted hint.
      setStage({ type: isJobBoard ? "url-unclear" : "not-found" });
      return;
    }

    // Auto-select when the top result has a high-confidence score (≥ 80):
    // full name match (+100) or full slug match (+90). Show without picker.
    if (companies.length === 1 || topScore >= 80) {
      const result = await getCompanyCheckResult(companies[0]);
      setStage({ type: "result", result: result ?? { company: companies[0], reviewCount: 0, averageRating: null, riskSignals: [], recentReviews: [] } });
      return;
    }

    // Multiple matches with similar scores — let user pick
    setStage({ type: "multiple", companies });
  }

  async function handleSelectCompany(company: FoundCompany) {
    setStage({ type: "loading" });
    const result = await getCompanyCheckResult(company);
    setStage({ type: "result", result: result ?? { company, reviewCount: 0, averageRating: null, riskSignals: [], recentReviews: [] } });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleReset() {
    setStage({ type: "idle" });
    setInput("");
    setTimeout(() => textareaRef.current?.focus(), 50);
  }

  return (
    <div className="container-page max-w-3xl space-y-8 py-8 sm:py-10">
      <SectionTitle
        eyebrow="Перевірка вакансії"
        title="Перевірити вакансію або роботодавця"
        description="Вставте назву компанії, посаду або текст вакансії — ми перевіримо, чи є відгуки про роботодавця."
      />

      {/* Input form */}
      <Card className="space-y-4 p-6">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void handleCheck();
          }}
          rows={4}
          placeholder="Вставте назву компанії, посаду, текст вакансії або посилання"
          className="w-full resize-y rounded-xl border border-ink/12 bg-white px-4 py-3 text-sm focus-ring placeholder:text-ink-muted"
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={() => void handleCheck()}
            disabled={input.trim().length < 2 || stage.type === "loading"}
            size="lg"
          >
            <Search className="h-4 w-4" />
            {stage.type === "loading" ? "Перевіряємо…" : "Перевірити"}
          </Button>
          {stage.type !== "idle" && stage.type !== "loading" && (
            <Button variant="secondary" onClick={handleReset}>
              <RefreshCw className="h-4 w-4" /> Нова перевірка
            </Button>
          )}
        </div>
        <p className="text-xs text-ink-muted">
          Натисніть Ctrl+Enter, щоб перевірити. Пошук ведеться по реальній базі компаній.
        </p>
      </Card>

      {/* Results */}
      {stage.type === "loading" && (
        <div className="flex items-center gap-2 text-sm text-ink-muted">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-brand-300 border-t-brand-600" />
          Шукаємо компанію…
        </div>
      )}

      {stage.type === "multiple" && (
        <MultipleMatches companies={stage.companies} onSelect={(c) => void handleSelectCompany(c)} />
      )}

      {stage.type === "result" && (
        <CompanyResult result={stage.result} />
      )}

      {stage.type === "url-unclear" && <UrlUnclear />}
      {stage.type === "not-found" && <NotFound />}
    </div>
  );
}
