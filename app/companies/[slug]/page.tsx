import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  MapPin,
  Briefcase,
  PenLine,
  Lock,
  MessageSquareText,
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
  getPublicExternalReviewSignals,
  getPublicExternalReviewSignalSummary,
  SENTIMENT_LABELS,
  TOPIC_LABELS,
  type ExternalReviewSignalSummary,
} from "@/lib/external-review-signals-service";
import { getServerClient } from "@/lib/supabase/server";
import { normalizeIndustry } from "@/lib/industry";
import type { CompanyOpenFact, ExternalRating, ExternalReviewSignal } from "@/lib/types";
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

function joinExamples(label: string, values: string[]): string | null {
  if (values.length === 0) return null;
  return `${label}: ${values.slice(0, 3).join("; ")}.`;
}

function getCompanyDataLevel(
  facts: PublishedCompanyReviewFacts,
  externalRatingsCount: number,
  openFactsCount: number,
  externalReviewSignalsCount: number
): "Поки недостатньо даних" | "Є часткові дані" | "Є достатньо даних" {
  if (
    facts.reviewCount === 0 &&
    externalRatingsCount === 0 &&
    openFactsCount === 0 &&
    externalReviewSignalsCount === 0
  ) {
    return "Поки недостатньо даних";
  }
  if (
    facts.reviewCount >= 5 ||
    (facts.reviewCount >= 2 && (externalRatingsCount >= 2 || openFactsCount >= 2 || externalReviewSignalsCount >= 2))
  ) {
    return "Є достатньо даних";
  }
  return "Є часткові дані";
}

function externalSignalTopicList(summary: ExternalReviewSignalSummary): string {
  return summary.topics.map((topic) => TOPIC_LABELS[topic].toLowerCase()).slice(0, 4).join(", ");
}

