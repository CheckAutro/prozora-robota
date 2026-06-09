"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, ChevronDown, FileSearch, Loader2, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { getAccessToken } from "@/lib/supabase/auth-client";
import {
  getCompactSourceBreakdown,
  getCompanyDataLevel,
  dataLevelLabel,
  getExternalCompanyRatingSources,
} from "@/lib/company-page-utils";
import type { PublishedCompanyReviewFacts } from "@/lib/company-service";
import type { CompanyOpenFactSummary } from "@/lib/company-open-facts-service";
import type { ExternalReviewSignalSummary } from "@/lib/external-review-signals-service";
import type { ExternalCompanySourceSummary } from "@/lib/external/company-sources";
import type { CompanyOpenFact, ExternalCompanySource, ExternalRating } from "@/lib/types";

// ── API response types ────────────────────────────────────────────────────────

type RiskLevel = "low" | "medium" | "high" | "unknown";
type ConfidenceLevel = "low" | "medium" | "high";

interface SourceEvidence {
  source_name: string;
  source_type: string;
  what_found: string;
  topics: string[];
  limitation: string | null;
}

interface ExtractedFact {
  category: string;
  fact: string;
  evidence_strength: "confirmed" | "partial" | "inferred";
}

interface AiAnalysis {
  summary: string;
  risk_level: RiskLevel;
  risk_score: number | null;
  confidence_level: ConfidenceLevel;
  data_level: "insufficient" | "partial" | "enough";
  analysis_mode: "ai" | "fallback";
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
    external_company_sources_total?: number;
    external_company_sources: number;
    external_rating_sources?: number;
    reputation_sources_total?: number;
    specific_reputation_sources_total?: number;
    found_external_sources: number;
    discovered_now_total?: number;
    auto_published_now_total?: number;
    duplicate_skipped_total?: number;
  };
  disclaimer: string;
  finder_warnings?: string[];
  // Candidate-focused fields
  final_verdict?: string | null;
  bottom_line?: string | null;
  positive_signals?: string[];
  risk_signals?: string[];
  candidate_action_plan?: string[];
  source_evidence?: SourceEvidence[];
  extracted_facts?: ExtractedFact[];
  repeated_topics?: string[];
  practical_score?: number | null;
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
  fetch: { status: string; message?: string };
  sources: { source_name: string; source_url: string; title: string; snippet: string; signal_type: string; confidence: ConfidenceLevel }[];
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
  low: { label: "Низький", className: "border-brand-200 bg-brand-50 text-brand-800" },
  medium: { label: "Середній", className: "border-amber-200 bg-amber-50 text-amber-800" },
  high: { label: "Високий", className: "border-red-200 bg-red-50 text-red-800" },
  unknown: { label: "Недостатньо даних", className: "border-ink/[0.1] bg-ink/[0.03] text-ink-muted" },
};

const CONFIDENCE_LABEL_MAP: Record<ConfidenceLevel, string> = {
  low: "низька",
  medium: "середня",
  high: "висока",
};

const FACT_CATEGORY_LABELS: Record<string, string> = {
  salary: "Зарплата",
  schedule: "Графік",
  management: "Керівництво",
  culture: "Культура",
  benefits: "Умови",
  reviews: "Відгуки",
  growth: "Розвиток",
  other: "Інше",
};

const EVIDENCE_STRENGTH_CLASS: Record<string, string> = {
  confirmed: "text-brand-700",
  partial: "text-amber-700",
  inferred: "text-ink-muted",
};

// ── Sub-components ────────────────────────────────────────────────────────────

