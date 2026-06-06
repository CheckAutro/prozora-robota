"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Search,
  ShieldCheck,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { getAccessToken } from "@/lib/supabase/auth-client";

type RiskLevel = "low" | "medium" | "high" | "unknown";
type ConfidenceLevel = "low" | "medium" | "high";

interface AiAnalysis {
  summary: string;
  risk_level: RiskLevel;
  risk_score: number | null;
  confidence_level: ConfidenceLevel;
  data_level: "insufficient" | "partial" | "enough";
  analysis_mode: "ai" | "fallback";
  provider?: string | null;
  known_facts: string[];
  external_findings: string[];
  risks: string[];
  missing_data: string[];
  interview_questions: string[];
  recommendations: string[];
  source_breakdown: {
    internal_reviews: number;
    open_facts: number;
    external_ratings: number;
    external_signals: number;
    external_company_sources: number;
    found_external_sources: number;
    vacancy_text: boolean;
  };
  disclaimer: string;
  finder_warnings?: string[];
  fetched_title?: string | null;
}

interface AiSource {
  source_name: string;
  source_url: string;
  title: string;
  snippet: string;
  signal_type: string;
  confidence: ConfidenceLevel;
}

interface AiResponse {
  analysis: AiAnalysis;
  usage: {
    limit: number | null;
    used: number;
    remaining: number | null;
    isAdmin?: boolean;
    unlimited?: boolean;
  };
  fetch: {
    status: string;
    message?: string;
  };
  sources: AiSource[];
}

type Stage =
  | { type: "idle" }
  | { type: "loading" }
  | { type: "result"; data: AiResponse }
  | { type: "error"; message: string };

type UsageState =
  | { type: "loading" }
  | { type: "ready"; limit: number | null; used: number; remaining: number | null; isAdmin?: boolean; unlimited?: boolean }
  | { type: "unavailable" };

const RISK_META: Record<RiskLevel, { label: string; className: string }> = {
  low: { label: "Низький", className: "bg-brand-50 text-brand-800 border-brand-200" },
  medium: { label: "Середній", className: "bg-amber-50 text-amber-800 border-amber-200" },
  high: { label: "Високий", className: "bg-red-50 text-red-800 border-red-200" },
  unknown: { label: "Недостатньо даних", className: "bg-amber-50 text-amber-800 border-amber-200" },
};

const CONFIDENCE_LABEL: Record<ConfidenceLevel, string> = {
  low: "низька",
  medium: "середня",
  high: "висока",
};