function CompanyAnalysisList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2">
      {items.map((item) => (
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
  openFactSummary,
  externalReviewSignalSummary,
}: {
  companyName: string;
  industry: string | null;
  city: string | null;
  facts: PublishedCompanyReviewFacts;
  externalRatings: ExternalRating[];
  openFactSummary: CompanyOpenFactSummary;
  externalReviewSignalSummary: ExternalReviewSignalSummary;
}) {
  const dataLevel = getCompanyDataLevel(
    facts,
    externalRatings.length,
    openFactSummary.factsCount,
    externalReviewSignalSummary.signalCount
  );
  const noData =
    facts.reviewCount === 0 &&
    externalRatings.length === 0 &&
    openFactSummary.factsCount === 0 &&
    externalReviewSignalSummary.signalCount === 0;
  const conclusion = noData
    ? "Поки недостатньо даних для оцінки роботодавця. На Прозора робота ще немає опублікованих відгуків, підтверджених зовнішніх оцінок або узагальнених сигналів поки немає."
    : facts.reviewCount === 0 && openFactSummary.factsCount > 0
      ? "Є часткові дані з відкритих вакансій, але недостатньо відгуків працівників. Умови потрібно підтверджувати напряму з роботодавцем."
    : facts.reviewCount === 0 && externalReviewSignalSummary.signalCount > 0
      ? "Є часткові узагальнення за відкритими джерелами, але недостатньо відгуків на Прозора робота. Ці сигнали потрібно перевіряти на співбесіді."
    : dataLevel === "Є часткові дані"
      ? "Є часткові дані про роботодавця. Висновок варто робити обережно і тільки після уточнення ключових умов."
      : "Є кілька джерел даних про роботодавця, але рішення все одно варто підтверджувати письмовими умовами.";
  const known = [
    "Компанія є в каталозі.",
    industry ? `Сфера: ${industry}.` : "Сфера не вказана.",
    city ? `Місто: ${city}.` : "Місто компанії не вказано.",
    facts.reviewCount > 0 ? `Опубліковані відгуки на Прозора робота: ${facts.reviewCount}.` : null,
    externalRatings.length > 0 ? `Підтверджені зовнішні джерела: ${externalRatings.length}.` : null,
    externalReviewSignalSummary.signalCount > 0 ? "Є узагальнені сигнали з відкритих джерел." : null,
    externalReviewSignalSummary.topics.length > 0
      ? `Найчастіші теми за відкритими джерелами: ${externalSignalTopicList(externalReviewSignalSummary)}.`
      : null,
    openFactSummary.factsCount > 0 ? `Є дані з відкритих вакансій: ${openFactSummary.sources.join(" / ")}.` : null,
    joinExamples("У вакансіях згадуються міста", openFactSummary.cities),
    joinExamples("Приклади посад", openFactSummary.vacancyTitles),
    joinExamples("Приклади зарплати", openFactSummary.salaryExamples),
    joinExamples("Умови", openFactSummary.conditions),
  ].filter(Boolean) as string[];
  const attention = [
    facts.reviewCount === 0
      ? "Мало відгуків на Прозора робота."
      : `Є ${facts.reviewCount} опублікованих відгуків на Прозора робота.`,
    externalRatings.length === 0
      ? "Підтверджених зовнішніх оцінок поки немає."
      : `Є ${externalRatings.length} підтверджених зовнішніх джерел.`,
    externalReviewSignalSummary.signalCount === 0
      ? "Підтверджених узагальнень зовнішніх відгуків поки немає."
      : null,
    externalReviewSignalSummary.negativeCount + externalReviewSignalSummary.mixedCount > 0
      ? "У відкритих джерелах є змішані або негативні згадки. Їх потрібно перевірити на співбесіді."
      : null,
    openFactSummary.factsCount > 0 ? "Це дані з вакансій, а не досвід працівників." : null,
    openFactSummary.salaryExamples.length > 0
      ? "Є приклади зарплат з відкритих вакансій, але їх потрібно підтверджувати з роботодавцем."
      : null,
    facts.averageInternalRating !== null
      ? `Внутрішня оцінка за published reviews: ${formatAverage(facts.averageInternalRating)}.`
      : null,
  ].filter(Boolean) as string[];
  const missing = [
    facts.reviewCount === 0 ? "Недостатньо анонімних відгуків." : null,
    externalRatings.length === 0 ? "Немає підтверджених зовнішніх оцінок." : null,
    externalReviewSignalSummary.signalCount === 0 ? "Немає підтверджених узагальнень зовнішніх відгуків." : null,
    !facts.hasSalaryData && openFactSummary.salaryExamples.length === 0 ? "Недостатньо даних про зарплату." : null,
    !facts.hasEmploymentData && !openFactSummary.hasOfficialEmploymentMention && openFactSummary.employmentTypes.length === 0
      ? "Недостатньо даних про оформлення."
      : null,
    !facts.hasScheduleData && openFactSummary.schedules.length === 0 ? "Недостатньо даних про графік." : null,
    !facts.hasBookingData && !openFactSummary.hasBookingMention ? "Даних про бронювання або відстрочку." : null,
  ].filter(Boolean) as string[];

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

      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-3 rounded-xl border border-ink/[0.06] bg-white p-4">
          <h3 className="text-sm font-semibold text-ink">Що відомо</h3>
          <CompanyAnalysisList items={known} />
        </div>
        <div className="space-y-3 rounded-xl border border-ink/[0.06] bg-white p-4">
          <h3 className="text-sm font-semibold text-ink">На що звернути увагу</h3>
          <CompanyAnalysisList items={attention} />
        </div>
        <div className="space-y-3 rounded-xl border border-ink/[0.06] bg-white p-4">
          <h3 className="text-sm font-semibold text-ink">Якої інформації бракує</h3>
          <CompanyAnalysisList
            items={missing.length ? missing : [`За наявними даними базові блоки для ${companyName} частково заповнені.`]}
          />
        </div>
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
                <span className="rounded-full bg-ink/[0.04] px-3 py-1 text-xs font-medium text-ink-soft">
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

function CompanyDescriptionSection({
  facts,
}: {
  facts: CompanyOpenFact[];
}) {
  const fact = facts.find((item) => item.companyDescription);

  return (
    <Card className="space-y-3 p-6">
      <div>
        <h2 className="font-display text-lg font-bold text-ink">Опис компанії</h2>
        <p className="mt-1 text-sm text-ink-soft">
          Опис формується тільки з відкритих джерел або підтверджених даних. Він не є відгуком працівника і не впливає на рейтинг.
        </p>
      </div>

      {!fact?.companyDescription ? (
        <p className="rounded-xl bg-ink/[0.03] px-4 py-3 text-sm text-ink-soft">
          Опис компанії поки не додано.
        </p>
      ) : (
        <div className="rounded-xl border border-ink/[0.06] bg-white p-4">
          <p className="text-sm leading-relaxed text-ink-soft">{fact.companyDescription}</p>
          <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
            <span>Джерело: {fact.sourceName}</span>
            <span>зібрано: {formatDate(fact.collectedAt)}</span>
            {fact.sourceUrl && (
              <a href={fact.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-brand-700">
                Відкрити джерело
              </a>
            )}
          </p>
          <p className="mt-3 rounded-lg bg-ink/[0.03] px-3 py-2 text-xs text-ink-muted">
            Опис сформовано на основі відкритих джерел. Це не є відгуком працівника і не впливає на рейтинг.
          </p>
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

function CompanyOpenFactsSection({
  facts,
}: {
  facts: CompanyOpenFact[];
}) {
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
        <div className="grid gap-3">
          {facts.map((fact) => (
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
                    Джерело
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
    </Card>
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
  openFactSummary,
  externalReviewSignalSummary,
}: {
  facts: PublishedCompanyReviewFacts;
  externalRatings: ExternalRating[];
  openFactSummary: CompanyOpenFactSummary;
  externalReviewSignalSummary: ExternalReviewSignalSummary;
}) {
  const dataLevel = getCompanyDataLevel(
    facts,
    externalRatings.length,
    openFactSummary.factsCount,
    externalReviewSignalSummary.signalCount
  );
  const lowData = dataLevel === "Поки недостатньо даних";
  const onlyOpenFacts =
    facts.reviewCount === 0 &&
    externalRatings.length === 0 &&
    externalReviewSignalSummary.signalCount === 0 &&
    openFactSummary.factsCount > 0;
  const onlyExternalReviewSignals =
    facts.reviewCount === 0 &&
    externalRatings.length === 0 &&
    openFactSummary.factsCount === 0 &&
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
  const externalSummary = externalRatings.length > 0
    ? `Є ${externalRatings.length} підтверджених зовнішніх джерел. Зовнішні оцінки не є відгуками Прозора робота і не впливають на внутрішній рейтинг.`
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
  const openFactsSummary = openFactSummary.factsCount > 0
    ? [
        `Джерела: ${openFactSummary.sources.join(" / ")}.`,
        `Останнє оновлення: ${formatDate(openFactSummary.latestCollectedAt)}.`,
        joinExamples("Вакансії", openFactSummary.vacancyTitles),
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
              : "Це структура майбутнього Pro-звіту на основі доступних даних, без вигаданих фактів."}
          </p>
        </div>
        <Button disabled variant="secondary" size="sm">
          <Lock className="h-4 w-4" /> Отримати розширений аналіз
        </Button>
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

      <p className="rounded-xl bg-ink/[0.03] px-4 py-3 text-xs text-ink-muted">
        Оплата буде додана пізніше. Зараз це структура майбутнього Pro-звіту.
      </p>
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
      reviewFacts,
      openFacts,
      openFactSummary,
    ] = await Promise.all([
      getPublicExternalRatings(slug),
      getPublicExternalReviewSignals(slug),
      getPublicExternalReviewSignalSummary(slug),
      getPublishedCompanyReviewFacts(slug),
      getPublicCompanyOpenFacts(slug),
      getPublicCompanyOpenFactsSummary(slug),
    ]);
    const fallbackIndustry = normalizeIndustry(mockFallback.industry);

    // Supabase not configured — show name only with a prompt to add a review
    return (
      <div className="container-page max-w-3xl space-y-6 py-8 sm:py-10">
        <Card className="p-6">
          <h1 className="font-display text-2xl font-bold text-ink sm:text-3xl">
            {mockFallback.name}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-soft">
            {mockFallback.city && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="h-4 w-4" /> {mockFallback.city}
              </span>
            )}
            {mockFallback.industry && (
              <span className="inline-flex items-center gap-1.5">
                <Briefcase className="h-4 w-4" /> {fallbackIndustry}
              </span>
            )}
          </div>
          <div className="mt-5">
            <Button href={`/add-review?company=${encodeURIComponent(slug)}`}>
              <PenLine className="h-4 w-4" /> Додати відгук
            </Button>
          </div>
        </Card>
        <CompanyDescriptionSection facts={openFacts} />
        <CompanyShortAnalysis
          companyName={mockFallback.name}
          industry={fallbackIndustry}
          city={mockFallback.city}
          facts={reviewFacts}
          externalRatings={externalRatings}
          openFactSummary={openFactSummary}
          externalReviewSignalSummary={externalReviewSignalSummary}
        />
        <section className="space-y-3">
          <h2 className="font-display text-lg font-bold text-ink">Відгуки на Прозора робота</h2>
          <CompanyReviewsSection
            companySlug={mockFallback.slug}
            companyName={mockFallback.name}
          />
          <p className="text-xs text-ink-muted">
            Тільки ці опубліковані відгуки впливають на внутрішню оцінку Прозора робота.
          </p>
        </section>
        <ExternalRatingsSection ratings={externalRatings} />
        <ExternalReviewSignalsSection signals={externalReviewSignals} />
        <CompanyOpenFactsSection facts={openFacts} />
        <CompanyProAnalysis
          facts={reviewFacts}
          externalRatings={externalRatings}
          openFactSummary={openFactSummary}
          externalReviewSignalSummary={externalReviewSignalSummary}
        />
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
    reviewFacts,
    openFacts,
    openFactSummary,
  ] = await Promise.all([
    getPublicExternalRatings(sbCompany.slug),
    getPublicExternalReviewSignals(sbCompany.slug),
    getPublicExternalReviewSignalSummary(sbCompany.slug),
    getPublishedCompanyReviewFacts(sbCompany.slug),
    getPublicCompanyOpenFacts(sbCompany.slug),
    getPublicCompanyOpenFactsSummary(sbCompany.slug),
  ]);

  return (
    <div className="container-page max-w-3xl space-y-6 py-8 sm:py-10">
      {/* Header */}
      <Card className="p-6">
        <h1 className="font-display text-2xl font-bold text-ink sm:text-3xl">
          {sbCompany.name}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-soft">
          {sbCompany.city && (
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="h-4 w-4" /> {sbCompany.city}
            </span>
          )}
          {industry && (
            <span className="inline-flex items-center gap-1.5">
              <Briefcase className="h-4 w-4" /> {industry}
            </span>
          )}
        </div>
        <div className="mt-5">
          <Button href={`/add-review?company=${encodeURIComponent(sbCompany.slug)}`}>
            <PenLine className="h-4 w-4" /> Додати відгук
          </Button>
        </div>
      </Card>

      <CompanyDescriptionSection facts={openFacts} />

      <CompanyShortAnalysis
        companyName={sbCompany.name}
        industry={industry}
        city={sbCompany.city}
        facts={reviewFacts}
        externalRatings={externalRatings}
        openFactSummary={openFactSummary}
        externalReviewSignalSummary={externalReviewSignalSummary}
      />

      {/* Reviews: summary + ratings + risks + geo/roles + list (all from Supabase) */}
      <section className="space-y-3">
        <h2 className="font-display text-lg font-bold text-ink">Відгуки на Прозора робота</h2>
        <CompanyReviewsSection
          companySlug={sbCompany.slug}
          companyName={sbCompany.name}
        />
        <p className="text-xs text-ink-muted">
          Тільки ці опубліковані відгуки впливають на внутрішню оцінку Прозора робота.
        </p>
      </section>

      <ExternalRatingsSection ratings={externalRatings} />
      <ExternalReviewSignalsSection signals={externalReviewSignals} />
      <CompanyOpenFactsSection facts={openFacts} />

      <CompanyProAnalysis
        facts={reviewFacts}
        externalRatings={externalRatings}
        openFactSummary={openFactSummary}
        externalReviewSignalSummary={externalReviewSignalSummary}
      />

      <p className="text-center text-xs text-ink-muted">
        Інформація про компанію формується на основі анонімних відгуків і не є офіційною
        оцінкою роботодавця.
      </p>
    </div>
  );
}
