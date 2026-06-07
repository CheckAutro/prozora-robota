import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  MapPin,
  Briefcase,
  PenLine,
  MessageSquareText,
  CheckCircle2,
  ClipboardList,
  FileText,
  FileSearch,
  Star,
  ChevronDown,
  MessageSquare,
} from "lucide-react";

import { COMPANIES } from "@/lib/mock-data";
import {
  getPublishedCompanyReviewFacts,
  getSupabaseCompanyBySlug,
  type PublishedCompanyReviewFacts,
} from "@/lib/company-service";
import { getPublicExternalRatings } from "@/lib/external-ratings-service";
import {
  getPublicCompanyOpenFacts,
  getPublicCompanyOpenFactsSummary,
  type CompanyOpenFactSummary,
} from "@/lib/company-open-facts-service";
import {
  getPublicCompanyExternalSources,
  getPublicCompanyExternalSourceSummary,
  type ExternalCompanySourceSummary,
} from "@/lib/external/company-sources";
import {
  getPublicExternalReviewSignals,
  getPublicExternalReviewSignalSummary,
  SENTIMENT_LABELS,
  TOPIC_LABELS,
  type ExternalReviewSignalSummary,
} from "@/lib/external-review-signals-service";
import { getServerClient } from "@/lib/supabase/server";
import { normalizeIndustry } from "@/lib/industry";
import { cn } from "@/lib/cn";
import type { CompanyOpenFact, ExternalRating, ExternalReviewSignal, ExternalCompanySource } from "@/lib/types";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { CompanyReviewsSection } from "@/components/product/CompanyReviews";
import { ExternalRatingsSection } from "@/components/product/ExternalRatingsSection";

// Pre-render known slugs at build time (both mock-data AND Supabase slugs
// that were discovered at previous builds).
// Supabase-only slugs are rendered on demand (dynamic).
export function generateStaticParams() {
  return COMPANIES.map((c) => ({ slug: c.slug }));
}

export const dynamic = "force-dynamic";

// ── Lightweight server-side review counter ────────────────────────────────────
// Used only by generateMetadata so we can write honest descriptions.
// Does NOT use getBrowserClient — runs server-side with the anon key.
async function getPublishedReviewCount(slug: string): Promise<number> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!url || !key) return 0;
  try {
    const client = getServerClient();
    const { count, error } = await client
      .from("reviews")
      .select("*", { count: "exact", head: true })
      .eq("company_slug", slug)
      .eq("status", "published");
    if (error || count === null) return 0;
    return count;
  } catch {
    return 0;
  }
}

function formatAverage(value: number | null): string {
  return value === null ? "не визначено" : `${value.toFixed(1)} / 5`;
}

function formatCounts(counts: Record<string, number>, labels: Record<string, string>): string {
  return Object.entries(counts)
    .filter(([key, value]) => key !== "unknown" && value > 0)
    .map(([key, value]) => `${labels[key] ?? key}: ${value}`)
    .join(", ");
}

function formatDate(value: string | null): string {
  if (!value) return "не вказано";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "не вказано";
  return date.toLocaleDateString("uk-UA");
}

function shortText(value: string | null, limit = 240): string | null {
  const text = value?.replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > limit ? `${text.slice(0, limit - 1).trim()}…` : text;
}

function isSourceSummaryFact(fact: CompanyOpenFact): boolean {
  const title = fact.vacancyTitle?.toLowerCase() ?? "";
  const excerpt = fact.rawExcerpt?.toLowerCase() ?? "";
  return (
    title.startsWith("сторінка компанії на") ||
    title.includes("сторінка компанії у джерелі") ||
    excerpt.includes("компанія має сторінку")
  );
}

function getRealVacancyFacts(facts: CompanyOpenFact[]): CompanyOpenFact[] {
  return facts.filter((fact) => !isSourceSummaryFact(fact));
}

function getSourceSummaryFacts(facts: CompanyOpenFact[]): CompanyOpenFact[] {
  return facts.filter(isSourceSummaryFact);
}

function uniqueText(values: Array<string | null | undefined>, limit: number): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const text = value?.trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
    if (result.length >= limit) break;
  }
  return result;
}