function ListBlock({
  title,
  items,
  empty,
}: {
  title: string;
  items: string[];
  empty: string;
}) {
  return (
    <div className="rounded-xl border border-ink/[0.06] bg-white p-4">
      <h4 className="mb-3 text-sm font-semibold text-ink">{title}</h4>
      {items.length > 0 ? (
        <ul className="space-y-2">
          {items.slice(0, 8).map((item) => (
            <li key={item} className="text-sm leading-relaxed text-ink-soft">
              {item}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-muted">{empty}</p>
      )}
    </div>
  );
}

function AiResultView({ data }: { data: AiResponse }) {
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const meta = RISK_META[data.analysis.risk_level];
  const sourceBreakdown = data.analysis.source_breakdown;
  const canShowScore =
    data.analysis.risk_level !== "unknown" &&
    data.analysis.data_level !== "insufficient" &&
    typeof data.analysis.risk_score === "number" &&
    data.analysis.risk_score > 0;
  const sourceSignalCount = data.sources.filter((source) =>
    source.source_name !== "Прозора робота" &&
    ["review", "rating", "discussion"].includes(source.signal_type)
  ).length;
  const externalSignalSources = data.sources.filter((source) =>
    source.source_name !== "Прозора робота" &&
    ["review", "rating", "discussion"].includes(source.signal_type)
  );
  const externalSourceCount = data.analysis.source_breakdown.external_company_sources;
  const summary = data.analysis.summary.trim();
  const showSummaryToggle = summary.length > 220;
  const displayedSummary = summaryExpanded || !showSummaryToggle
    ? summary
    : `${summary.slice(0, 220).trimEnd()}…`;
  const keyFacts = [
    ...data.analysis.known_facts.slice(0, 2),
    data.analysis.risks[0],
  ].filter(Boolean).slice(0, 3);

  return (
    <Card className="space-y-4 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">
            <Search className="h-3.5 w-3.5" /> Швидка перевірка
          </p>
          <h3 className="mt-3 font-display text-xl font-bold text-ink">
            {displayedSummary || "Поки недостатньо даних для оцінки."}
          </h3>
          {showSummaryToggle && (
            <button
              type="button"
              onClick={() => setSummaryExpanded((value) => !value)}
              className="mt-2 text-xs font-semibold text-brand-700 hover:text-brand-800"
            >
              {summaryExpanded ? "Показати менше" : "Показати більше"}
            </button>
          )}
          <p className="mt-2 text-xs text-ink-muted">
            {data.analysis.analysis_mode === "ai"
              ? "Аналіз на основі доступних даних сайту та тексту вакансії."
              : "Аналіз на основі правил і доступних даних сайту."}
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <span className={cn("rounded-full border px-3 py-1 text-sm font-semibold", meta.className)}>
            Ризик: {meta.label}
          </span>
          <span className="rounded-full border border-ink/10 bg-ink/[0.04] px-3 py-1 text-xs font-semibold text-ink-soft">
            Впевненість: {CONFIDENCE_LABEL[data.analysis.confidence_level]}
          </span>
          <span className="text-xs text-ink-muted">
            {canShowScore ? `score ${data.analysis.risk_score} / 100` : "Оцінка ризику: недостатньо даних"}
          </span>
        </div>
      </div>

      {data.fetch.status !== "not_requested" && (
        <div className="rounded-xl bg-ink/[0.03] px-4 py-3 text-sm text-ink-soft">
          URL: {data.fetch.status}
          {data.fetch.message ? ` · ${data.fetch.message}` : ""}
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-ink/[0.06] bg-white p-3">
          <p className="text-xs text-ink-muted">Відгуки</p>
          <p className="mt-1 text-sm font-semibold text-ink">{sourceBreakdown.internal_reviews}</p>
        </div>
        <div className="rounded-xl border border-ink/[0.06] bg-white p-3">
          <p className="text-xs text-ink-muted">Відкриті факти</p>
          <p className="mt-1 text-sm font-semibold text-ink">{sourceBreakdown.open_facts}</p>
        </div>
        <div className="rounded-xl border border-ink/[0.06] bg-white p-3">
          <p className="text-xs text-ink-muted">Зовнішні джерела</p>
          <p className="mt-1 text-sm font-semibold text-ink">{externalSourceCount}</p>
        </div>
        <div className="rounded-xl border border-ink/[0.06] bg-white p-3">
          <p className="text-xs text-ink-muted">Оцінки</p>
          <p className="mt-1 text-sm font-semibold text-ink">
            {sourceBreakdown.external_ratings > 0 ? "є" : "немає"}
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-ink/[0.06] bg-ink/[0.02] p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Ключове</p>
        {keyFacts.length === 0 ? (
          <p className="mt-2 text-sm text-ink-soft">Недостатньо даних для оцінки ризику.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {keyFacts.map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm leading-relaxed text-ink-soft">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <details className="rounded-xl border border-ink/[0.06] bg-white p-4">
        <summary className="cursor-pointer list-none text-sm font-semibold text-ink">
          Показати деталі
        </summary>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <ListBlock title="Що відомо" items={data.analysis.known_facts} empty="Недостатньо перевірених фактів." />
          <ListBlock title="Відкриті джерела та вакансії" items={data.analysis.external_findings} empty="Підтверджених відкритих джерел або вакансій поки немає." />
          <ListBlock title="Ризики" items={data.analysis.risks} empty="Критичних ризиків не визначено." />
          <ListBlock title="Чого бракує" items={data.analysis.missing_data} empty="Базові дані частково заповнені." />
          <ListBlock title="Питання для співбесіди" items={data.analysis.interview_questions} empty="Питань поки немає." />
          <ListBlock title="Рекомендації" items={data.analysis.recommendations} empty="Рекомендацій поки немає." />
          <div className="rounded-xl border border-ink/[0.06] bg-white p-4 lg:col-span-2">
            <h4 className="mb-3 text-sm font-semibold text-ink">Джерела</h4>
            {externalSignalSources.length === 0 ? (
              <p className="text-sm text-ink-muted">Підтверджених зовнішніх відгуків або сигналів поки немає.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {externalSignalSources.slice(0, 8).map((source) => (
                  <div key={`${source.source_url}-${source.title}`} className="rounded-xl border border-ink/[0.06] bg-ink/[0.02] p-3">
                    <p className="text-sm font-semibold text-ink">{source.source_name}</p>
                    <p className="mt-1 text-xs text-ink-muted">{source.title}</p>
                    <p className="mt-2 text-sm leading-relaxed text-ink-soft">{source.snippet}</p>
                    {source.source_url && (
                      <a
                        href={source.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:text-brand-800"
                      >
                        Відкрити <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </details>

      {data.analysis.finder_warnings && data.analysis.finder_warnings.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {data.analysis.finder_warnings.join(" ")}
        </div>
      )}

      <p className="flex items-start gap-2 rounded-xl bg-ink/[0.03] px-4 py-3 text-xs leading-relaxed text-ink-muted">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {data.analysis.disclaimer.replace("AI-аналіз", "Автоматичний аналіз")} Зовнішні джерела можуть потребувати перевірки і не додаються до відгуків автоматично.
      </p>
    </Card>
  );
}

async function postAiAnalyze(payload: Record<string, unknown>): Promise<AiResponse> {
  const token = await getAccessToken();
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;

  const res = await fetch("/api/ai/analyze", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({})) as AiResponse & { message?: string; error?: string };
  if (!res.ok) {
    throw new Error(data.message ?? data.error ?? "Не вдалося виконати аналіз.");
  }
  return data;
}

async function getAiUsage(): Promise<UsageState> {
  try {
    const token = await getAccessToken();
    const headers: Record<string, string> = {};
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch("/api/ai/analyze", { headers });
    const data = await res.json().catch(() => ({})) as { usage?: AiResponse["usage"] };
    if (!res.ok || !data.usage) return { type: "unavailable" };
    return { type: "ready", ...data.usage };
  } catch {
    return { type: "unavailable" };
  }
}

export function AiVacancyAnalysisSection({
  initialCompanyName = "",
}: {
  initialCompanyName?: string;
}) {
  const [vacancyUrl, setVacancyUrl] = useState("");
  const [vacancyText, setVacancyText] = useState("");
  const [companyName, setCompanyName] = useState(initialCompanyName);
  const [includeExternalSearch, setIncludeExternalSearch] = useState(true);
  const [stage, setStage] = useState<Stage>({ type: "idle" });
  const [usage, setUsage] = useState<UsageState>({ type: "loading" });

  useEffect(() => {
    let mounted = true;
    void getAiUsage().then((nextUsage) => {
      if (mounted) setUsage(nextUsage);
    });
    return () => {
      mounted = false;
    };
  }, []);

  async function submit() {
    if (!vacancyUrl.trim() && !vacancyText.trim()) {
      setStage({ type: "error", message: "Вставте посилання або текст вакансії для аналізу." });
      return;
    }
    setStage({ type: "loading" });
    try {
      const data = await postAiAnalyze({
        type: "vacancy",
        companyName: companyName.trim() || undefined,
        vacancyUrl: vacancyUrl.trim() || undefined,
        vacancyText: vacancyText.trim() || undefined,
        includeExternalSearch,
      });
      setStage({ type: "result", data });
      setUsage({ type: "ready", ...data.usage });
    } catch (error) {
      setStage({
        type: "error",
        message: error instanceof Error ? error.message : "Не вдалося виконати аналіз.",
      });
    }
  }

  return (
    <section className="space-y-4">
      <Card className="space-y-5 p-6 sm:p-7">
        <div>
          <h2 className="font-display text-2xl font-bold text-ink sm:text-3xl">Перевірити вакансію</h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft sm:text-base">
            Вставте посилання або текст вакансії — система перевірить компанію,
            відкриті джерела, відгуки та ризики.
          </p>
        </div>

        <div className="space-y-3">
          <input
            value={vacancyUrl}
            onChange={(e) => setVacancyUrl(e.target.value)}
            placeholder="Посилання на вакансію Work.ua, Robota.ua, DOU, Djinni..."
            className="w-full rounded-xl border border-ink/12 bg-white px-4 py-3 text-sm focus-ring"
          />
          <textarea
            value={vacancyText}
            onChange={(e) => setVacancyText(e.target.value)}
            rows={6}
            placeholder="Або вставте текст вакансії вручну, якщо посилання не читається"
            className="w-full resize-y rounded-xl border border-ink/12 bg-white px-4 py-3 text-sm focus-ring"
          />
          <input
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder="Компанія, якщо її потрібно уточнити"
            className="w-full rounded-xl border border-ink/12 bg-white px-4 py-3 text-sm focus-ring"
          />
        </div>

        <label className="flex items-start gap-2 text-sm text-ink-soft">
          <input
            type="checkbox"
            checked={includeExternalSearch}
            onChange={(e) => setIncludeExternalSearch(e.target.checked)}
            className="mt-1"
          />
          <span>Шукати відкриті джерела з відгуками та сигналами</span>
        </label>

        <div className="space-y-2">
          <Button
            onClick={() => void submit()}
            disabled={stage.type === "loading" || (!vacancyUrl.trim() && !vacancyText.trim())}
            size="lg"
            className="w-full justify-center sm:w-auto"
          >
            {stage.type === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Проаналізувати безкоштовно
          </Button>
          <div className="space-y-1 text-xs text-ink-muted">
            <p>
              {usage.type === "ready" && (usage.isAdmin || usage.unlimited)
                ? "Адмін: перевірки без ліміту"
                : `Залишилось перевірок сьогодні: ${
                    usage.type === "ready" ? usage.remaining : usage.type === "loading" ? "…" : "невідомо"
                  }`}
            </p>
            <p>Якщо сайт вакансії не віддасть сторінку, вставте текст вручну.</p>
          </div>
        </div>

        <p className="text-xs leading-relaxed text-ink-muted">
          Автоматичний аналіз не є відгуком і не впливає на рейтинг компанії. Зовнішні джерела
          можуть потребувати перевірки і не додаються до відгуків автоматично.
        </p>
      </Card>

      {stage.type === "error" && (
        <Card className="flex items-start gap-2 border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{stage.message}</span>
        </Card>
      )}

      {stage.type === "result" && <AiResultView data={stage.data} />}
    </section>
  );
}

export function AiCompanyAnalysisPanel({
  companySlug,
  companyName,
}: {
  companySlug: string;
  companyName: string;
}) {
  const [stage, setStage] = useState<Stage>({ type: "idle" });

  async function submit() {
    setStage({ type: "loading" });
    try {
      const data = await postAiAnalyze({
        type: "company",
        companySlug,
        companyName,
        includeExternalSearch: true,
      });
      setStage({ type: "result", data });
    } catch (error) {
      setStage({
        type: "error",
        message: error instanceof Error ? error.message : "Не вдалося виконати аналіз.",
      });
    }
  }

  return (
    <section className="space-y-4">
      <Card className="space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-lg font-bold text-ink">Швидка перевірка компанії</h2>
            <p className="mt-1 text-sm text-ink-soft">
              Перевірте компанію на основі доступних відгуків, відкритих вакансій,
              зовнішніх джерел і сигналів.
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Button onClick={() => void submit()} disabled={stage.type === "loading"} className="justify-center">
              {stage.type === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
              Проаналізувати компанію
            </Button>
            <Button href={`/check-vacancy?company=${encodeURIComponent(companySlug)}`} variant="secondary" className="justify-center">
              Перевірити конкретну вакансію
            </Button>
          </div>
        </div>
        {stage.type === "result" && (
          <p className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {stage.data.usage.isAdmin || stage.data.usage.unlimited
              ? "Адмін: перевірки без ліміту"
              : `Залишилось перевірок сьогодні: ${stage.data.usage.remaining}`}
          </p>
        )}
        {stage.type === "error" && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {stage.message}
          </p>
        )}
      </Card>

      {stage.type === "result" && <AiResultView data={stage.data} />}
    </section>
  );
}
