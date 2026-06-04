import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  MapPin,
  Briefcase,
  PenLine,
  Lock,
} from "lucide-react";

import { COMPANIES } from "@/lib/mock-data";
import {
  getPublishedCompanyReviewFacts,
  getSupabaseCompanyBySlug,
  type PublishedCompanyReviewFacts,
} from "@/lib/company-service";
import { getPublicExternalRatings } from "@/lib/external-ratings-service";
import { getServerClient } from "@/lib/supabase/server";
import { normalizeIndustry } from "@/lib/industry";
import type { ExternalRating } from "@/lib/types";
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

function getCompanyDataLevel(
  facts: PublishedCompanyReviewFacts,
  externalRatingsCount: number
): "Поки недостатньо даних" | "Є часткові дані" | "Є достатньо даних" {
  if (facts.reviewCount === 0 && externalRatingsCount === 0) return "Поки недостатньо даних";
  if (facts.reviewCount >= 5 || (facts.reviewCount >= 2 && externalRatingsCount >= 2)) {
    return "Є достатньо даних";
  }
  return "Є часткові дані";
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
}: {
  companyName: string;
  industry: string | null;
  city: string | null;
  facts: PublishedCompanyReviewFacts;
  externalRatings: ExternalRating[];
}) {
  const dataLevel = getCompanyDataLevel(facts, externalRatings.length);
  const noData = facts.reviewCount === 0 && externalRatings.length === 0;
  const conclusion = noData
    ? "Поки недостатньо даних для оцінки роботодавця. На Прозора робота ще немає опублікованих відгуків, а підтверджених зовнішніх оцінок поки немає."
    : dataLevel === "Є часткові дані"
      ? "Є часткові дані про роботодавця. Висновок варто робити обережно і тільки після уточнення ключових умов."
      : "Є кілька джерел даних про роботодавця, але рішення все одно варто підтверджувати письмовими умовами.";
  const known = [
    "Компанія є в каталозі.",
    industry ? `Сфера: ${industry}.` : "Сфера не вказана.",
    city ? `Місто: ${city}.` : "Місто компанії не вказано.",
    facts.reviewCount > 0 ? `Опубліковані відгуки на Прозора робота: ${facts.reviewCount}.` : null,
    externalRatings.length > 0 ? `Підтверджені зовнішні джерела: ${externalRatings.length}.` : null,
  ].filter(Boolean) as string[];
  const attention = [
    facts.reviewCount === 0
      ? "Недостатньо відгуків на Прозора робота."
      : `Є ${facts.reviewCount} опублікованих відгуків на Прозора робота.`,
    externalRatings.length === 0
      ? "Підтверджених зовнішніх оцінок поки немає."
      : `Є ${externalRatings.length} підтверджених зовнішніх джерел.`,
    facts.averageInternalRating !== null
      ? `Внутрішня оцінка за published reviews: ${formatAverage(facts.averageInternalRating)}.`
      : null,
  ].filter(Boolean) as string[];
  const missing = [
    !facts.hasSalaryData ? "Даних про зарплату." : null,
    !facts.hasEmploymentData ? "Даних про оформлення." : null,
    !facts.hasScheduleData ? "Даних про графік." : null,
    !facts.hasBookingData ? "Даних про бронювання або відстрочку." : null,
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
}: {
  facts: PublishedCompanyReviewFacts;
  externalRatings: ExternalRating[];
}) {
  const dataLevel = getCompanyDataLevel(facts, externalRatings.length);
  const lowData = dataLevel === "Поки недостатньо даних";
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
  const salarySummary = facts.hasSalaryData
    ? [
        facts.salaryAverage !== null ? `Є оцінки зарплати: ${formatAverage(facts.salaryAverage)}.` : null,
        salaryCounts ? `Відповідність заявленій зарплаті за відгуками: ${salaryCounts}.` : null,
      ].filter(Boolean).join(" ")
    : "Недостатньо даних про зарплату.";
  const employmentSummary = facts.hasEmploymentData
    ? `Є структуровані відповіді про оформлення: ${employmentCounts || "деталі не визначені"}.`
    : "Недостатньо даних про офіційне оформлення.";
  const scheduleSummary = facts.hasScheduleData
    ? `Є оцінки графіку у published reviews: ${formatAverage(facts.scheduleAverage)}. Деталі графіку потрібно уточнювати окремо.`
    : "Недостатньо даних про графік і навантаження.";
  const bookingSummary = facts.hasBookingData
    ? `Є структуровані відповіді про бронювання: ${bookingCounts || "деталі не визначені"}.`
    : "Недостатньо даних про бронювання або відстрочку.";
  const reviewsSummary = facts.reviewCount > 0
    ? `На Прозора робота є ${facts.reviewCount} опублікованих відгуків. Внутрішня оцінка: ${formatAverage(facts.averageInternalRating)}.`
    : "На Прозора робота ще немає опублікованих відгуків.";
  const externalSummary = externalRatings.length > 0
    ? `Є ${externalRatings.length} підтверджених зовнішніх джерел. Зовнішні оцінки не є відгуками Прозора робота і не впливають на внутрішній рейтинг.`
    : "Підтверджених зовнішніх оцінок поки немає. Зовнішні оцінки не є відгуками Прозора робота і не впливають на внутрішній рейтинг.";
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
  const finalSummary = lowData
    ? "Недостатньо даних для повної оцінки роботодавця. Перед рішенням варто уточнити оплату, оформлення, графік і перевірити умови письмово."
    : "Висновок потрібно будувати тільки на фактичних published reviews і підтверджених зовнішніх оцінках. Перед рішенням все одно варто підтвердити ключові умови письмово.";

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
    const externalRatings = await getPublicExternalRatings(slug);
    const reviewFacts = await getPublishedCompanyReviewFacts(slug);
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
        <CompanyShortAnalysis
          companyName={mockFallback.name}
          industry={fallbackIndustry}
          city={mockFallback.city}
          facts={reviewFacts}
          externalRatings={externalRatings}
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
        <CompanyProAnalysis facts={reviewFacts} externalRatings={externalRatings} />
        <p className="text-center text-xs text-ink-muted">
          Інформація про компанію формується на основі анонімних відгуків і не є офіційною
          оцінкою роботодавця.
        </p>
      </div>
    );
  }

  // ── Main page: real Supabase company + real published reviews ─────────────
  const industry = normalizeIndustry(sbCompany.industry);
  const externalRatings = await getPublicExternalRatings(sbCompany.slug);
  const reviewFacts = await getPublishedCompanyReviewFacts(sbCompany.slug);

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

      <CompanyShortAnalysis
        companyName={sbCompany.name}
        industry={industry}
        city={sbCompany.city}
        facts={reviewFacts}
        externalRatings={externalRatings}
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

      <CompanyProAnalysis facts={reviewFacts} externalRatings={externalRatings} />

      <p className="text-center text-xs text-ink-muted">
        Інформація про компанію формується на основі анонімних відгуків і не є офіційною
        оцінкою роботодавця.
      </p>
    </div>
  );
}
