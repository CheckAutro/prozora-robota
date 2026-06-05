"use client";

import { useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  Briefcase,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  ExternalLink,
  FileText,
  Loader2,
  MapPin,
  MessageSquare,
  MessageSquareText,
  RefreshCw,
  Search,
  ShieldCheck,
  Star,
  UsersRound,
} from "lucide-react";
import { Card, SectionTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { AiVacancyAnalysisSection } from "@/components/product/AiAnalysisPanel";
import { cn } from "@/lib/cn";
import { normalizeIndustry } from "@/lib/industry";
import type {
  ExternalRating,
  ExternalReviewSignalSentiment,
  ExternalReviewSignalTopic,
  RiskLevel,
} from "@/lib/types";

type SourceName = "Work.ua" | "Robota.ua" | "URL" | "Вручну";

interface ReportCompany {
  name: string;
  slug: string;
  city: string | null;
  industry: string | null;
}

interface ParsedVacancy {
  source: SourceName;
  sourceUrl: string | null;
  title: string | null;
  companyName: string | null;
  city: string | null;
  salaryText: string | null;
  employmentType: string | null;
  schedule: string | null;
  experience: string | null;
  education: string | null;
  skills: string[];
  benefits: string[];
  requirements: string[];
  responsibilities: string[];
  conditions: string[];
  companyDescription: string | null;
  publishedAt: string | null;
  mentionsOfficialEmployment: boolean;
  mentionsBooking: boolean;
  mentionsProbation: boolean;
  mentionsBonus: boolean;
  descriptionText: string;
}

interface ReviewPreview {
  id: string;
  roleCategory: string;
  city: string;
  year: number;
  text: string;
}

interface InternalReviewsSummary {
  reviewCount: number;
  averageRating: number | null;
  riskSignals: string[];
  recentReviews: ReviewPreview[];
}

interface VacancyRiskReport {
  riskScore: number;
  riskLevel: RiskLevel;
  factors: string[];
  positives: string[];
  warnings: string[];
  criticalWarnings: string[];
}

type ProStatus = "clear" | "unclear" | "suspicious" | "risky";
type FinalVerdictLevel = "safe_to_apply" | "apply_with_caution" | "avoid";
type BriefTone = "positive" | "warning" | "danger" | "neutral";

interface FreeSummary {
  mainConclusion: string;
  riskLevelText: string;
  topWarnings: string[];
  topPositives: string[];
  missingInfo: string[];
  applyAdvice: string;
}

interface CompanyInsight {
  found: boolean;
  name: string | null;
  slug: string | null;
  industry: string | null;
  city: string | null;
  publishedReviewsCount: number;
  averageInternalRating: number | null;
  hasExternalRatings: boolean;
  summaryText: string;
}

interface ProPreviewSection {
  status: ProStatus;
  summary: string;
  questions: string[];
}

interface ProPreview {
  salary: ProPreviewSection;
  employment: ProPreviewSection;
  schedule: ProPreviewSection;
  booking: {
    mentioned: boolean;
    summary: string;
    questions: string[];
  };
  interviewQuestions: string[];
  documentChecklist: string[];
  finalVerdict: {
    level: FinalVerdictLevel;
    text: string;
  };
}

interface VacancyBriefStatus {
  label: string;
  tone: BriefTone;
  text: string;
}

interface VacancyBrief {
  salaryStatus: VacancyBriefStatus;
  employmentStatus: VacancyBriefStatus;
  scheduleStatus: VacancyBriefStatus;
  riskPhrases: string[];
  questionsToAsk: string[];
  shortVerdict: string;
}

interface VacancyAnalysis {
  freeSummary: FreeSummary;
  companyInsight: CompanyInsight;
  proPreview: ProPreview;
  vacancyBrief: VacancyBrief;
}

interface ExternalReviewTopSignal {
  topic: ExternalReviewSignalTopic;
  sentiment: ExternalReviewSignalSentiment;
  summary: string;
  sourceName: string;
  mentionsCount: number;
}

interface ExternalReviewSignalSummary {
  companySlug: string;
  signalCount: number;
  sourceCount: number;
  sources: string[];
  topics: ExternalReviewSignalTopic[];
  positiveCount: number;
  mixedCount: number;
  negativeCount: number;
  neutralCount: number;
  topSignals: ExternalReviewTopSignal[];
}

interface CompanyOpenFactSummary {
  companySlug: string;
  factsCount: number;
  sourceCount: number;
  sources: string[];
  cities: string[];
  salaryExamples: string[];
  vacancyTitles: string[];
  schedules: string[];
  employmentTypes: string[];
  benefits: string[];
  requirements: string[];
  conditions: string[];
  hasOfficialEmploymentMention: boolean;
  hasBookingMention: boolean;
  hasBonusMention: boolean;
  companyDescription: string | null;
  latestCollectedAt: string | null;
}

interface VacancyReport {
  ok: true;
  inputType: string;
  parsedVacancy: ParsedVacancy;
  matchedCompany: ReportCompany | null;
  internalReviews: InternalReviewsSummary;
  externalRatings: ExternalRating[];
  externalReviewSignals: ExternalReviewSignalSummary | null;
  companyOpenFacts: CompanyOpenFactSummary | null;
  risk: VacancyRiskReport;
  analysis: VacancyAnalysis;
  fallbackReason: string | null;
}

interface ManualTextNeededReport {
  ok: false;
  needsManualText: true;
  inputType?: string;
  message: string;
  fallbackReason?: string | null;
}

type CheckVacancyResponse = VacancyReport | ManualTextNeededReport | { error?: string };

type Stage =
  | { type: "idle" }
  | { type: "loading" }
  | { type: "result"; report: VacancyReport }
  | { type: "manual-needed"; message: string }
  | { type: "error"; message: string };

const RISK_META: Record<RiskLevel, { label: string; className: string }> = {
  low: {
    label: "Низький",
    className: "border-brand-200 bg-brand-50 text-brand-700",
  },
  medium: {
    label: "Середній",
    className: "border-amber-200 bg-amber-50 text-amber-700",
  },
  high: {
    label: "Високий",
    className: "border-red-200 bg-red-50 text-red-700",
  },
  unknown: {
    label: "Недостатньо даних",
    className: "border-ink/10 bg-ink/[0.04] text-ink-soft",
  },
};

const PRO_STATUS_META: Record<ProStatus, { label: string; className: string }> = {
  clear: {
    label: "Зрозуміло",
    className: "border-brand-200 bg-brand-50 text-brand-700",
  },
  unclear: {
    label: "Потрібно уточнити",
    className: "border-amber-200 bg-amber-50 text-amber-700",
  },
  suspicious: {
    label: "Насторожує",
    className: "border-red-200 bg-red-50 text-red-700",
  },
  risky: {
    label: "Ризиково",
    className: "border-red-200 bg-red-50 text-red-700",
  },
};

const BRIEF_TONE_META: Record<BriefTone, { className: string; dotClassName: string }> = {
  positive: {
    className: "border-brand-200 bg-brand-50 text-brand-800",
    dotClassName: "bg-brand-500",
  },
  warning: {
    className: "border-amber-200 bg-amber-50 text-amber-800",
    dotClassName: "bg-amber-400",
  },
  danger: {
    className: "border-red-200 bg-red-50 text-red-800",
    dotClassName: "bg-red-500",
  },
  neutral: {
    className: "border-ink/10 bg-ink/[0.04] text-ink-soft",
    dotClassName: "bg-ink-muted",
  },
};

const EXTERNAL_SIGNAL_TOPIC_LABELS: Record<ExternalReviewSignalTopic, string> = {
  salary: "Зарплата",
  schedule: "Графік",
  employment: "Оформлення",
  management: "Керівництво",
  workload: "Навантаження",
  payment_delay: "Затримки виплат",
  interview: "Співбесіда",
  booking: "Бронювання",
  benefits: "Бонуси / переваги",
  career: "Карʼєра",
  culture: "Культура",
  other: "Інше",
};

const EXTERNAL_SIGNAL_SENTIMENT_LABELS: Record<ExternalReviewSignalSentiment, string> = {
  positive: "позитивно",
  mixed: "змішано",
  negative: "негативно",
  neutral: "нейтрально",
};

function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={cn(
            "h-3.5 w-3.5",
            n <= Math.round(value)
              ? "fill-amber-400 text-amber-400"
              : "text-ink/15"
          )}
        />
      ))}
    </span>
  );
}