function extractOpenVacanciesCount(rawExcerpt: string | null): number | null {
  const match = rawExcerpt?.match(/Кількість відкритих вакансій у списку:\s*(\d+)/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function joinExamples(label: string, values: string[]): string | null {
  if (values.length === 0) return null;
  return `${label}: ${values.slice(0, 3).join("; ")}.`;
}

function getCompanyDataLevel(
  facts: PublishedCompanyReviewFacts,
  externalRatingsCount: number,
  openFactsCount: number,
  externalReviewSignalsCount: number,
  externalCompanySourcesCount: number
): "Поки недостатньо даних" | "Є часткові дані" | "Є достатньо даних" {
  if (
    facts.reviewCount === 0 &&
    externalRatingsCount === 0 &&
    openFactsCount === 0 &&
    externalReviewSignalsCount === 0 &&
    externalCompanySourcesCount === 0
  ) {
    return "Поки недостатньо даних";
  }
  if (
    facts.reviewCount >= 5 ||
    (
      facts.reviewCount >= 2 &&
      (
        externalRatingsCount >= 2 ||
        openFactsCount >= 2 ||
        externalReviewSignalsCount >= 2 ||
        externalCompanySourcesCount >= 2
      )
    )
  ) {
    return "Є достатньо даних";
  }
  return "Є часткові дані";
}

function dataLevelLabel(level: ReturnType<typeof getCompanyDataLevel>): string {
  if (level === "Поки недостатньо даних") return "Недостатньо даних";
  if (level === "Є часткові дані") return "Часткові дані";
  return "Достатньо даних";
}

function yesNoData(value: boolean): string {
  return value ? "є дані" : "немає даних";
}

function externalSignalTopicList(summary: ExternalReviewSignalSummary): string {
  return summary.topics.map((topic) => TOPIC_LABELS[topic].toLowerCase()).slice(0, 4).join(", ");
}

function externalSourceTypeLabel(type: string): string {
  if (type === "reviews") return "відгуки";
  if (type === "rating") return "оцінка";
  if (type === "vacancy") return "вакансія";
  if (type === "company_page") return "сторінка компанії";
  if (type === "article") return "стаття";
  return "джерело";
}

function getExternalCompanyRatingSources(sources: ExternalCompanySource[]): ExternalCompanySource[] {
  return sources.filter((source) => source.sourceType === "rating");
}

function getExternalCompanyOpenSources(sources: ExternalCompanySource[]): ExternalCompanySource[] {
  return sources.filter((source) => source.sourceType !== "rating");
}

const CONFIDENCE_LABELS: Record<ExternalCompanySource["confidence"], string> = {
  low: "низька",
  medium: "середня",
  high: "висока",
};

type CompactSourceCard = {
  id: string;
  sourceName: string;
  sourceUrl: string | null;
  sourceType: ExternalCompanySource["sourceType"];
  title: string | null;
  shortSummary: string;
  confidence: ExternalCompanySource["confidence"];
  collectedAt: string | null;
};

function isUselessDuplicateTitle(title: string | null, summary: string): boolean {
  if (!title) return true;
  const normalizedTitle = title.trim().toLowerCase();
  const normalizedSummary = summary.trim().toLowerCase();
  return !normalizedTitle || normalizedSummary.includes(normalizedTitle);
}

function dedupeSentences(value: string): string {
  const sentences = value
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const sentence of sentences) {
    const key = sentence.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(sentence);
  }
  return result.join(" ");
}

function sourceIdentityKey(card: CompactSourceCard): string {
  if (card.sourceUrl) {
    return `url:${card.sourceUrl.replace(/[#?].*$/, "").replace(/\/+$/, "").toLowerCase()}`;
  }
  return [
    card.sourceName,
    card.sourceType,
    card.title ?? "",
    card.shortSummary,
  ].join("|").toLowerCase();
}

function openFactSummaryText(fact: CompanyOpenFact): string {
  const count = extractOpenVacanciesCount(fact.rawExcerpt);
  if (isSourceSummaryFact(fact)) {
    return count !== null
      ? `Компанія має сторінку у відкритому джерелі. Вакансій у відкритому джерелі: ${count}. Це не кількість відгуків.`
      : "Компанія має сторінку у відкритому джерелі.";
  }

  const parts = [
    fact.city ? `Місто: ${fact.city}` : null,
    fact.salaryText ? `зарплата: ${fact.salaryText}` : null,
    fact.schedule ? `графік: ${fact.schedule}` : null,
    fact.employmentType ? `оформлення: ${fact.employmentType}` : null,
  ].filter(Boolean);

  return parts.length > 0
    ? parts.join(" · ")
    : shortText(fact.rawExcerpt, 160) ?? "Є дані з відкритої вакансії.";
}

function getCompactOpenSourceCards(
  externalCompanySources: ExternalCompanySource[],
  openFacts: CompanyOpenFact[]
): CompactSourceCard[] {
  const cards: CompactSourceCard[] = [
    ...getExternalCompanyOpenSources(externalCompanySources).map((source) => ({
      id: `external-${source.id}`,
      sourceName: source.sourceName,
      sourceUrl: source.sourceUrl,
      sourceType: source.sourceType,
      title: source.title,
      shortSummary: shortText(dedupeSentences(source.shortSummary), 180) ?? "Є підтверджене відкрите джерело.",
      confidence: source.confidence,
      collectedAt: source.collectedAt,
    })),
    ...openFacts.map((fact) => ({
      id: `open-fact-${fact.id}`,
      sourceName: fact.sourceName,
      sourceUrl: fact.sourceUrl,
      sourceType: isSourceSummaryFact(fact) ? "company_page" as const : "vacancy" as const,
      title: isSourceSummaryFact(fact)
        ? `Сторінка компанії: ${fact.sourceName}`
        : fact.vacancyTitle ?? "Відкрита вакансія",
      shortSummary: openFactSummaryText(fact),
      confidence: "medium" as const,
      collectedAt: fact.collectedAt,
    })),
  ];

  const seen = new Set<string>();
  return cards.filter((card) => {
    const key = sourceIdentityKey(card);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getCompactSourceBreakdown({
  facts,
  externalRatings,
  externalCompanySources,
  openFacts,
  openFactSummary,
  externalReviewSignalSummary,
}: {
  facts: PublishedCompanyReviewFacts;
  externalRatings: ExternalRating[];
  externalCompanySources: ExternalCompanySource[];
  openFacts: CompanyOpenFact[];
  openFactSummary: CompanyOpenFactSummary;
  externalReviewSignalSummary: ExternalReviewSignalSummary;
}) {
  const ratingSources = getExternalCompanyRatingSources(externalCompanySources);
  const reviewSources = externalCompanySources.filter((source) => source.sourceType === "reviews");
  const vacancySources = externalCompanySources.filter((source) => source.sourceType === "vacancy");
  const companyPageSources = externalCompanySources.filter((source) => source.sourceType === "company_page");
  const totalExternalSources = getCompactOpenSourceCards(externalCompanySources, openFacts).length + ratingSources.length;
  const reputationSourcesTotal =
    facts.reviewCount +
    externalRatings.length +
    externalReviewSignalSummary.signalCount +
    reviewSources.length +
    ratingSources.length;
  const openFactSourcesTotal =
    openFactSummary.factsCount +
    vacancySources.length +
    companyPageSources.length;

  return {
    totalExternalSources,
    ratingSourcesCount: externalRatings.length + ratingSources.length,
    reviewSourcesCount: reviewSources.length,
    vacancySourcesCount: vacancySources.length + getRealVacancyFacts(openFacts).length,
    companyPageSourcesCount: companyPageSources.length + getSourceSummaryFacts(openFacts).length,
    reputationSourcesTotal,
    openFactSourcesTotal,
  };
}

function CompanyQuickCheckCard({
  companyName,
  facts,
  externalRatings,
  externalCompanySources,
  openFacts,
  openFactSummary,
  externalReviewSignalSummary,
  externalCompanySourceSummary,
}: {
  companyName: string;
  facts: PublishedCompanyReviewFacts;
  externalRatings: ExternalRating[];
  externalCompanySources: ExternalCompanySource[];
  openFacts: CompanyOpenFact[];
  openFactSummary: CompanyOpenFactSummary;
  externalReviewSignalSummary: ExternalReviewSignalSummary;
  externalCompanySourceSummary: ExternalCompanySourceSummary;
}) {
  const breakdown = getCompactSourceBreakdown({
    facts,
    externalRatings,
    externalCompanySources,
    openFacts,
    openFactSummary,
    externalReviewSignalSummary,
  });
  const dataLevel = getCompanyDataLevel(
    facts,
    externalRatings.length,
    openFactSummary.factsCount,
    externalReviewSignalSummary.signalCount,
    externalCompanySourceSummary.sourceCount
  );
  const hasReputationData = breakdown.reputationSourcesTotal > 0;
  const hasOpenFacts = breakdown.openFactSourcesTotal > 0 || breakdown.totalExternalSources > 0;
  const riskLabel = hasReputationData ? "Потребує перевірки" : "Недостатньо даних";
  const riskBadgeOnDark = hasReputationData
    ? "border-amber-400/40 bg-amber-400/[0.15] text-amber-300"
    : "border-white/[0.15] bg-white/[0.08] text-white/50";
  const confidence = hasReputationData
    ? dataLevel === "Є достатньо даних" ? "середня" : "низька"
    : "низька";
  const summary = hasReputationData
    ? "Є частина репутаційних або зовнішніх даних. Висновок варто робити обережно і підтвердити ключові умови письмово."
    : hasOpenFacts
      ? "Є відкриті факти або сторінки компанії у відкритих джерелах, але немає достатньо відгуків працівників чи підтверджених зовнішніх оцінок."
      : "Даних поки недостатньо для оцінки роботодавця.";
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
    `Компанія: ${companyName}.`,
    facts.reviewCount > 0 ? `Відгуків на Прозора робота: ${facts.reviewCount}.` : "Відгуків працівників поки немає.",
    openFactSummary.factsCount > 0 ? `Відкритих фактів: ${openFactSummary.factsCount}.` : null,
    openFactSummary.sources.length > 0 ? `Джерела фактів: ${openFactSummary.sources.join(" / ")}.` : null,
    breakdown.totalExternalSources > 0 ? `Відкритих джерел: ${breakdown.totalExternalSources}.` : null,
    hasRatings ? `Зовнішніх оцінок: ${breakdown.ratingSourcesCount}.` : "Зовнішні оцінки поки не підтверджені.",
  ].filter(Boolean) as string[];
  const risks = hasReputationData
    ? [
        "Дані з відкритих джерел не є відгуками Прозора робота.",
        "Умови вакансій можуть відрізнятися від фактичних умов роботи.",
      ]
    : ["Ризик неможливо оцінити через нестачу репутаційних даних."];
  const missingData = [
    facts.reviewCount === 0 ? "Недостатньо відгуків користувачів Прозора робота." : null,
    !hasRatings ? "Немає підтверджених зовнішніх оцінок." : null,
    externalReviewSignalSummary.signalCount === 0 && breakdown.reviewSourcesCount === 0
      ? "Немає підтверджених зовнішніх відгуків або сигналів."
      : null,
    !facts.hasSalaryData && openFactSummary.salaryExamples.length === 0 ? "Бракує даних про зарплату." : null,
    !facts.hasEmploymentData && !openFactSummary.hasOfficialEmploymentMention && openFactSummary.employmentTypes.length === 0
      ? "Бракує даних про оформлення."
      : null,
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

  const confidenceBadgeOnDark = confidence === "середня"
    ? "border-brand-400/40 bg-brand-400/[0.15] text-brand-300"
    : "border-white/[0.15] bg-white/[0.08] text-white/50";

  return (
    <Card className="overflow-hidden">
      {/* ── Dark header panel ── */}
      <div className="bg-gradient-to-br from-[#0f1f1a] to-[#1a3028] px-4 pb-5 pt-5 sm:px-5">
        <p className="text-[0.625rem] font-semibold uppercase tracking-widest text-brand-400">
          Аналіз на основі доступних даних
        </p>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-lg font-bold tracking-tight text-white">
              Швидка перевірка
            </h2>
            <p className="mt-1.5 line-clamp-2 max-w-xl text-sm leading-relaxed text-white/65">
              {summary}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold", riskBadgeOnDark)}>
              <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
              {riskLabel}
            </span>
            <span className={cn("rounded-full border px-3 py-1 text-xs font-semibold", confidenceBadgeOnDark)}>
              Впевненість: {confidence}
            </span>
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="space-y-4 p-4 sm:p-5">
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
                  <p>Репутаційні джерела: {breakdown.reputationSourcesTotal}</p>
                </div>
              </div>
            </div>
          </div>
        </details>
      </div>
    </Card>
  );
}

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

function CompanyDataSummary({
  facts,
  externalCompanySourceSummary,
  externalCompanySources,
  externalRatings,
  openFacts,
  openFactSummary,
  externalReviewSignalSummary,
}: {
  facts: PublishedCompanyReviewFacts;
  externalCompanySourceSummary: ExternalCompanySourceSummary;
  externalCompanySources: ExternalCompanySource[];
  externalRatings: ExternalRating[];
  openFacts: CompanyOpenFact[];
  openFactSummary: CompanyOpenFactSummary;
  externalReviewSignalSummary: ExternalReviewSignalSummary;
}) {
  const dataLevel = getCompanyDataLevel(
    facts,
    externalRatings.length,
    openFactSummary.factsCount,
    externalReviewSignalSummary.signalCount,
    externalCompanySourceSummary.sourceCount
  );
  const realVacancyFacts = getRealVacancyFacts(openFacts);
  const sourceSummaryFacts = getSourceSummaryFacts(openFacts);
  const externalRatingSources = getExternalCompanyRatingSources(externalCompanySources);
  const hasExternalRatings = externalRatings.length > 0 || externalRatingSources.length > 0;
  const cards = [
    {
      icon: MessageSquareText,
      label: "Відгуки",
      value: facts.reviewCount > 0
        ? `${facts.reviewCount} опублікованих відгуків`
        : "Відгуків працівників поки немає",
      tone: facts.reviewCount > 0 ? "text-brand-700 bg-brand-50" : "text-ink-soft bg-ink/[0.03]",
    },
    {
      icon: FileText,
      label: "Вакансії",
      value: realVacancyFacts.length > 0
        ? "Є дані з відкритих вакансій"
        : sourceSummaryFacts.length > 0
          ? "Є сторінка компанії у відкритому джерелі"
          : "Даних з відкритих вакансій поки немає",
      tone: openFactSummary.factsCount > 0 ? "text-brand-700 bg-brand-50" : "text-ink-soft bg-ink/[0.03]",
    },
    {
      icon: Star,
      label: "Відкриті джерела",
        value: externalCompanySourceSummary.sourceCount > 0
        ? `${externalCompanySourceSummary.sourceCount} джерел`
        : "Поки немає перевірених джерел",
      tone: externalCompanySourceSummary.sourceCount > 0 ? "text-brand-700 bg-brand-50" : "text-ink-soft bg-ink/[0.03]",
    },
    {
      icon: Star,
      label: "Оцінки з відкритих джерел",
      value: hasExternalRatings
        ? `${externalRatings.length + externalRatingSources.length} підтверджених оцінок`
        : "Зовнішні оцінки поки не підтверджені",
      tone: hasExternalRatings ? "text-brand-700 bg-brand-50" : "text-ink-soft bg-ink/[0.03]",
    },
    {
      icon: ClipboardList,
      label: "Рівень даних",
      value: dataLevelLabel(dataLevel),
      tone: dataLevel === "Поки недостатньо даних" ? "text-amber-700 bg-amber-50" : "text-brand-700 bg-brand-50",
    },
  ];

  return (
    <Card className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
      {cards.map(({ icon: Icon, label, value, tone }) => (
        <div key={label} className="flex items-start gap-3 rounded-xl border border-ink/[0.06] bg-white p-3">
          <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", tone)}>
            <Icon className="h-4 w-4" />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{label}</p>
            <p className="mt-0.5 text-sm font-medium text-ink">{value}</p>
          </div>
        </div>
      ))}
    </Card>
  );
}

function ExternalCompanySourcesSection({
  openFacts,
  sources,
}: {
  openFacts: CompanyOpenFact[];
  sources: ExternalCompanySource[];
}) {
  const displaySources = getCompactOpenSourceCards(sources, openFacts);
  const visibleSources = displaySources.slice(0, 3);
  const hasMore = displaySources.length > visibleSources.length;

  return (
    <Card className="space-y-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold text-ink">
            Відкриті джерела та вакансії
          </h2>
          <p className="mt-1 text-sm text-ink-soft">
            Це сторінки компаній, вакансії або відкриті згадки. Вони не є відгуками Прозора робота.
          </p>
        </div>
        <span className="rounded-full border border-brand-200/70 bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">
          {displaySources.length > 0 ? `${displaySources.length} джерел` : "Поки немає"}
        </span>
      </div>

      {displaySources.length === 0 ? (
        <div className="flex items-center gap-3 rounded-xl border border-ink/[0.07] bg-ink/[0.025] px-4 py-3">
          <FileSearch className="h-4 w-4 shrink-0 text-ink-muted" />
          <p className="text-sm text-ink-soft">Підтверджених відкритих джерел або вакансій поки немає.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
            {visibleSources.map((source) => (
              <div key={source.id} className="rounded-xl border border-l-[3px] border-ink/[0.08] border-l-brand-400/60 bg-white p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded-md border border-ink/[0.08] bg-ink/[0.04] px-2 py-0.5 text-[0.6875rem] font-medium text-ink-muted">
                        {externalSourceTypeLabel(source.sourceType)}
                      </span>
                      {source.collectedAt && (
                        <span className="text-[0.6875rem] text-ink-muted">{formatDate(source.collectedAt)}</span>
                      )}
                    </div>
                    <p className="mt-1.5 font-semibold text-ink">{source.sourceName}</p>
                  </div>
                  <span className={cn(
                    "rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                    source.confidence === "high" && "border-emerald-200 bg-emerald-50 text-emerald-800",
                    source.confidence === "medium" && "border-amber-200 bg-amber-50 text-amber-700",
                    source.confidence === "low" && "border-ink/[0.1] bg-ink/[0.04] text-ink-muted",
                  )}>
                    {CONFIDENCE_LABELS[source.confidence]}
                  </span>
                </div>
                {!isUselessDuplicateTitle(source.title, source.shortSummary) && (
                  <p className="mt-2 line-clamp-1 text-sm font-medium text-ink">{source.title}</p>
                )}
                <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-ink-soft">
                  {source.shortSummary}
                </p>
                {source.sourceUrl && (
                  <div className="mt-3">
                    <a
                      href={source.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-full border border-brand-200/70 bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700 transition-colors hover:bg-brand-100"
                    >
                      Відкрити джерело ↗
                    </a>
                  </div>
                )}
              </div>
            ))}
          </div>

          {hasMore && (
            <details className="rounded-xl border border-ink/[0.1] bg-white">
              <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium text-ink">
                Показати ще {displaySources.length - visibleSources.length} джерел
                <span className="accordion-chevron text-ink-muted">
                  <ChevronDown className="h-4 w-4" />
                </span>
              </summary>
              <div className="border-t border-ink/[0.06] p-3">
                <div className="grid gap-2 text-sm text-ink-soft">
                {displaySources.slice(3).map((source) => (
                  <div key={source.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-ink/[0.06] bg-ink/[0.02] px-3 py-2">
                    <span className="font-medium text-ink">{source.sourceName}</span>
                    <span className="text-ink-muted">·</span>
                    <span className="text-xs">{externalSourceTypeLabel(source.sourceType)}</span>
                    <span className="text-ink-muted">·</span>
                    <span className="line-clamp-1">{source.shortSummary}</span>
                    {source.sourceUrl && (
                      <a
                        href={source.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-auto inline-flex items-center gap-1 rounded-full border border-brand-200/70 bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 hover:bg-brand-100"
                      >
                        ↗
                      </a>
                    )}
                  </div>
                ))}
                </div>
              </div>
            </details>
          )}
        </div>
      )}
    </Card>
  );
}

function CompanyAnalysisList({ items, limit = 3 }: { items: string[]; limit?: number }) {
  return (
    <ul className="space-y-2">
      {items.slice(0, limit).map((item) => (
        <li key={item} className="text-sm leading-relaxed text-ink-soft">
          {item}
        </li>
      ))}
    </ul>
  );
}

function CompanyShortAnalysis({
  companyName,
  industry,
  city,
  facts,
  externalRatings,
  openFacts,
  openFactSummary,
  externalReviewSignalSummary,
  externalCompanySourceSummary,
}: {
  companyName: string;
  industry: string | null;
  city: string | null;
  facts: PublishedCompanyReviewFacts;
  externalRatings: ExternalRating[];
  openFacts: CompanyOpenFact[];
  openFactSummary: CompanyOpenFactSummary;
  externalReviewSignalSummary: ExternalReviewSignalSummary;
  externalCompanySourceSummary: ExternalCompanySourceSummary;
}) {
  const dataLevel = getCompanyDataLevel(
    facts,
    externalRatings.length,
    openFactSummary.factsCount,
    externalReviewSignalSummary.signalCount,
    externalCompanySourceSummary.sourceCount
  );
  const noData =
    facts.reviewCount === 0 &&
    externalRatings.length === 0 &&
    openFactSummary.factsCount === 0 &&
    externalReviewSignalSummary.signalCount === 0 &&
    externalCompanySourceSummary.sourceCount === 0;
  const realVacancyFacts = getRealVacancyFacts(openFacts);
  const sourceSummaryFacts = getSourceSummaryFacts(openFacts);
  const conclusion = noData
    ? "Поки недостатньо даних для оцінки роботодавця. На Прозора робота ще немає опублікованих відгуків, підтверджених зовнішніх оцінок або узагальнених сигналів поки немає."
    : facts.reviewCount === 0 && realVacancyFacts.length > 0
      ? "Є часткові дані з відкритих вакансій, але недостатньо відгуків працівників. Умови потрібно підтверджувати напряму з роботодавцем."
    : facts.reviewCount === 0 && sourceSummaryFacts.length > 0
      ? "Є сторінка компанії у відкритому джерелі, але конкретні умови вакансій потрібно перевіряти окремо."
    : facts.reviewCount === 0 && externalReviewSignalSummary.signalCount > 0
      ? "Є часткові узагальнення за відкритими джерелами, але недостатньо відгуків на Прозора робота. Ці сигнали потрібно перевіряти на співбесіді."
    : dataLevel === "Є часткові дані"
      ? "Є часткові дані про роботодавця. Висновок варто робити обережно і тільки після уточнення ключових умов."
      : "Є кілька джерел даних про роботодавця, але рішення все одно варто підтверджувати письмовими умовами.";
  const realVacancyTitles = uniqueText(realVacancyFacts.map((fact) => fact.vacancyTitle), 3);
  const sourceSummaryLines = uniqueText(
    sourceSummaryFacts.map((fact) => `Джерело: сторінка компанії на ${fact.sourceName}.`),
    3
  );
  const sourceVacancyCountLines = uniqueText(
    sourceSummaryFacts.map((fact) => {
      const count = extractOpenVacanciesCount(fact.rawExcerpt);
      return count === null ? null : `Вакансій у відкритому джерелі: ${count}.`;
    }),
    3
  );
  const known = [
    "Компанія є в каталозі.",
    industry ? `Сфера: ${industry}.` : "Сфера не вказана.",
    city ? `Місто: ${city}.` : "Місто компанії не вказано.",
    facts.reviewCount > 0 ? `Опубліковані відгуки на Прозора робота: ${facts.reviewCount}.` : null,
    externalRatings.length > 0 ? `Підтверджені зовнішні джерела: ${externalRatings.length}.` : null,
    externalCompanySourceSummary.sourceCount > 0 ? `Є зовнішні джерела: ${externalCompanySourceSummary.sourceCount}.` : null,
    externalReviewSignalSummary.signalCount > 0 ? "Є узагальнені сигнали з відкритих джерел." : null,
    externalReviewSignalSummary.topics.length > 0
      ? `Найчастіші теми за відкритими джерелами: ${externalSignalTopicList(externalReviewSignalSummary)}.`
      : null,
    realVacancyFacts.length > 0
      ? `Є дані з відкритих вакансій: ${openFactSummary.sources.join(" / ")}.`
      : sourceSummaryFacts.length > 0
        ? "Є сторінка компанії у відкритому джерелі."
        : null,
    ...sourceSummaryLines,
    ...sourceVacancyCountLines,
    joinExamples("У вакансіях згадуються міста", openFactSummary.cities),
    joinExamples("Приклади посад", realVacancyTitles),
    joinExamples("Приклади зарплати", openFactSummary.salaryExamples),
    joinExamples("Умови", openFactSummary.conditions),
  ].filter(Boolean) as string[];
  const attention = [
    facts.reviewCount === 0 && externalRatings.length === 0
      ? "Відгуків працівників і підтверджених зовнішніх оцінок поки немає."
      : null,
    facts.reviewCount > 0 ? `Є ${facts.reviewCount} опублікованих відгуків на Прозора робота.` : null,
    externalRatings.length > 0 ? `Є ${externalRatings.length} підтверджених зовнішніх джерел.` : null,
    externalCompanySourceSummary.sourceCount > 0 ? "Є перевірені зовнішні джерела та вакансії." : null,
    externalReviewSignalSummary.negativeCount + externalReviewSignalSummary.mixedCount > 0
      ? "У відкритих джерелах є змішані або негативні згадки. Їх потрібно перевірити на співбесіді."
      : null,
    realVacancyFacts.length > 0 ? "Відкриті факти не є досвідом працівників." : null,
    openFactSummary.salaryExamples.length > 0
      ? "Є приклади зарплат з відкритих вакансій, але їх потрібно підтверджувати з роботодавцем."
      : null,
    facts.averageInternalRating !== null
      ? `Внутрішня оцінка за published reviews: ${formatAverage(facts.averageInternalRating)}.`
      : null,
  ].filter(Boolean) as string[];
  const missingLabels = [
    facts.reviewCount === 0 ? "анонімні відгуки" : null,
    externalRatings.length === 0 ? "зовнішні оцінки" : null,
    externalReviewSignalSummary.signalCount === 0 ? "зовнішні сигнали" : null,
    !facts.hasSalaryData && openFactSummary.salaryExamples.length === 0 ? "зарплата" : null,
    !facts.hasEmploymentData && !openFactSummary.hasOfficialEmploymentMention && openFactSummary.employmentTypes.length === 0
      ? "оформлення"
      : null,
    !facts.hasScheduleData && openFactSummary.schedules.length === 0 ? "графік" : null,
    !facts.hasBookingData && !openFactSummary.hasBookingMention ? "бронювання" : null,
  ].filter(Boolean) as string[];
  const missing = [
    missingLabels.length > 0
      ? `Бракує даних: ${missingLabels.join(", ")}.`
      : `За наявними даними базові блоки для ${companyName} частково заповнені.`,
  ];
  const factualSummary = [
    `Джерела: ${openFactSummary.sources.length ? openFactSummary.sources.join(" / ") : "поки немає"}.`,
    `Відкритих фактів: ${openFactSummary.factsCount}.`,
    `Останнє оновлення: ${formatDate(openFactSummary.latestCollectedAt)}.`,
    `Є дані про зарплату: ${yesNoData(openFactSummary.salaryExamples.length > 0 || facts.hasSalaryData)} · місто: ${yesNoData(openFactSummary.cities.length > 0 || Boolean(city))} · оформлення: ${yesNoData(openFactSummary.hasOfficialEmploymentMention || openFactSummary.employmentTypes.length > 0 || facts.hasEmploymentData)} · графік: ${yesNoData(openFactSummary.schedules.length > 0 || facts.hasScheduleData)}.`,
  ];

  return (
    <Card className="space-y-5 p-6">
      <div>
        <h2 className="font-display text-lg font-bold text-ink">
          Короткий аналіз роботодавця
        </h2>
        <p className="mt-2 inline-flex rounded-full bg-ink/[0.04] px-3 py-1 text-xs font-semibold text-ink-soft">
          {dataLevel}
        </p>
      </div>

      <p className="text-sm leading-relaxed text-ink-soft">{conclusion}</p>

      <div className="grid gap-2 rounded-xl border border-ink/[0.06] bg-ink/[0.02] p-4 sm:grid-cols-2">
        {factualSummary.map((item) => (
          <p key={item} className="flex items-start gap-2 text-xs leading-relaxed text-ink-soft">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-600" />
            {item}
          </p>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-3 rounded-xl border border-ink/[0.06] bg-white p-4">
          <h3 className="text-sm font-semibold text-ink">Що відомо</h3>
          <CompanyAnalysisList items={known} limit={3} />
        </div>
        <div className="space-y-3 rounded-xl border border-ink/[0.06] bg-white p-4">
          <h3 className="text-sm font-semibold text-ink">На що звернути увагу</h3>
          <CompanyAnalysisList items={attention} limit={3} />
        </div>
        <div className="space-y-3 rounded-xl border border-ink/[0.06] bg-white p-4">
          <h3 className="text-sm font-semibold text-ink">Якої інформації бракує</h3>
          <CompanyAnalysisList items={missing} limit={1} />
        </div>
      </div>
    </Card>
  );
}

function PreliminaryConclusion({
  companySlug,
  facts,
  openFactSummary,
}: {
  companySlug: string;
  facts: PublishedCompanyReviewFacts;
  openFactSummary: CompanyOpenFactSummary;
}) {
  const conclusion = facts.reviewCount > 0
    ? "Є відгуки працівників і відкриті дані."
    : openFactSummary.factsCount > 0
      ? "Є відкриті дані про вакансії, але немає достатньо відгуків працівників. Перевірка неповна."
      : "Даних поки недостатньо.";

  return (
    <Card className="space-y-5 border-brand-200 bg-brand-50 p-6 sm:p-7">
      <div>
        <p className="text-[0.6875rem] font-semibold uppercase tracking-widest text-brand-700">
          Попередній висновок
        </p>
        <p className="mt-2 text-base font-semibold leading-relaxed text-ink text-balance">
          {conclusion}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button href="/check-vacancy" size="sm">
          Перевірити конкретну вакансію
        </Button>
        <Button href={`/add-review?company=${encodeURIComponent(companySlug)}`} variant="outline" size="sm">
          Додати анонімний відгук
        </Button>
        <Button href="#interview-checklist" variant="ghost" size="sm">
          Уточнити умови письмово
        </Button>
      </div>
    </Card>
  );
}

function ExternalReviewSignalsSection({
  signals,
}: {
  signals: ExternalReviewSignal[];
}) {
  return (
    <Card className="space-y-4 p-6">
      <div>
        <h2 className="font-display text-lg font-bold text-ink">
          Що пишуть у відкритих джерелах
        </h2>
        <p className="mt-1 text-sm text-ink-soft">
          Це узагальнення відкритих джерел. Воно не є відгуками Прозора робота
          і не впливає на внутрішній рейтинг.
        </p>
      </div>

      {signals.length === 0 ? (
        <p className="rounded-xl bg-ink/[0.03] px-4 py-3 text-sm text-ink-soft">
          Підтверджених узагальнень зовнішніх відгуків поки немає.
        </p>
      ) : (
        <div className="grid gap-3">
          {signals.map((signal) => (
            <div key={signal.id} className="rounded-xl border border-ink/[0.06] bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-ink">
                    {TOPIC_LABELS[signal.topic]}: {SENTIMENT_LABELS[signal.sentiment]}
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-ink-soft">
                    {signal.summary}
                  </p>
                </div>
                <span className="rounded-full border border-brand-200/60 bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">
                  {signal.mentionsCount} згадок
                </span>
              </div>
              <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                <MessageSquareText className="h-3.5 w-3.5" />
                <span>Джерело: {signal.sourceName}</span>
                {signal.sourceUrl && (
                  <a
                    href={signal.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-brand-700"
                  >
                    Відкрити
                  </a>
                )}
              </p>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function TextPills({ label, values }: { label: string; values: string[] }) {
  if (values.length === 0) return null;
  return (
    <div className="mt-3">
      <p className="mb-2 text-xs font-semibold text-ink">{label}</p>
      <div className="flex flex-wrap gap-2">
        {values.slice(0, 5).map((value) => (
          <span key={value} className="rounded-lg bg-ink/[0.04] px-2.5 py-1 text-xs text-ink-soft">
            {value}
          </span>
        ))}
      </div>
    </div>
  );
}

function sourceLinkLabel(sourceName: string): string {
  if (/work\.ua/i.test(sourceName)) return "Відкрити на Work.ua ↗";
  if (/robota\.ua/i.test(sourceName)) return "Відкрити на Robota.ua ↗";
  return `Джерело: ${sourceName} ↗`;
}

function CompanyOpenFactsSection({
  facts,
}: {
  facts: CompanyOpenFact[];
}) {
  const sourceSummaryFacts = getSourceSummaryFacts(facts);
  const realVacancyFacts = getRealVacancyFacts(facts);

  return (
    <Card className="space-y-4 p-6">
      <div>
        <h2 className="font-display text-lg font-bold text-ink">
          Відкриті факти з вакансій
        </h2>
        <p className="mt-1 text-sm text-ink-soft">
          Це дані з відкритих вакансій. Вони є заявленими умовами роботодавця і
          можуть відрізнятися від фактичних умов.
        </p>
      </div>

      {facts.length === 0 ? (
        <p className="rounded-xl bg-ink/[0.03] px-4 py-3 text-sm text-ink-soft">
          Підтверджених даних з відкритих вакансій поки немає.
        </p>
      ) : (
        <div className="space-y-4">
          {sourceSummaryFacts.length > 0 && (
            <div className="grid gap-3">
              {sourceSummaryFacts.map((fact) => {
                const count = extractOpenVacanciesCount(fact.rawExcerpt);
                return (
                  <div key={fact.id} className="rounded-xl border border-brand-100 bg-brand-50/40 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-ink">
                          Сторінка компанії у джерелі: {fact.sourceName}
                        </p>
                        <p className="mt-1 text-xs text-ink-muted">
                          Зібрано: {formatDate(fact.collectedAt)}
                        </p>
                      </div>
                      {fact.sourceUrl && (
                        <a
                          href={fact.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm font-medium text-brand-700 hover:text-brand-800"
                        >
                          {sourceLinkLabel(fact.sourceName)}
                        </a>
                      )}
                    </div>

                    {count !== null && (
                      <div className="mt-3 space-y-1.5">
                        <div className="inline-flex rounded-xl border border-brand-200 bg-white px-3 py-2 text-sm font-semibold text-brand-700">
                          Вакансій у відкритому джерелі: {count}
                        </div>
                        <p className="text-xs text-ink-muted">
                          Це кількість вакансій у відкритому джерелі, а не кількість відгуків.
                        </p>
                      </div>
                    )}

                    {shortText(fact.rawExcerpt) && (
                      <p className="mt-3 rounded-lg bg-white/70 px-3 py-2 text-xs leading-relaxed text-ink-muted">
                        {shortText(fact.rawExcerpt)}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {realVacancyFacts.length > 0 && (
            <div className="grid gap-3">
              {realVacancyFacts.map((fact) => (
                <div key={fact.id} className="rounded-xl border border-ink/[0.06] bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-ink">
                        {fact.vacancyTitle ?? "Вакансія без назви"}
                      </p>
                      <p className="mt-1 text-xs text-ink-muted">
                        {fact.sourceName} · зібрано: {formatDate(fact.collectedAt)}
                      </p>
                    </div>
                    {fact.sourceUrl && (
                      <a
                        href={fact.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-medium text-brand-700 hover:text-brand-800"
                      >
                        {sourceLinkLabel(fact.sourceName)}
                      </a>
                    )}
                  </div>

                  <div className="mt-3 grid gap-2 text-sm text-ink-soft sm:grid-cols-2">
                    <span><strong className="text-ink">Місто:</strong> {fact.city ?? "Не вказано"}</span>
                    <span><strong className="text-ink">Зарплата:</strong> {fact.salaryText ?? "Не вказана"}</span>
                    <span><strong className="text-ink">Графік:</strong> {fact.schedule ?? "Не вказано"}</span>
                    <span><strong className="text-ink">Оформлення:</strong> {fact.employmentType ?? "Не вказано"}</span>
                  </div>

                  <TextPills label="Умови" values={fact.conditions} />
                  <TextPills label="Переваги" values={fact.benefits} />
                  <TextPills label="Вимоги" values={fact.requirements} />

                  {shortText(fact.rawExcerpt) && (
                    <p className="mt-3 rounded-lg bg-ink/[0.03] px-3 py-2 text-xs leading-relaxed text-ink-muted">
                      {shortText(fact.rawExcerpt)}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function InterviewChecklistSection() {
  const questions = [
    "Яка фіксована ставка?",
    "Як виплачуються бонуси?",
    "Чи є офіційне оформлення з першого дня?",
    "Який графік?",
    "Чи оплачуються понаднормові?",
    "Чи є бронювання або відстрочка?",
  ];
  const visibleQuestions = questions.slice(0, 4);
  const hiddenQuestions = questions.slice(4);

  return (
    <section id="interview-checklist">
      <Card className="space-y-3 p-4 sm:p-5">
      <div>
        <p className="text-[0.6875rem] font-semibold uppercase tracking-widest text-brand-600">Підготовка до співбесіди</p>
        <h2 className="mt-1 font-display text-lg font-bold tracking-tight text-ink">
          Що уточнити перед співбесідою
        </h2>
      </div>
      <div className="flex flex-wrap gap-2">
        {visibleQuestions.map((question) => (
          <p key={question} className="rounded-full border border-brand-200/70 bg-brand-50/60 px-3 py-2 text-sm font-medium text-ink transition-colors">
            {question}
          </p>
        ))}
      </div>
      {hiddenQuestions.length > 0 && (
        <details className="rounded-xl border border-ink/[0.1] bg-white">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium text-ink">
            Показати ще {hiddenQuestions.length} питання
            <span className="accordion-chevron text-ink-muted">
              <ChevronDown className="h-4 w-4" />
            </span>
          </summary>
          <div className="border-t border-ink/[0.06] p-3">
            <div className="flex flex-wrap gap-2">
              {hiddenQuestions.map((question) => (
                <p key={question} className="rounded-full border border-brand-200/70 bg-brand-50/60 px-3 py-2 text-sm font-medium text-ink">
                  {question}
                </p>
              ))}
            </div>
          </div>
        </details>
      )}
      </Card>
    </section>
  );
}

function AddAnonymousReviewCta({ companySlug }: { companySlug: string }) {
  return (
    <div className="rounded-2xl bg-gradient-to-br from-[#0f1f1a] to-[#1a3028] p-5 sm:flex sm:items-center sm:justify-between sm:gap-6 sm:p-6">
      <div>
        <h2 className="font-display text-lg font-bold tracking-tight text-white">
          Допоможіть іншим кандидатам
        </h2>
        <p className="mt-1 text-sm text-white/65">
          Анонімний відгук відображається окремо від відкритих фактів і публікується тільки після модерації.
        </p>
      </div>
      <div className="mt-4 shrink-0 sm:mt-0">
        <Button href={`/add-review?company=${encodeURIComponent(companySlug)}`} variant="inverse" size="sm">
          <PenLine className="h-4 w-4" /> Додати відгук
        </Button>
      </div>
    </div>
  );
}

function CompanyReviewsCompactSection({
  companySlug,
  companyName,
  reviewCount,
}: {
  companySlug: string;
  companyName: string;
  reviewCount: number;
}) {
  if (reviewCount === 0) {
    return (
      <section className="space-y-3">
        <h2 className="font-display text-lg font-bold tracking-tight text-ink">Відгуки на Прозора робота</h2>
        <Card className="flex flex-col gap-4 border-brand-100 bg-brand-50/30 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-100 text-brand-700">
              <MessageSquare className="h-4 w-4" />
            </span>
            <div>
              <p className="font-semibold text-ink">
                На Прозора робота ще немає відгуків про цю компанію.
              </p>
              <p className="mt-0.5 text-sm text-ink-soft">
                Тільки опубліковані відгуки впливають на внутрішню оцінку.
              </p>
            </div>
          </div>
          <Button href={`/add-review?company=${encodeURIComponent(companySlug)}`} variant="secondary" size="sm">
            Залишити перший відгук
          </Button>
        </Card>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <h2 className="font-display text-lg font-bold tracking-tight text-ink">Відгуки на Прозора робота</h2>
      <CompanyReviewsSection
        companySlug={companySlug}
        companyName={companyName}
      />
      <p className="text-xs text-ink-muted">
        Тільки ці опубліковані відгуки впливають на внутрішню оцінку Прозора робота.
      </p>
    </section>
  );
}

function ExternalRatingsCompactSection({
  externalRatings,
  externalCompanySources,
}: {
  externalRatings: ExternalRating[];
  externalCompanySources: ExternalCompanySource[];
}) {
  const ratingSources = getExternalCompanyRatingSources(externalCompanySources);
  if (externalRatings.length === 0 && ratingSources.length === 0) {
    return (
      <Card className="flex items-center gap-2.5 p-4 text-sm text-ink-soft">
        <Star className="h-4 w-4 shrink-0 text-ink-muted" />
        Зовнішні оцінки поки не підтверджені.
      </Card>
    );
  }

  return (
    <ExternalRatingsSection
      ratings={externalRatings}
      companySourceRatings={ratingSources}
    />
  );
}

function ProEmployerSection({
  title,
  summary,
  questions,
}: {
  title: string;
  summary: string;
  questions?: string[];
}) {
  return (
    <div className="rounded-xl border border-ink/[0.06] bg-white p-4">
      <h3 className="mb-2 text-sm font-semibold text-ink">{title}</h3>
      <p className="text-sm leading-relaxed text-ink-soft">{summary}</p>
      {questions && questions.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {questions.map((question) => (
            <li key={question} className="text-sm text-ink-soft">
              {question}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CompanyProAnalysis({
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
  const dataLevel = getCompanyDataLevel(
    facts,
    externalRatings.length,
    openFactSummary.factsCount,
    externalReviewSignalSummary.signalCount,
    externalCompanySourceSummary.sourceCount
  );
  const externalRatingSources = getExternalCompanyRatingSources(externalCompanySources);
  const externalReviewSources = externalCompanySources.filter((source) => source.sourceType === "reviews");
  const externalReputationSourceCount = externalRatingSources.length + externalReviewSources.length;
  const lowData = dataLevel === "Поки недостатньо даних";
  const onlyOpenFacts =
    facts.reviewCount === 0 &&
    externalRatings.length === 0 &&
    externalReviewSignalSummary.signalCount === 0 &&
    externalReputationSourceCount === 0 &&
    (openFactSummary.factsCount > 0 || getExternalCompanyOpenSources(externalCompanySources).length > 0);
  const onlyExternalReviewSignals =
    facts.reviewCount === 0 &&
    externalRatings.length === 0 &&
    openFactSummary.factsCount === 0 &&
    externalCompanySourceSummary.sourceCount === 0 &&
    externalReviewSignalSummary.signalCount > 0;
  const salaryCounts = formatCounts(facts.salaryMatchCounts, {
    yes: "відповідає заявленій",
    partial: "частково відповідає",
    no: "не відповідає",
  });
  const employmentCounts = formatCounts(facts.employmentCounts, {
    official_day_one: "офіційно з першого дня",
    after_internship: "після стажування",
    unofficial: "неофіційно",
  });
  const bookingCounts = formatCounts(facts.bookingCounts, {
    yes: "бронювання отримували",
    no: "не отримували",
    promised_later: "обіцяли пізніше",
  });
  const salarySummaryParts = [
    facts.hasSalaryData
      ? [
          facts.salaryAverage !== null ? `За відгуками є оцінки зарплати: ${formatAverage(facts.salaryAverage)}.` : null,
          salaryCounts ? `Відповідність заявленій зарплаті за відгуками: ${salaryCounts}.` : null,
        ].filter(Boolean).join(" ")
      : null,
    openFactSummary.salaryExamples.length > 0
      ? `У відкритих вакансіях згадуються: ${openFactSummary.salaryExamples.slice(0, 3).join("; ")}. Це дані з вакансій, а не підтвердження фактичних виплат.`
      : null,
  ].filter(Boolean);
  const salarySummary = salarySummaryParts.length ? salarySummaryParts.join(" ") : "Недостатньо даних про зарплату.";
  const employmentSummary = facts.hasEmploymentData
    ? `За відгуками є структуровані відповіді про оформлення: ${employmentCounts || "деталі не визначені"}.`
    : openFactSummary.hasOfficialEmploymentMention || openFactSummary.employmentTypes.length > 0
      ? `У вакансіях згадується оформлення: ${openFactSummary.employmentTypes[0] ?? "офіційне оформлення"}. Це потрібно підтвердити письмово.`
      : "Недостатньо даних про офіційне оформлення.";
  const scheduleSummary = facts.hasScheduleData
    ? `За відгуками є оцінки графіку: ${formatAverage(facts.scheduleAverage)}. Деталі графіку потрібно уточнювати окремо.`
    : openFactSummary.schedules.length > 0
      ? `У відкритих вакансіях згадуються графіки: ${openFactSummary.schedules.slice(0, 3).join("; ")}.`
      : "Недостатньо даних про графік і навантаження.";
  const bookingSummary = facts.hasBookingData
    ? `За відгуками є структуровані відповіді про бронювання: ${bookingCounts || "деталі не визначені"}.`
    : openFactSummary.hasBookingMention
      ? "У вакансіях згадується бронювання/відстрочка, потрібно перевіряти підставу, строк і письмове підтвердження."
      : "Недостатньо даних про бронювання або відстрочку.";
  const reviewsSummary = facts.reviewCount > 0
    ? `На Прозора робота є ${facts.reviewCount} опублікованих відгуків. Внутрішня оцінка: ${formatAverage(facts.averageInternalRating)}.`
    : "На Прозора робота ще немає опублікованих відгуків.";
  const externalRatingCount = externalRatings.length + externalRatingSources.length;
  const externalSummary = externalRatingCount > 0
    ? `Є ${externalRatingCount} підтверджених зовнішніх оцінок. Зовнішні оцінки не є відгуками Прозора робота і не впливають на внутрішній рейтинг.`
    : "Підтверджених зовнішніх оцінок поки немає. Зовнішні оцінки не є відгуками Прозора робота і не впливають на внутрішній рейтинг.";
  const externalReviewSignalText = externalReviewSignalSummary.signalCount > 0
    ? [
        `За відкритими джерелами є ${externalReviewSignalSummary.signalCount} підтверджених узагальнених сигналів.`,
        externalReviewSignalSummary.topSignals
          .map((signal) => `${TOPIC_LABELS[signal.topic]}: ${SENTIMENT_LABELS[signal.sentiment]} — ${signal.summary}`)
          .join(" "),
        "Це не відгуки Прозора робота. Це узагальнення зовнішніх джерел.",
      ].join(" ")
    : "Недостатньо даних із зовнішніх відгуків. Це не відгуки Прозора робота і не впливає на внутрішній рейтинг.";
  const realVacancyTitles = uniqueText(getRealVacancyFacts(openFacts).map((fact) => fact.vacancyTitle), 3);
  const sourceSummaryFacts = getSourceSummaryFacts(openFacts);
  const sourceSummaryText = uniqueText(
    sourceSummaryFacts.map((fact) => {
      const count = extractOpenVacanciesCount(fact.rawExcerpt);
      return count === null
        ? `Джерело: сторінка компанії на ${fact.sourceName}.`
        : `Джерело: сторінка компанії на ${fact.sourceName}; вакансій у відкритому джерелі: ${count}.`;
    }),
    3
  );
  const openFactsSummary = openFactSummary.factsCount > 0
    ? [
        `Джерела: ${openFactSummary.sources.join(" / ")}.`,
        `Останнє оновлення: ${formatDate(openFactSummary.latestCollectedAt)}.`,
        ...sourceSummaryText,
        joinExamples("Вакансії", realVacancyTitles),
        joinExamples("Міста", openFactSummary.cities),
        joinExamples("Зарплати", openFactSummary.salaryExamples),
        joinExamples("Умови", openFactSummary.conditions),
        joinExamples("Переваги", openFactSummary.benefits),
        "Це дані з відкритих вакансій. Вони не є відгуками працівників і можуть відрізнятися від реальних умов.",
      ].filter(Boolean).join(" ")
    : "Підтверджених публічних даних з відкритих вакансій поки немає.";
  const questions = [
    "Яка фіксована ставка?",
    "Як виплачуються бонуси?",
    "Чи є затримки виплат?",
    "Чи є офіційне оформлення з першого дня?",
    "Який тип договору?",
    "Чи оплачують випробувальний термін?",
    "Який точний графік?",
    "Як оплачуються понаднормові?",
    "Чи є нічні зміни або робота у вихідні?",
    "Чи надають бронювання і чи дають письмове підтвердження?",
  ];
  const finalSummary = onlyOpenFacts
    ? "Є часткові дані з відкритих вакансій, але недостатньо відгуків працівників. Перед рішенням потрібно уточнити оплату, оформлення і графік письмово."
    : onlyExternalReviewSignals
      ? "Є часткові узагальнення за відкритими джерелами, але недостатньо відгуків працівників і підтверджених фактів вакансій. Перед рішенням потрібно перевірити оплату, оформлення і графік письмово."
    : lowData
    ? "Недостатньо даних для повної оцінки роботодавця. Перед рішенням варто уточнити оплату, оформлення, графік і перевірити умови письмово."
    : "Висновок потрібно будувати тільки на фактичних published reviews, підтверджених зовнішніх оцінках і підтверджених даних з відкритих вакансій. Перед рішенням все одно варто підтвердити ключові умови письмово.";
  const proIncludes = [
    "ризики по зарплаті",
    "оформлення",
    "графік",
    "бронювання / відстрочка",
    "порівняння з іншими роботодавцями",
    "список питань для співбесіди",
  ];

  return (
    <Card className="space-y-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-bold text-ink">
            Розширений аналіз роботодавця
          </h2>
          <p className="mt-1 text-sm text-ink-soft">
            {lowData
              ? "Недостатньо даних для повної оцінки. Нижче — що потрібно перевірити перед відгуком / співбесідою."
              : "Безкоштовний аналіз на основі відкритих даних, без вигаданих фактів."}
          </p>
        </div>
      </div>

      <details className="rounded-xl border border-ink/[0.06] bg-ink/[0.02] p-4">
        <summary className="cursor-pointer list-none text-sm font-semibold text-ink">
          Показати деталі
        </summary>
        <div className="mt-4 space-y-4">
          <div className="rounded-xl border border-ink/[0.06] bg-white p-4">
            <p className="text-sm font-semibold text-ink">Що можна перевірити</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {proIncludes.map((item) => (
                <p key={item} className="flex items-start gap-2 text-sm text-ink-soft">
                  <ClipboardList className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
                  {item}
                </p>
              ))}
            </div>
            <p className="mt-3 text-xs leading-relaxed text-ink-muted">
              Порівняння з іншими роботодавцями буде доступне тільки там, де є достатньо фактичних даних.
              Розширений аналіз не гарантує безпеку і не вигадує репутацію роботодавця.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <ProEmployerSection
              title="Зарплата і прозорість оплати"
              summary={salarySummary}
              questions={["Яка фіксована ставка?", "Як виплачуються бонуси?", "Чи є затримки виплат?"]}
            />
            <ProEmployerSection
              title="Оформлення і юридичні ризики"
              summary={employmentSummary}
              questions={["Чи є офіційне оформлення з першого дня?", "Який тип договору?", "Чи оплачують випробувальний термін?"]}
            />
            <ProEmployerSection
              title="Графік і навантаження"
              summary={scheduleSummary}
              questions={["Який точний графік?", "Як оплачуються понаднормові?", "Чи є нічні зміни або робота у вихідні?"]}
            />
            <ProEmployerSection
              title="Бронювання / відстрочка"
              summary={bookingSummary}
              questions={["Чи надають бронювання?", "На якій підставі?", "На який строк?", "Чи дають письмове підтвердження?"]}
            />
            <ProEmployerSection title="Відгуки працівників" summary={reviewsSummary} />
            <ProEmployerSection title="Оцінки з відкритих джерел" summary={externalSummary} />
            <ProEmployerSection title="Сигнали з відкритих джерел" summary={externalReviewSignalText} />
            <ProEmployerSection title="Дані з відкритих вакансій" summary={openFactsSummary} />
            <ProEmployerSection
              title="Що уточнити перед співбесідою"
              summary="Практичні питання для перевірки умов."
              questions={questions}
            />
            <ProEmployerSection title="Підсумкова рекомендація" summary={finalSummary} />
          </div>
        </div>
      </details>
    </Card>
  );
}

// ── generateMetadata ──────────────────────────────────────────────────────────

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;

  // ── Try Supabase (canonical source) ───────────────────────────────────────
  const sb = await getSupabaseCompanyBySlug(slug);
  if (sb) {
    const reviewCount = await getPublishedReviewCount(slug);
    const industry    = normalizeIndustry(sb.industry);
    const location    = sb.city ?? null;

    // Build context suffix if industry/city are available
    const contextParts: string[] = [];
    if (industry) contextParts.push(`Сфера: ${industry}.`);
    if (location) contextParts.push(`Локація: ${location}.`);
    const context = contextParts.length ? ` ${contextParts.join(" ")}` : "";

    let title: string;
    let description: string;

    if (reviewCount > 0) {
      title = `Відгуки про ${sb.name} — зарплата, умови, оформлення | Прозора робота`;
      description =
        `Анонімні відгуки працівників про роботу в ${sb.name}: ` +
        `зарплата, графік, умови, оформлення, бронювання, співбесіда та ризики.${context}`;
    } else {
      title = `${sb.name} — сторінка компанії | Прозора робота`;
      description =
        `Сторінка компанії ${sb.name} на Прозора робота. ` +
        `Додайте перший анонімний відгук або перевірте інформацію перед співбесідою.${context}`;
    }

    return {
      title,
      description,
      openGraph: { title, description, type: "website" },
      twitter:   { card: "summary", title, description },
    };
  }

  // ── Supabase not configured — use mock name only ───────────────────────────
  const mock = COMPANIES.find((c) => c.slug === slug);
  if (mock) {
    const industry = normalizeIndustry(mock.industry);
    const context  = industry ? ` Сфера: ${industry}.` : "";
    const title =
      `${mock.name} — сторінка компанії | Прозора робота`;
    const description =
      `Сторінка компанії ${mock.name} на Прозора робота. ` +
      `Додайте перший анонімний відгук або перевірте інформацію перед співбесідою.${context}`;
    return {
      title,
      description,
      openGraph: { title, description, type: "website" },
      twitter:   { card: "summary", title, description },
    };
  }

  // ── Not found ─────────────────────────────────────────────────────────────
  const title       = "Компанію не знайдено | Прозора робота";
  const description =
    "Компанія не знайдена у базі Прозора робота. " +
    "Ви можете додати перший анонімний відгук.";
  return {
    title,
    description,
    openGraph: { title, description, type: "website" },
    twitter:   { card: "summary", title, description },
  };
}

export default async function CompanyPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  // ── Resolve company info ──────────────────────────────────────────────────
  // Canonical source: Supabase public.companies
  const sbCompany = await getSupabaseCompanyBySlug(slug);

  // If slug not found anywhere, 404
  if (!sbCompany) {
    // Check if it's a known mock slug (Supabase may not be configured yet)
    const mockFallback = COMPANIES.find((c) => c.slug === slug);
    if (!mockFallback) notFound();
    const [
      externalRatings,
      externalReviewSignals,
      externalReviewSignalSummary,
      externalCompanySources,
      externalCompanySourceSummary,
      reviewFacts,
      openFacts,
      openFactSummary,
    ] = await Promise.all([
      getPublicExternalRatings(slug),
      getPublicExternalReviewSignals(slug),
      getPublicExternalReviewSignalSummary(slug),
      getPublicCompanyExternalSources(slug),
      getPublicCompanyExternalSourceSummary(slug),
      getPublishedCompanyReviewFacts(slug),
      getPublicCompanyOpenFacts(slug),
      getPublicCompanyOpenFactsSummary(slug),
    ]);
    const fallbackIndustry = normalizeIndustry(mockFallback.industry);

    // Supabase not configured — show name only with a prompt to add a review
    return (
      <div className="container-page max-w-3xl space-y-6 py-8 sm:py-10">
        <Card variant="elevated" className="relative overflow-hidden p-6 sm:p-8">
          <div className="absolute inset-x-0 top-0 h-0.5 rounded-t-2xl bg-gradient-to-r from-brand-400 via-brand-500 to-brand-600" />
          <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
            {mockFallback.name}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-soft">
            {mockFallback.city && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5" /> {mockFallback.city}
              </span>
            )}
            {mockFallback.industry && (
              <span className="inline-flex items-center gap-1.5">
                <Briefcase className="h-3.5 w-3.5" /> {fallbackIndustry}
              </span>
            )}
          </div>
          <div className="mt-4 border-t border-ink/[0.1] pt-4">
            <div className="flex flex-wrap gap-2">
              <Button href={`/add-review?company=${encodeURIComponent(slug)}`} size="sm">
                <PenLine className="h-4 w-4" /> Додати відгук
              </Button>
              <Button href="/check-vacancy" variant="outline" size="sm">
                <FileSearch className="h-4 w-4" /> Перевірити вакансію
              </Button>
            </div>
          </div>
        </Card>
        <CompanyQuickCheckCard
          companyName={mockFallback.name}
          facts={reviewFacts}
          externalRatings={externalRatings}
          externalCompanySources={externalCompanySources}
          openFacts={openFacts}
          openFactSummary={openFactSummary}
          externalReviewSignalSummary={externalReviewSignalSummary}
          externalCompanySourceSummary={externalCompanySourceSummary}
        />
        <ExternalCompanySourcesSection
          sources={externalCompanySources}
          openFacts={openFacts}
        />
        <CompanyReviewsCompactSection
          companySlug={mockFallback.slug}
          companyName={mockFallback.name}
          reviewCount={reviewFacts.reviewCount}
        />
        <ExternalRatingsCompactSection
          externalRatings={externalRatings}
          externalCompanySources={externalCompanySources}
        />
        {externalReviewSignals.length > 0 && <ExternalReviewSignalsSection signals={externalReviewSignals} />}
        <InterviewChecklistSection />
        <AddAnonymousReviewCta companySlug={mockFallback.slug} />
        <p className="text-center text-xs text-ink-muted">
          Інформація про компанію формується на основі анонімних відгуків і не є офіційною
          оцінкою роботодавця.
        </p>
      </div>
    );
  }

  // ── Main page: real Supabase company + real published reviews ─────────────
  const industry = normalizeIndustry(sbCompany.industry);
    const [
      externalRatings,
      externalReviewSignals,
      externalReviewSignalSummary,
      externalCompanySources,
      externalCompanySourceSummary,
      reviewFacts,
      openFacts,
      openFactSummary,
    ] = await Promise.all([
      getPublicExternalRatings(sbCompany.slug),
      getPublicExternalReviewSignals(sbCompany.slug),
      getPublicExternalReviewSignalSummary(sbCompany.slug),
      getPublicCompanyExternalSources(sbCompany.slug),
      getPublicCompanyExternalSourceSummary(sbCompany.slug),
      getPublishedCompanyReviewFacts(sbCompany.slug),
      getPublicCompanyOpenFacts(sbCompany.slug),
      getPublicCompanyOpenFactsSummary(sbCompany.slug),
  ]);

  return (
    <div className="container-page max-w-3xl space-y-6 py-8 sm:py-10">
      {/* Header */}
      <Card variant="elevated" className="relative overflow-hidden p-6 sm:p-8">
        <div className="absolute inset-x-0 top-0 h-0.5 rounded-t-2xl bg-gradient-to-r from-brand-400 via-brand-500 to-brand-600" />
        <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
          {sbCompany.name}
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-soft">
          {sbCompany.city && (
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" /> {sbCompany.city}
            </span>
          )}
          {industry && (
            <span className="inline-flex items-center gap-1.5">
              <Briefcase className="h-3.5 w-3.5" /> {industry}
            </span>
          )}
        </div>
        <div className="mt-4 border-t border-ink/[0.1] pt-4">
          <div className="flex flex-wrap gap-2">
            <Button href={`/add-review?company=${encodeURIComponent(sbCompany.slug)}`} size="sm">
              <PenLine className="h-4 w-4" /> Додати відгук
            </Button>
            <Button href="/check-vacancy" variant="outline" size="sm">
              <FileSearch className="h-4 w-4" /> Перевірити вакансію
            </Button>
          </div>
        </div>
      </Card>

      <CompanyQuickCheckCard
        companyName={sbCompany.name}
        facts={reviewFacts}
        externalRatings={externalRatings}
        externalCompanySources={externalCompanySources}
        openFacts={openFacts}
        openFactSummary={openFactSummary}
        externalReviewSignalSummary={externalReviewSignalSummary}
        externalCompanySourceSummary={externalCompanySourceSummary}
      />

      <ExternalCompanySourcesSection
        sources={externalCompanySources}
        openFacts={openFacts}
      />

      <CompanyReviewsCompactSection
        companySlug={sbCompany.slug}
        companyName={sbCompany.name}
        reviewCount={reviewFacts.reviewCount}
      />

      <ExternalRatingsCompactSection
        externalRatings={externalRatings}
        externalCompanySources={externalCompanySources}
      />

      {externalReviewSignals.length > 0 && <ExternalReviewSignalsSection signals={externalReviewSignals} />}

      <InterviewChecklistSection />

      <AddAnonymousReviewCta companySlug={sbCompany.slug} />

      <p className="text-center text-xs text-ink-muted">
        Інформація про компанію формується на основі анонімних відгуків і не є офіційною
        оцінкою роботодавця.
      </p>
    </div>
  );
}