function CompactDetailsList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-xl border border-ink/[0.08] bg-ink/[0.025] p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{title}</h3>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">Недостатньо даних.</p>
      ) : (
        <ul className="mt-2.5 space-y-1.5">
          {items.slice(0, 6).map((item) => (
            <li key={item} className="flex items-start gap-2 text-sm leading-relaxed text-ink-soft">
              <span className="mt-[0.4rem] h-1 w-1 shrink-0 rounded-full bg-ink-muted/50" />
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Static (idle) body ────────────────────────────────────────────────────────

function StaticBody({
  facts,
  externalRatings,
  externalCompanySources,
  openFacts,
  openFactSummary,
  externalReviewSignalSummary,
  externalCompanySourceSummary,
}: {
  facts: PublishedCompanyReviewFacts;
  externalRatings: ExternalRating[];
  externalCompanySources: ExternalCompanySource[];
  openFacts: CompanyOpenFact[];
  openFactSummary: CompanyOpenFactSummary;
  externalReviewSignalSummary: ExternalReviewSignalSummary;
  externalCompanySourceSummary: ExternalCompanySourceSummary;
}) {
  const breakdown = getCompactSourceBreakdown({
    facts, externalRatings, externalCompanySources,
    openFacts, openFactSummary, externalReviewSignalSummary,
  });
  const dataLevel = getCompanyDataLevel(
    facts, externalRatings.length, openFactSummary.factsCount,
    externalReviewSignalSummary.signalCount, externalCompanySourceSummary.sourceCount,
  );
  // Use specific (non-generic) sources as the threshold for reputation evidence
  const hasReputationData = breakdown.specificReputationSourcesTotal > 0;
  const hasOpenFacts = breakdown.openFactSourcesTotal > 0 || breakdown.totalExternalSources > 0;
  const riskLabel = hasReputationData ? "Потребує перевірки" : "Недостатньо даних";
  const riskBadgeClass = hasReputationData
    ? "border-amber-300 bg-amber-50 text-amber-700"
    : "border-ink/[0.1] bg-ink/[0.03] text-ink-muted";
  const confidence = hasReputationData
    ? dataLevel === "Є достатньо даних" ? "середня" : "низька"
    : "низька";
  const confidenceBadgeClass = confidence === "середня"
    ? "border-brand-200 bg-brand-50 text-brand-700"
    : "border-ink/[0.1] bg-ink/[0.03] text-ink-muted";
  const hasRatings = breakdown.ratingSourcesCount > 0;

  const keyItems = hasReputationData
    ? [
        facts.reviewCount > 0 ? `Є відгуки на Прозора робота: ${facts.reviewCount}.` : null,
        hasRatings ? `Є підтверджені зовнішні оцінки: ${breakdown.ratingSourcesCount}.` : null,
        breakdown.reviewSourcesCount > 0 || externalReviewSignalSummary.signalCount > 0
          ? "Є підтверджені зовнішні сигнали або узагальнення."
          : "Ключові умови все одно потрібно уточнювати письмово.",
      ].filter(Boolean) as string[]
    : [
        "Компанія є в каталозі.",
        hasOpenFacts ? "Є відкриті джерела або вакансії." : "Підтверджених відкритих джерел поки немає.",
        "Недостатньо відгуків працівників для повної оцінки.",
      ];

  const knownFacts = [
    facts.reviewCount > 0 ? `Відгуків на Прозора робота: ${facts.reviewCount}.` : "Відгуків працівників поки немає.",
    openFactSummary.factsCount > 0 ? `Відкритих фактів: ${openFactSummary.factsCount}.` : null,
    openFactSummary.sources.length > 0 ? `Джерела фактів: ${openFactSummary.sources.join(" / ")}.` : null,
    breakdown.totalExternalSources > 0 ? `Відкритих джерел: ${breakdown.totalExternalSources}.` : null,
    hasRatings ? `Зовнішніх оцінок: ${breakdown.ratingSourcesCount}.` : "Зовнішні оцінки поки не підтверджені.",
  ].filter(Boolean) as string[];

  const risks = hasReputationData
    ? ["Дані з відкритих джерел не є відгуками Прозора робота.", "Умови вакансій можуть відрізнятися від фактичних умов роботи."]
    : ["Ризик неможливо оцінити через нестачу репутаційних даних."];

  const missingData = [
    facts.reviewCount === 0 ? "Недостатньо відгуків користувачів Прозора робота." : null,
    !hasRatings ? "Немає підтверджених зовнішніх оцінок." : null,
    externalReviewSignalSummary.signalCount === 0 && breakdown.reviewSourcesCount === 0
      ? "Немає підтверджених зовнішніх відгуків або сигналів." : null,
    !facts.hasSalaryData && openFactSummary.salaryExamples.length === 0 ? "Бракує даних про зарплату." : null,
    !facts.hasScheduleData && openFactSummary.schedules.length === 0 ? "Бракує даних про графік." : null,
  ].filter(Boolean) as string[];

  const recommendations = [
    "Перевірте конкретну вакансію перед відгуком.",
    "Попросіть письмово підтвердити зарплату, графік і оформлення.",
    "Не робіть висновок лише на основі кількості вакансій.",
    "Залиште анонімний відгук після співбесіди або роботи.",
  ];

  const interviewQuestions = [
    "Яка фіксована ставка і як виплачуються бонуси?",
    "Чи є офіційне оформлення з першого дня?",
    "Який фактичний графік і як оплачуються понаднормові?",
    "Чи є бронювання або відстрочка і чи дають письмове підтвердження?",
  ];

  return (
    <div className="space-y-4 p-4 sm:p-5">
      {/* Risk + confidence badges */}
      <div className="flex flex-wrap gap-2">
        <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold", riskBadgeClass)}>
          <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
          Ризик: {riskLabel}
        </span>
        <span className={cn("rounded-full border px-3 py-1 text-xs font-semibold", confidenceBadgeClass)}>
          Впевненість: {confidence}
        </span>
      </div>

      {/* Stats row */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className={cn("rounded-xl border p-3", facts.reviewCount > 0 ? "border-brand-200 bg-brand-50/70" : "border-ink/[0.07] bg-ink/[0.025]")}>
          <p className="text-[0.6875rem] font-medium uppercase tracking-wide text-ink-muted">Відгуки</p>
          <p className="mt-1 text-base font-bold tabular-nums text-ink">{facts.reviewCount}</p>
        </div>
        <div className={cn("rounded-xl border p-3", breakdown.totalExternalSources > 0 ? "border-brand-200 bg-brand-50/70" : "border-ink/[0.07] bg-ink/[0.025]")}>
          <p className="text-[0.6875rem] font-medium uppercase tracking-wide text-ink-muted">Відкриті джерела</p>
          <p className="mt-1 text-base font-bold tabular-nums text-ink">{breakdown.totalExternalSources}</p>
        </div>
        <div className={cn("rounded-xl border p-3", hasRatings ? "border-brand-200 bg-brand-50/70" : "border-ink/[0.07] bg-ink/[0.025]")}>
          <p className="text-[0.6875rem] font-medium uppercase tracking-wide text-ink-muted">Оцінки</p>
          <p className="mt-1 text-base font-bold text-ink">{hasRatings ? "є" : "немає"}</p>
        </div>
        <div className={cn("rounded-xl border p-3", dataLevel !== "Поки недостатньо даних" ? "border-brand-200 bg-brand-50/70" : "border-amber-200/60 bg-amber-50/40")}>
          <p className="text-[0.6875rem] font-medium uppercase tracking-wide text-ink-muted">Дані</p>
          <p className="mt-1 text-base font-bold text-ink">{dataLevelLabel(dataLevel).toLowerCase()}</p>
        </div>
      </div>

      {/* Ключове */}
      <div className="rounded-xl border border-brand-100 bg-brand-50/50 p-4">
        <p className="text-[0.6875rem] font-semibold uppercase tracking-widest text-brand-700">Ключове</p>
        <ul className="mt-2.5 space-y-2">
          {keyItems.slice(0, 3).map((item) => (
            <li key={item} className="flex items-start gap-2.5 text-sm leading-relaxed text-ink-soft">
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-500" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Details accordion */}
      <details className="rounded-xl border border-ink/[0.1] bg-white">
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold text-ink">
          Показати деталі
          <span className="accordion-chevron text-ink-muted">
            <ChevronDown className="h-4 w-4" />
          </span>
        </summary>
        <div className="border-t border-ink/[0.06] p-4">
          <div className="grid gap-3 lg:grid-cols-2">
            <CompactDetailsList title="Що відомо" items={knownFacts} />
            <CompactDetailsList title="Ризики" items={risks} />
            <CompactDetailsList title="Чого бракує" items={missingData} />
            <CompactDetailsList title="Рекомендації" items={recommendations} />
            <CompactDetailsList title="Питання на співбесіді" items={interviewQuestions} />
            <div className="rounded-xl border border-ink/[0.08] bg-ink/[0.025] p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Джерела</h3>
              <div className="mt-2.5 grid gap-1.5 text-sm text-ink-soft">
                <p>Відгуки Прозора робота: {facts.reviewCount}</p>
                <p>Відкриті факти: {openFactSummary.factsCount}</p>
                <p>Зовнішні джерела: {breakdown.totalExternalSources}</p>
                <p>Зовнішні оцінки: {breakdown.ratingSourcesCount}</p>
                <p>Специфічні репутаційні джерела: {breakdown.specificReputationSourcesTotal}</p>
              </div>
            </div>
          </div>
        </div>
      </details>
    </div>
  );
}

// ── AI result body ────────────────────────────────────────────────────────────

function AiResultBody({ data }: { data: AiResponse }) {
  const meta = RISK_META[data.analysis.risk_level];
  const sb = data.analysis.source_breakdown;
  const externalSourceCount = sb.external_company_sources_total ?? sb.external_company_sources;
  const hasRatings = sb.external_ratings > 0 || (sb.external_rating_sources ?? 0) > 0;
  const canShowScore =
    data.analysis.risk_level !== "unknown" &&
    data.analysis.data_level !== "insufficient" &&
    typeof data.analysis.risk_score === "number" &&
    data.analysis.risk_score > 0;

  const verdictText = data.analysis.final_verdict ?? data.analysis.summary;
  const bottomLine = data.analysis.bottom_line;
  const positiveSignals = data.analysis.positive_signals ?? [];
  const riskSignals = (data.analysis.risk_signals ?? []).length > 0
    ? data.analysis.risk_signals ?? []
    : data.analysis.risks.slice(0, 4);
  const interviewQs = data.analysis.interview_questions.slice(0, 10);
  const extractedFacts = data.analysis.extracted_facts ?? [];
  const sourceEvidence = data.analysis.source_evidence ?? [];
  const missingData = data.analysis.missing_data;
  const actionPlan = (data.analysis.candidate_action_plan ?? []).length > 0
    ? data.analysis.candidate_action_plan ?? []
    : data.analysis.recommendations.slice(0, 5);

  return (
    <div className="space-y-4 p-4 sm:p-5">
      {/* Verdict card */}
      <div className="rounded-xl border border-ink/[0.07] bg-white p-4">
        <p className="text-sm leading-relaxed text-ink">{verdictText}</p>
        {bottomLine && (
          <p className="mt-2 text-sm font-medium leading-relaxed text-ink-soft">{bottomLine}</p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className={cn("rounded-full border px-3 py-1 text-xs font-semibold", meta.className)}>
            Ризик: {meta.label}
          </span>
          <span className="rounded-full border border-ink/10 bg-ink/[0.04] px-3 py-1 text-xs font-semibold text-ink-soft">
            Впевненість: {CONFIDENCE_LABEL_MAP[data.analysis.confidence_level]}
          </span>
          {canShowScore && (
            <span className="text-xs text-ink-muted">score {data.analysis.risk_score} / 100</span>
          )}
          {typeof data.analysis.practical_score === "number" && data.analysis.practical_score !== null && (
            <span className="rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">
              Практична оцінка: {data.analysis.practical_score}/10
            </span>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className={cn("rounded-xl border p-3", sb.internal_reviews > 0 ? "border-brand-200 bg-brand-50/70" : "border-ink/[0.06] bg-white")}>
          <p className="text-[0.6875rem] font-medium uppercase tracking-wide text-ink-muted">Відгуки</p>
          <p className="mt-1 text-base font-bold tabular-nums text-ink">{sb.internal_reviews}</p>
        </div>
        <div className={cn("rounded-xl border p-3", sb.open_facts > 0 ? "border-brand-200 bg-brand-50/70" : "border-ink/[0.06] bg-white")}>
          <p className="text-[0.6875rem] font-medium uppercase tracking-wide text-ink-muted">Відкриті факти</p>
          <p className="mt-1 text-base font-bold tabular-nums text-ink">{sb.open_facts}</p>
        </div>
        <div className={cn("rounded-xl border p-3", externalSourceCount > 0 ? "border-brand-200 bg-brand-50/70" : "border-ink/[0.06] bg-white")}>
          <p className="text-[0.6875rem] font-medium uppercase tracking-wide text-ink-muted">Зовн. джерела</p>
          <p className="mt-1 text-base font-bold tabular-nums text-ink">{externalSourceCount}</p>
        </div>
        <div className={cn("rounded-xl border p-3", hasRatings ? "border-brand-200 bg-brand-50/70" : "border-ink/[0.06] bg-white")}>
          <p className="text-[0.6875rem] font-medium uppercase tracking-wide text-ink-muted">Оцінки</p>
          <p className="mt-1 text-base font-bold text-ink">{hasRatings ? "є" : "немає"}</p>
        </div>
      </div>

      {/* Extracted facts */}
      {extractedFacts.length > 0 && (
        <div className="rounded-xl border border-ink/[0.08] bg-ink/[0.02] p-4">
          <p className="text-[0.6875rem] font-semibold uppercase tracking-widest text-ink-muted">Що реально вдалося знайти</p>
          <ul className="mt-2.5 space-y-2">
            {extractedFacts.slice(0, 5).map((fact, i) => (
              <li key={i} className="flex items-start gap-2.5 text-sm leading-relaxed">
                <span className="mt-0.5 shrink-0 rounded bg-ink/[0.06] px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase text-ink-muted">
                  {FACT_CATEGORY_LABELS[fact.category] ?? fact.category}
                </span>
                <span className={cn("flex-1", EVIDENCE_STRENGTH_CLASS[fact.evidence_strength] ?? "text-ink-soft")}>
                  {fact.fact}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Positive + risk signals */}
      {(positiveSignals.length > 0 || riskSignals.length > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {positiveSignals.length > 0 && (
            <div className="rounded-xl border border-brand-100 bg-brand-50/40 p-4">
              <p className="text-[0.6875rem] font-semibold uppercase tracking-widest text-brand-700">Позитивні сигнали</p>
              <ul className="mt-2 space-y-1.5">
                {positiveSignals.slice(0, 4).map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm leading-relaxed text-ink-soft">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {riskSignals.length > 0 && (
            <div className="rounded-xl border border-amber-100 bg-amber-50/40 p-4">
              <p className="text-[0.6875rem] font-semibold uppercase tracking-widest text-amber-700">Що насторожує</p>
              <ul className="mt-2 space-y-1.5">
                {riskSignals.slice(0, 5).map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm leading-relaxed text-ink-soft">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Source evidence */}
      {sourceEvidence.length > 0 && (
        <div className="rounded-xl border border-ink/[0.08] bg-white p-4">
          <p className="text-[0.6875rem] font-semibold uppercase tracking-widest text-ink-muted">Що кажуть джерела</p>
          <ul className="mt-2.5 divide-y divide-ink/[0.05]">
            {sourceEvidence.slice(0, 5).map((ev, i) => (
              <li key={i} className="py-2 first:pt-0 last:pb-0">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-xs font-semibold text-ink">{ev.source_name}</span>
                  <span className="shrink-0 rounded bg-ink/[0.05] px-1.5 py-0.5 text-[0.625rem] uppercase text-ink-muted">{ev.source_type}</span>
                </div>
                <p className="mt-1 text-sm text-ink-soft">{ev.what_found}</p>
                {ev.limitation && (
                  <p className="mt-0.5 text-xs text-ink-muted">{ev.limitation}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Interview questions */}
      {interviewQs.length > 0 && (
        <div className="rounded-xl border border-ink/[0.08] bg-ink/[0.02] p-4">
          <p className="text-[0.6875rem] font-semibold uppercase tracking-widest text-ink-muted">Питання на співбесіді</p>
          <ol className="mt-2.5 space-y-1.5 pl-0">
            {interviewQs.map((q, i) => (
              <li key={i} className="flex items-start gap-2.5 text-sm leading-relaxed text-ink-soft">
                <span className="mt-0.5 shrink-0 text-xs font-bold tabular-nums text-ink-muted">{i + 1}.</span>
                <span>{q}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Missing data + action plan */}
      {(missingData.length > 0 || actionPlan.length > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {missingData.length > 0 && (
            <CompactDetailsList title="Чого бракує" items={missingData} />
          )}
          {actionPlan.length > 0 && (
            <CompactDetailsList title="Що зробити кандидату" items={actionPlan} />
          )}
        </div>
      )}

      {/* Details accordion */}
      <details className="rounded-xl border border-ink/[0.1] bg-white">
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold text-ink">
          Показати повний аналіз
          <span className="accordion-chevron text-ink-muted">
            <ChevronDown className="h-4 w-4" />
          </span>
        </summary>
        <div className="border-t border-ink/[0.06] p-4">
          <div className="grid gap-3 lg:grid-cols-2">
            <CompactDetailsList title="Що відомо" items={data.analysis.known_facts} />
            <CompactDetailsList title="Зовнішні джерела" items={data.analysis.external_findings} />
            <CompactDetailsList title="Ризики" items={data.analysis.risks} />
            <CompactDetailsList title="Рекомендації" items={data.analysis.recommendations} />
          </div>
        </div>
      </details>

      {/* Legal registry placeholder */}
      <div className="rounded-xl border border-ink/[0.07] bg-ink/[0.015] p-4">
        <p className="text-[0.6875rem] font-semibold uppercase tracking-widest text-ink-muted">Юридичні та державні реєстри</p>
        <p className="mt-1.5 text-sm text-ink-muted">
          Не перевірено в цьому звіті. Рекомендуємо самостійно перевірити компанію в ЄДР, реєстрі судових справ та ДФС.
        </p>
      </div>

      {/* Discovery stats — admin-only */}
      {(data.usage.isAdmin || data.usage.unlimited) &&
        ((data.analysis.source_breakdown.discovered_now_total ?? 0) > 0 ||
          (data.analysis.source_breakdown.auto_published_now_total ?? 0) > 0) && (
        <p className="text-xs text-ink-muted">
          {(data.analysis.source_breakdown.discovered_now_total ?? 0) > 0 &&
            `Знайдено нових джерел: ${data.analysis.source_breakdown.discovered_now_total}`}
          {(data.analysis.source_breakdown.auto_published_now_total ?? 0) > 0 &&
            ` · Опубліковано: ${data.analysis.source_breakdown.auto_published_now_total}`}
        </p>
      )}

      {/* Disclaimer */}
      <p className="flex items-start gap-2 rounded-xl bg-ink/[0.03] px-4 py-3 text-xs leading-relaxed text-ink-muted">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {data.analysis.disclaimer.replace("AI-аналіз", "Автоматичний аналіз")} Зовнішні джерела не додаються до відгуків і не змінюють внутрішній рейтинг.
      </p>
    </div>
  );
}

// ── API helpers ───────────────────────────────────────────────────────────────

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

// ── Main component ────────────────────────────────────────────────────────────

export interface CompactCompanyAiCheckProps {
  companySlug: string;
  companyName: string;
  facts: PublishedCompanyReviewFacts;
  externalRatings: ExternalRating[];
  externalCompanySources: ExternalCompanySource[];
  openFacts: CompanyOpenFact[];
  openFactSummary: CompanyOpenFactSummary;
  externalReviewSignalSummary: ExternalReviewSignalSummary;
  externalCompanySourceSummary: ExternalCompanySourceSummary;
}

export function CompactCompanyAiCheck({
  companySlug,
  companyName,
  facts,
  externalRatings,
  externalCompanySources,
  openFacts,
  openFactSummary,
  externalReviewSignalSummary,
  externalCompanySourceSummary,
}: CompactCompanyAiCheckProps) {
  const [stage, setStage] = useState<Stage>({ type: "idle" });
  const [usage, setUsage] = useState<UsageState>({ type: "loading" });
  const [roleContext, setRoleContext] = useState("");
  const roleInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    let mounted = true;
    void getAiUsage().then((next) => { if (mounted) setUsage(next); });
    return () => { mounted = false; };
  }, []);

  async function handleAnalyze() {
    setStage({ type: "loading" });
    try {
      const data = await postAiAnalyze({
        type: "company",
        companySlug,
        companyName,
        includeExternalSearch: true,
        roleContext: roleContext.trim() || undefined,
      });
      setStage({ type: "result", data });
      setUsage({ type: "ready", ...data.usage });
      if ((data.analysis.source_breakdown.auto_published_now_total ?? 0) > 0) {
        router.refresh();
      }
    } catch (err) {
      setStage({
        type: "error",
        message: err instanceof Error ? err.message : "Не вдалося виконати аналіз.",
      });
    }
  }

  const isLoading = stage.type === "loading";

  return (
    <Card className="overflow-hidden">
      {/* ── Header (always visible) ── */}
      <div className="border-b border-brand-100 bg-gradient-to-r from-brand-50/80 to-transparent px-4 pb-5 pt-5 sm:px-5">
        <p className="text-[0.625rem] font-semibold uppercase tracking-widest text-brand-600">
          Практичний аналіз для кандидата
        </p>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-lg font-bold tracking-tight text-ink">
              Швидка перевірка роботодавця
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-ink-soft">
              Аналіз на основі відгуків, відкритих джерел і вакансій.
            </p>
          </div>
        </div>

        {/* Role context input */}
        {stage.type === "idle" && (
          <div className="mt-3">
            <input
              ref={roleInputRef}
              type="text"
              value={roleContext}
              onChange={(e) => setRoleContext(e.target.value)}
              placeholder="Посада або вакансія (необов'язково)"
              maxLength={120}
              className="w-full rounded-lg border border-ink/[0.12] bg-white px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400/30"
            />
          </div>
        )}

        {/* Buttons row */}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            onClick={() => void handleAnalyze()}
            disabled={isLoading}
            size="sm"
          >
            {isLoading
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <Bot className="h-4 w-4" />}
            Проаналізувати компанію
          </Button>
          <Button
            href={`/check-vacancy?company=${encodeURIComponent(companySlug)}`}
            variant="secondary"
            size="sm"
          >
            <FileSearch className="h-4 w-4" />
            Перевірити конкретну вакансію
          </Button>
        </div>

        {/* Usage / admin badge */}
        <div className="mt-3 text-xs text-ink-muted">
          {usage.type === "ready" && (usage.isAdmin || usage.unlimited)
            ? <span className="font-medium text-brand-700">Адмін: перевірки без ліміту</span>
            : usage.type === "ready"
              ? <span>Залишилось перевірок сьогодні: {usage.remaining ?? "…"}</span>
              : null}
        </div>
      </div>

      {/* ── Body (changes with state) ── */}
      {stage.type === "idle" && (
        <StaticBody
          facts={facts}
          externalRatings={externalRatings}
          externalCompanySources={externalCompanySources}
          openFacts={openFacts}
          openFactSummary={openFactSummary}
          externalReviewSignalSummary={externalReviewSignalSummary}
          externalCompanySourceSummary={externalCompanySourceSummary}
        />
      )}

      {stage.type === "loading" && (
        <div className="flex items-center gap-3 p-6 text-sm text-ink-soft">
          <Loader2 className="h-4 w-4 animate-spin text-brand-600" />
          Аналізуємо компанію та відкриті джерела…
        </div>
      )}

      {stage.type === "error" && (
        <div className="p-4 sm:p-5">
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {stage.message}
          </p>
        </div>
      )}

      {stage.type === "result" && <AiResultBody data={stage.data} />}
    </Card>
  );
}