function formatDate(value: string | null): string {
  if (!value) return "Без дати";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Без дати";
  return date.toLocaleDateString("uk-UA");
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("uk-UA").format(value);
}

function detailValue(value: string | null | undefined): string {
  return value && value.trim() ? value : "Не визначено";
}

function displayInputType(inputType: string): string {
  if (inputType === "work.ua URL") return "Work.ua";
  if (inputType === "robota.ua URL") return "Robota.ua";
  if (inputType === "text" || inputType === "company name") return "Вручну";
  return inputType;
}

function dataStatus(inputType: string): string {
  return inputType === "work.ua URL" || inputType === "robota.ua URL"
    ? "Дані зчитано автоматично"
    : "Дані введено вручну";
}

function DetailItem({
  label,
  value,
  icon,
}: {
  label: string;
  value: string | null | undefined;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-ink/[0.06] bg-white px-4 py-3">
      <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-ink-muted">
        {icon}
        {label}
      </div>
      <p className="text-sm font-semibold text-ink">{detailValue(value)}</p>
    </div>
  );
}

function MiniReview({ review }: { review: ReviewPreview }) {
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

function ExternalRatingCard({ rating }: { rating: ExternalRating }) {
  return (
    <div className="rounded-xl border border-ink/[0.06] bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-ink">{rating.sourceName}</p>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-ink-muted">
            <span className="inline-flex items-center gap-1">
              <CalendarClock className="h-3.5 w-3.5" />
              {formatDate(rating.fetchedAt)}
            </span>
            <span className="inline-flex items-center gap-1">
              <UsersRound className="h-3.5 w-3.5" />
              {formatNumber(rating.reviewsCount)}
            </span>
          </div>
        </div>
        <div className="rounded-lg bg-brand-50 px-3 py-2 text-sm font-semibold text-brand-700">
          {rating.ratingValue !== null
            ? `${rating.ratingValue.toFixed(1)} / ${rating.ratingScale ?? 5}`
            : "Без оцінки"}
        </div>
      </div>

      {rating.note && (
        <p className="mt-3 rounded-lg bg-ink/[0.03] px-3 py-2 text-xs text-ink-muted">
          {rating.note}
        </p>
      )}

      {rating.sourceUrl && (
        <a
          href={rating.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:text-brand-800"
        >
          Відкрити джерело <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}
    </div>
  );
}

function SignalList({
  emptyText,
  items,
  tone,
}: {
  emptyText: string;
  items: string[];
  tone: "warning" | "positive";
}) {
  const dotClass = tone === "warning" ? "bg-amber-400" : "bg-brand-500";

  if (items.length === 0) {
    return <p className="text-sm text-ink-soft">{emptyText}</p>;
  }

  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2 text-sm text-ink-soft">
          <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", dotClass)} />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function VacancySummary({ report }: { report: VacancyReport }) {
  const { parsedVacancy, matchedCompany, risk, analysis } = report;
  const riskMeta = RISK_META[risk.riskLevel];

  return (
    <Card className="space-y-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-brand-600">
            Джерело: {parsedVacancy.source}
          </p>
          <h2 className="mt-1 font-display text-xl font-bold text-ink">
            {parsedVacancy.title ?? "Вакансія без визначеної назви"}
          </h2>
        </div>
        <span className={cn("rounded-full border px-3 py-1 text-sm font-semibold", riskMeta.className)}>
          {analysis.freeSummary.riskLevelText || `Ризик: ${riskMeta.label}`}
        </span>
      </div>

      {report.fallbackReason && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Не вдалося автоматично зчитати вакансію. Скопіюйте текст вакансії та
            вставте його в поле перевірки.
          </span>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <DetailItem
          label="Компанія"
          value={matchedCompany?.name ?? parsedVacancy.companyName}
          icon={<Briefcase className="h-3.5 w-3.5" />}
        />
        <DetailItem
          label="Місто"
          value={parsedVacancy.city ?? matchedCompany?.city}
          icon={<MapPin className="h-3.5 w-3.5" />}
        />
        <DetailItem
          label="Зарплата"
          value={parsedVacancy.salaryText}
          icon={<UsersRound className="h-3.5 w-3.5" />}
        />
        <DetailItem
          label="Тип вводу"
          value={displayInputType(report.inputType)}
          icon={<Search className="h-3.5 w-3.5" />}
        />
      </div>

      <div className="flex flex-wrap gap-2 text-xs font-medium">
        <span className="rounded-full bg-brand-50 px-3 py-1 text-brand-700">
          {dataStatus(report.inputType)}
        </span>
        <span className={cn(
          "rounded-full px-3 py-1",
          matchedCompany ? "bg-brand-50 text-brand-700" : "bg-ink/[0.04] text-ink-muted"
        )}>
          {matchedCompany ? "Компанію знайдено в базі" : "Компанію не знайдено"}
        </span>
      </div>

      <p className="rounded-xl bg-ink/[0.03] px-4 py-3 text-sm text-ink-soft">
        {analysis.companyInsight.summaryText}
      </p>
    </Card>
  );
}

function FreeSummarySection({ summary }: { summary: FreeSummary }) {
  return (
    <Card className="space-y-3 p-6">
      <h3 className="font-display text-lg font-bold text-ink">
        Короткий висновок
      </h3>
      <p className="text-sm leading-relaxed text-ink-soft">
        {summary.mainConclusion}
      </p>
      <p className="rounded-xl bg-brand-50 px-4 py-3 text-sm font-semibold text-brand-800">
        {summary.applyAdvice}
      </p>
    </Card>
  );
}

function VacancyBriefStatusCard({
  title,
  status,
}: {
  title: string;
  status: VacancyBriefStatus;
}) {
  const tone = BRIEF_TONE_META[status.tone];

  return (
    <div className={cn("rounded-xl border p-4", tone.className)}>
      <div className="mb-2 flex items-center gap-2">
        <span className={cn("h-2 w-2 shrink-0 rounded-full", tone.dotClassName)} />
        <h4 className="text-sm font-semibold">{title}</h4>
      </div>
      <p className="text-sm font-semibold">{status.label}</p>
      <p className="mt-1 text-xs leading-relaxed opacity-85">{status.text}</p>
    </div>
  );
}

function vacancyFactItems(parsed: ParsedVacancy): string[] {
  return [
    parsed.companyDescription ? `Опис компанії: ${parsed.companyDescription}` : null,
    parsed.employmentType ? `Оформлення: ${parsed.employmentType}` : null,
    parsed.schedule ? `Графік: ${parsed.schedule}` : null,
    parsed.experience ? `Досвід: ${parsed.experience}` : null,
    parsed.education ? `Освіта: ${parsed.education}` : null,
    parsed.conditions.length ? `Умови: ${parsed.conditions.slice(0, 2).join("; ")}` : null,
    parsed.benefits.length ? `Переваги: ${parsed.benefits.slice(0, 2).join("; ")}` : null,
    parsed.requirements.length ? `Вимоги: ${parsed.requirements.slice(0, 2).join("; ")}` : null,
  ].filter(Boolean).slice(0, 5) as string[];
}

function VacancyBriefSection({
  brief,
  parsed,
}: {
  brief: VacancyBrief;
  parsed: ParsedVacancy;
}) {
  const facts = vacancyFactItems(parsed);

  return (
    <Card className="space-y-5 p-6">
      <div>
        <h3 className="font-display text-lg font-bold text-ink">
          Короткий аналіз вакансії
        </h3>
        <p className="mt-1 text-sm text-ink-soft">
          Безкоштовний первинний аналіз ключових умов з тексту вакансії.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <VacancyBriefStatusCard title="Зарплата" status={brief.salaryStatus} />
        <VacancyBriefStatusCard title="Оформлення" status={brief.employmentStatus} />
        <VacancyBriefStatusCard title="Графік" status={brief.scheduleStatus} />
      </div>

      {facts.length > 0 && (
        <div className="space-y-3 rounded-xl border border-ink/[0.06] bg-white p-4">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <FileText className="h-4 w-4 text-brand-700" />
            Факти з вакансії
          </h4>
          <ul className="space-y-2">
            {facts.map((fact) => (
              <li key={fact} className="text-sm leading-relaxed text-ink-soft">
                {fact}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3 rounded-xl border border-ink/[0.06] bg-white p-4">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-amber-700">
            <AlertTriangle className="h-4 w-4" />
            Ризикові формулювання
          </h4>
          <SignalList
            tone="warning"
            items={brief.riskPhrases.slice(0, 3)}
            emptyText="Критичних формулювань не знайдено."
          />
        </div>

        <div className="space-y-3 rounded-xl border border-ink/[0.06] bg-white p-4">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-brand-700">
            <CircleHelp className="h-4 w-4" />
            Що уточнити
          </h4>
          <ul className="space-y-2">
            {brief.questionsToAsk.slice(0, 5).map((question) => (
              <li key={question} className="text-sm leading-relaxed text-ink-soft">
                {question}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="rounded-xl bg-ink/[0.03] px-4 py-3">
        <h4 className="mb-1 text-sm font-semibold text-ink">Висновок</h4>
        <p className="text-sm leading-relaxed text-ink-soft">{brief.shortVerdict}</p>
      </div>
    </Card>
  );
}

function RiskSection({ summary }: { summary: FreeSummary }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card className="space-y-3 p-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-amber-700">
          <AlertTriangle className="h-4 w-4" /> На що звернути увагу
        </h3>
        <SignalList
          tone="warning"
          items={summary.topWarnings}
          emptyText="Критичних формулювань у тексті не знайдено."
        />
      </Card>

      <Card className="space-y-3 p-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-brand-700">
          <CheckCircle2 className="h-4 w-4" /> Що добре
        </h3>
        <SignalList
          tone="positive"
          items={summary.topPositives}
          emptyText="Позитивні умови в тексті не визначені автоматично."
        />
      </Card>
    </div>
  );
}

function CompanySection({
  company,
  summary,
  insight,
}: {
  company: ReportCompany | null;
  summary: InternalReviewsSummary;
  insight: CompanyInsight;
}) {
  return (
    <Card className="space-y-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="font-display text-lg font-bold text-ink">
            Компанія
          </h3>
          <p className="mt-1 text-sm text-ink-soft">
            Дані з бази компаній та опублікованих відгуків Прозора робота.
          </p>
        </div>
      </div>

      {!company && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-ink/[0.03] px-4 py-3">
          <p className="flex-1 text-sm text-ink-soft">{insight.summaryText}</p>
          <Button href="/add-review" variant="primary" size="sm">
            Залишити відгук
          </Button>
        </div>
      )}

      {company && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <DetailItem
              label="Назва"
              value={insight.name}
              icon={<Briefcase className="h-3.5 w-3.5" />}
            />
            <DetailItem
              label="Сфера"
              value={normalizeIndustry(insight.industry)}
              icon={<UsersRound className="h-3.5 w-3.5" />}
            />
            <DetailItem
              label="Місто компанії"
              value={insight.city}
              icon={<MapPin className="h-3.5 w-3.5" />}
            />
            <div className="rounded-xl border border-ink/[0.06] bg-white px-4 py-3">
              <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-ink-muted">
                <MessageSquare className="h-3.5 w-3.5" />
                Відгуки
              </div>
              <p className="text-sm font-semibold text-ink">
                {formatNumber(insight.publishedReviewsCount)} опублікованих
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button href={`/companies/${company.slug}`} variant="primary" size="sm">
              Перейти до сторінки компанії <ChevronRight className="h-3.5 w-3.5" />
            </Button>
            <Button href={`/add-review?company=${encodeURIComponent(company.slug)}`} variant="outline" size="sm">
              Залишити відгук
            </Button>
          </div>

          {summary.averageRating !== null ? (
            <div className="flex flex-wrap items-center gap-3 rounded-xl bg-brand-50 px-4 py-3">
              <Stars value={summary.averageRating} />
              <span className="text-sm font-semibold text-brand-800">
                {summary.averageRating.toFixed(1)} / 5 тільки за опублікованими відгуками Прозора робота
              </span>
            </div>
          ) : (
            <p className="rounded-xl bg-ink/[0.03] px-4 py-3 text-sm text-ink-soft">
              На Прозора робота ще немає опублікованих відгуків про цю компанію.
            </p>
          )}

          {summary.recentReviews.length > 0 && (
            <div className="space-y-3">
              {summary.recentReviews.map((review) => (
                <MiniReview key={review.id} review={review} />
              ))}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function ExternalRatingsSection({
  company,
  ratings,
}: {
  company: ReportCompany | null;
  ratings: ExternalRating[];
}) {
  return (
    <Card className="space-y-4 p-6">
      <div>
        <h3 className="font-display text-lg font-bold text-ink">
          Оцінки з відкритих джерел
        </h3>
        <p className="mt-1 text-sm text-ink-soft">
          Це довідкові оцінки з інших сервісів. Вони не є відгуками Прозора робота
          і не впливають на наш рейтинг.
        </p>
      </div>

      {!company && (
        <p className="rounded-xl bg-ink/[0.03] px-4 py-3 text-sm text-ink-soft">
          Зовнішні оцінки показуються після визначення компанії.
        </p>
      )}

      {company && ratings.length === 0 && (
        <p className="rounded-xl bg-ink/[0.03] px-4 py-3 text-sm text-ink-soft">
          Публічних підтверджених зовнішніх оцінок поки немає.
        </p>
      )}

      {ratings.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {ratings.map((rating) => (
            <ExternalRatingCard key={rating.id} rating={rating} />
          ))}
        </div>
      )}
    </Card>
  );
}

function ExternalReviewSignalsSection({
  company,
  summary,
}: {
  company: ReportCompany | null;
  summary: ExternalReviewSignalSummary | null;
}) {
  const topSignals = summary?.topSignals ?? [];

  return (
    <Card className="space-y-4 p-6">
      <div>
        <h3 className="font-display text-lg font-bold text-ink">
          Що пишуть у відкритих джерелах про компанію
        </h3>
        <p className="mt-1 text-sm text-ink-soft">
          Це короткі перевірені узагальнення зовнішніх джерел. Вони не є
          відгуками Прозора робота і не впливають на внутрішній рейтинг.
        </p>
      </div>

      {!company && (
        <p className="rounded-xl bg-ink/[0.03] px-4 py-3 text-sm text-ink-soft">
          Зовнішні сигнали показуються після надійного визначення компанії.
        </p>
      )}

      {company && topSignals.length === 0 && (
        <p className="rounded-xl bg-ink/[0.03] px-4 py-3 text-sm text-ink-soft">
          Підтверджених зовнішніх сигналів про компанію поки немає.
        </p>
      )}

      {topSignals.length > 0 && (
        <div className="grid gap-3">
          {topSignals.slice(0, 5).map((signal) => (
            <div key={`${signal.topic}-${signal.sourceName}-${signal.summary}`} className="rounded-xl border border-ink/[0.06] bg-white p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h4 className="flex items-center gap-2 text-sm font-semibold text-ink">
                  <MessageSquareText className="h-4 w-4 text-brand-700" />
                  {EXTERNAL_SIGNAL_TOPIC_LABELS[signal.topic]}: {EXTERNAL_SIGNAL_SENTIMENT_LABELS[signal.sentiment]}
                </h4>
                <span className="rounded-full bg-ink/[0.04] px-3 py-1 text-xs font-medium text-ink-soft">
                  {formatNumber(signal.mentionsCount)} згадок
                </span>
              </div>
              <p className="text-sm leading-relaxed text-ink-soft">{signal.summary}</p>
              <p className="mt-2 text-xs text-ink-muted">Джерело: {signal.sourceName}</p>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function CompanyOpenFactsSection({
  company,
  summary,
}: {
  company: ReportCompany | null;
  summary: CompanyOpenFactSummary | null;
}) {
  const hasFacts = Boolean(summary && summary.factsCount > 0);
  const rows = [
    summary?.sources.length ? `Джерела: ${summary.sources.slice(0, 3).join(" / ")}` : null,
    summary?.cities.length ? `Міста: ${summary.cities.slice(0, 3).join(", ")}` : null,
    summary?.salaryExamples.length ? `Приклади зарплати: ${summary.salaryExamples.slice(0, 3).join("; ")}` : null,
    summary?.schedules.length ? `Графік: ${summary.schedules.slice(0, 3).join("; ")}` : null,
    summary?.employmentTypes.length ? `Оформлення: ${summary.employmentTypes.slice(0, 3).join("; ")}` : null,
  ].filter(Boolean) as string[];

  return (
    <Card className="space-y-4 p-6">
      <div>
        <h3 className="font-display text-lg font-bold text-ink">
          Дані з відкритих вакансій про компанію
        </h3>
        <p className="mt-1 text-sm text-ink-soft">
          Це заявлені умови з відкритих вакансій. Вони не є відгуками працівників
          і можуть відрізнятися від фактичних умов.
        </p>
      </div>

      {!company && (
        <p className="rounded-xl bg-ink/[0.03] px-4 py-3 text-sm text-ink-soft">
          Дані з відкритих вакансій показуються після надійного визначення компанії.
        </p>
      )}

      {company && !hasFacts && (
        <p className="rounded-xl bg-ink/[0.03] px-4 py-3 text-sm text-ink-soft">
          Підтверджених даних з відкритих вакансій поки немає.
        </p>
      )}

      {hasFacts && (
        <div className="space-y-3 rounded-xl border border-ink/[0.06] bg-white p-4">
          <p className="text-sm font-semibold text-ink">
            За даними відкритих вакансій: {formatNumber(summary?.factsCount ?? 0)} записів
          </p>
          <ul className="space-y-2">
            {rows.map((row) => (
              <li key={row} className="text-sm leading-relaxed text-ink-soft">
                {row}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function MissingInfoSection({ items }: { items: string[] }) {
  return (
    <Card className="space-y-3 p-6">
      <h3 className="flex items-center gap-2 font-display text-lg font-bold text-ink">
        <CircleHelp className="h-5 w-5 text-amber-600" />
        Якої інформації бракує
      </h3>
      {items.length > 0 ? (
        <SignalList tone="warning" items={items} emptyText="" />
      ) : (
        <p className="text-sm text-ink-soft">
          Основні умови описані достатньо для первинної перевірки. Все одно варто підтвердити їх письмово.
        </p>
      )}
    </Card>
  );
}

function FreeAnalysisBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-ink/10 bg-ink/[0.04] px-2.5 py-1 text-xs font-semibold text-ink-soft">
      <CheckCircle2 className="h-3 w-3" />
      Безкоштовно
    </span>
  );
}

function ProStatusBadge({ status }: { status: ProStatus }) {
  const meta = PRO_STATUS_META[status];
  return (
    <span className={cn("rounded-full border px-2.5 py-1 text-xs font-semibold", meta.className)}>
      {meta.label}
    </span>
  );
}

function ProPreviewItem({
  title,
  section,
}: {
  title: string;
  section: ProPreviewSection;
}) {
  return (
    <div className="rounded-xl border border-ink/[0.06] bg-white p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-ink">{title}</h4>
        <div className="flex items-center gap-2">
          <ProStatusBadge status={section.status} />
        </div>
      </div>
      <p className="text-sm leading-relaxed text-ink-soft">{section.summary}</p>
      {section.questions.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {section.questions.slice(0, 3).map((question) => (
            <li key={question} className="text-sm text-ink-soft">
              {question}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ProListBlock({
  title,
  items,
  icon,
}: {
  title: string;
  items: string[];
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-ink/[0.06] bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-2 text-sm font-semibold text-ink">
          {icon}
          {title}
        </h4>
        <FreeAnalysisBadge />
      </div>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item} className="text-sm text-ink-soft">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProPreviewSection({ preview }: { preview: ProPreview }) {
  const hasInsufficientData = preview.finalVerdict.text.startsWith("Недостатньо даних");

  return (
    <Card className="space-y-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="font-display text-lg font-bold text-ink">
            Розширений аналіз
          </h3>
          <p className="mt-1 text-sm text-ink-soft">
            {hasInsufficientData
              ? "Недостатньо даних для детального висновку. Нижче — що потрібно уточнити."
              : "Безкоштовний розширений аналіз на основі доступних даних, без гарантій безпеки і без вигаданих фактів."}
          </p>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <ProPreviewItem title="Зарплата і прозорість оплати" section={preview.salary} />
        <ProPreviewItem title="Оформлення" section={preview.employment} />
        <ProPreviewItem title="Графік і навантаження" section={preview.schedule} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-ink/[0.06] bg-white p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold text-ink">Бронювання / відстрочка</h4>
            <FreeAnalysisBadge />
          </div>
          <p className="text-sm leading-relaxed text-ink-soft">{preview.booking.summary}</p>
          <ul className="mt-3 space-y-1.5">
            {preview.booking.questions.map((question) => (
              <li key={question} className="text-sm text-ink-soft">
                {question}
              </li>
            ))}
          </ul>
        </div>

        <ProListBlock
          title="Питання для співбесіди"
          items={preview.interviewQuestions}
          icon={<MessageSquare className="h-4 w-4 text-brand-700" />}
        />

        <ProListBlock
          title="Документи, які варто перевірити"
          items={preview.documentChecklist}
          icon={<FileText className="h-4 w-4 text-brand-700" />}
        />

        <div className="rounded-xl border border-ink/[0.06] bg-white p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h4 className="flex items-center gap-2 text-sm font-semibold text-ink">
              <ShieldCheck className="h-4 w-4 text-brand-700" />
              Підсумкова рекомендація
            </h4>
            <FreeAnalysisBadge />
          </div>
          <p className="text-sm leading-relaxed text-ink-soft">
            {preview.finalVerdict.text}
          </p>
        </div>
      </div>

      <p className="rounded-xl bg-ink/[0.03] px-4 py-3 text-xs text-ink-muted">
        Це відкритий безкоштовний аналіз на основі доступного тексту вакансії, відгуків
        Прозора робота та підтверджених відкритих джерел. Якщо даних недостатньо,
        блок показує питання і документи, які варто перевірити.
      </p>
    </Card>
  );
}

function ResultReport({ report }: { report: VacancyReport }) {
  return (
    <div className="space-y-5">
      <VacancySummary report={report} />
      <VacancyBriefSection brief={report.analysis.vacancyBrief} parsed={report.parsedVacancy} />
      <FreeSummarySection summary={report.analysis.freeSummary} />
      <CompanySection
        company={report.matchedCompany}
        summary={report.internalReviews}
        insight={report.analysis.companyInsight}
      />
      <ExternalRatingsSection
        company={report.matchedCompany}
        ratings={report.externalRatings}
      />
      <ExternalReviewSignalsSection
        company={report.matchedCompany}
        summary={report.externalReviewSignals}
      />
      <CompanyOpenFactsSection
        company={report.matchedCompany}
        summary={report.companyOpenFacts}
      />
      <RiskSection summary={report.analysis.freeSummary} />
      <MissingInfoSection items={report.analysis.freeSummary.missingInfo} />
      <ProPreviewSection preview={report.analysis.proPreview} />
    </div>
  );
}

function ManualTextFallback({ message }: { message: string }) {
  return (
    <Card className="space-y-3 border-amber-200 bg-amber-50 p-6">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
        <div>
          <h2 className="font-display text-lg font-bold text-ink">
            Автоматичне зчитування не спрацювало
          </h2>
          <p className="mt-1 text-sm text-amber-800">
            {message || "Скопіюйте текст вакансії з Work.ua або Robota.ua і вставте його вручну."}
          </p>
          <p className="mt-2 text-sm text-ink-soft">
            Скопіюйте текст вакансії з Work.ua або Robota.ua і вставте його вручну.
          </p>
        </div>
      </div>
    </Card>
  );
}

export function VacancyCheckClient() {
  const searchParams = useSearchParams();
  const qParam = searchParams.get("q") ?? "";
  const companyParam = searchParams.get("company") ?? "";

  const [input, setInput] = useState(qParam);
  const [stage, setStage] = useState<Stage>({ type: "idle" });
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  async function handleCheck() {
    const q = input.trim();
    if (q.length < 2) return;

    setStage({ type: "loading" });
    window.scrollTo({ top: 0, behavior: "smooth" });

    try {
      const res = await fetch("/api/check-vacancy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: q }),
      });
      const data = await res.json() as CheckVacancyResponse;

      if ("ok" in data && data.ok === false && data.needsManualText) {
        setStage({ type: "manual-needed", message: data.message });
        return;
      }

      if (!res.ok || !("ok" in data) || data.ok !== true) {
        const message =
          "error" in data && typeof data.error === "string"
            ? data.error
            : "Не вдалося перевірити вакансію.";
        setStage({ type: "error", message });
        return;
      }

      setStage({ type: "result", report: data });
    } catch {
      setStage({ type: "error", message: "Не вдалося підключитися до сервера перевірки." });
    }
  }

  function handleReset() {
    setStage({ type: "idle" });
    setInput("");
    setTimeout(() => textareaRef.current?.focus(), 50);
  }

  return (
    <div className="container-page max-w-4xl space-y-8 py-8 sm:py-10">
      <SectionTitle
        eyebrow="Перевірка вакансії"
        title="Перевірити вакансію"
        description="Вставте посилання або текст вакансії — система перевірить компанію, відкриті джерела, відгуки та ризики."
      />

      <AiVacancyAnalysisSection initialCompanyName={companyParam} />

      <Card className="space-y-4 p-6">
        <div>
          <h2 className="font-display text-lg font-bold text-ink">Швидка перевірка без AI</h2>
          <p className="mt-1 text-sm text-ink-soft">
            Детермінований аналіз тексту вакансії, компанії в базі та відкритих даних сайту.
          </p>
        </div>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void handleCheck();
          }}
          rows={5}
          placeholder="Вставте посилання Work.ua / Robota.ua, назву компанії або текст вакансії"
          className="w-full resize-y rounded-xl border border-ink/12 bg-white px-4 py-3 text-sm focus-ring placeholder:text-ink-muted"
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={() => void handleCheck()}
            disabled={input.trim().length < 2 || stage.type === "loading"}
            size="lg"
          >
            {stage.type === "loading" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            {stage.type === "loading" ? "Аналізуємо…" : "Перевірити"}
          </Button>
          {stage.type !== "idle" && stage.type !== "loading" && (
            <Button variant="secondary" onClick={handleReset}>
              <RefreshCw className="h-4 w-4" /> Нова перевірка
            </Button>
          )}
        </div>
        <p className="text-xs text-ink-muted">
          Натисніть Ctrl+Enter, щоб перевірити. Work.ua та Robota.ua читаються тільки
          звичайним fetch; якщо сторінка не відкриється, вставте текст вакансії вручну.
        </p>
      </Card>

      {stage.type === "loading" && (
        <div className="flex items-center gap-2 text-sm text-ink-muted">
          <Loader2 className="h-4 w-4 animate-spin text-brand-600" />
          Аналізуємо вакансію та шукаємо компанію в базі…
        </div>
      )}

      {stage.type === "manual-needed" && (
        <ManualTextFallback message={stage.message} />
      )}

      {stage.type === "error" && (
        <Card className="flex items-start gap-3 border-red-200 bg-red-50 p-5 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{stage.message}</span>
        </Card>
      )}

      {stage.type === "result" && <ResultReport report={stage.report} />}
    </div>
  );
}
