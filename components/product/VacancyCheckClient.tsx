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
  LockKeyhole,
  MapPin,
  MessageSquare,
  RefreshCw,
  Search,
  ShieldCheck,
  Star,
  UsersRound,
} from "lucide-react";
import { Card, SectionTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { normalizeIndustry } from "@/lib/industry";
import type { ExternalRating, RiskLevel } from "@/lib/types";

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

interface VacancyAnalysis {
  freeSummary: FreeSummary;
  companyInsight: CompanyInsight;
  proPreview: ProPreview;
}

interface VacancyReport {
  ok: true;
  inputType: string;
  parsedVacancy: ParsedVacancy;
  matchedCompany: ReportCompany | null;
  internalReviews: InternalReviewsSummary;
  externalRatings: ExternalRating[];
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

function ProBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-ink/10 bg-ink/[0.04] px-2.5 py-1 text-xs font-semibold text-ink-soft">
      <LockKeyhole className="h-3 w-3" />
      Pro-звіт
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
  locked = false,
}: {
  title: string;
  section: ProPreviewSection;
  locked?: boolean;
}) {
  return (
    <div className="rounded-xl border border-ink/[0.06] bg-white p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-ink">{title}</h4>
        <div className="flex items-center gap-2">
          {locked && <ProBadge />}
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
        <ProBadge />
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
  return (
    <Card className="space-y-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="font-display text-lg font-bold text-ink">
            Розширений аналіз
          </h3>
          <p className="mt-1 text-sm text-ink-soft">
            Перші блоки доступні як preview. Розширений Pro-звіт буде доданий без гарантій безпеки і з акцентом на питання для перевірки.
          </p>
        </div>
        <Button disabled variant="secondary" size="sm">
          Отримати розширений аналіз
        </Button>
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
            <ProBadge />
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
            <ProBadge />
          </div>
          <p className="text-sm leading-relaxed text-ink-soft">
            {preview.finalVerdict.text}
          </p>
        </div>
      </div>

      <p className="rounded-xl bg-ink/[0.03] px-4 py-3 text-xs text-ink-muted">
        Оплата буде додана пізніше. Зараз це підготовлена структура майбутнього Pro-звіту.
      </p>
    </Card>
  );
}

function ResultReport({ report }: { report: VacancyReport }) {
  return (
    <div className="space-y-5">
      <VacancySummary report={report} />
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
        title="Перевірити вакансію або роботодавця"
        description="Ми перевіримо текст вакансії, компанію в базі, відгуки та ризики перед співбесідою."
      />

      <Card className="space-y-4 p-6">
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
