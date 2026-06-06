import Link from "next/link";
import {
  FileSearch,
  MessageSquarePlus,
  ShieldCheck,
  Building2,
  Banknote,
  FileCheck,
  GraduationCap,
  Clock,
  FileX,
  CheckCircle2,
  Star,
  MapPin,
  Briefcase,
  Calendar,
} from "lucide-react";
import { SearchBar } from "@/components/product/SearchBar";
import { Button } from "@/components/ui/Button";
import { Card, SectionTitle } from "@/components/ui/Card";
import { HeroAnimator } from "@/components/animations/HeroAnimator";
import { StaggerGrid } from "@/components/animations/StaggerGrid";
import { FadeInSection } from "@/components/animations/FadeInSection";
import { getServerClient } from "@/lib/supabase/server";
import { normalizeIndustry } from "@/lib/industry";
import type { Review } from "@/lib/types";
import { fromRow } from "@/lib/storage";

// ── Server data fetching ──────────────────────────────────────────────────────

// Revalidate homepage data every 5 minutes
export const revalidate = 300;

const FEATURED_SLUGS = [
  "nova-poshta", "atb", "silpo", "eva",
  "rozetka", "a-bank", "pryvatbank", "glovo",
];

interface FeaturedCompany {
  name: string;
  slug: string;
  city: string | null;
  industry: string | null;
}

async function getFeaturedCompanies(): Promise<FeaturedCompany[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!url || !key) return [];
  try {
    const client = getServerClient();
    const { data } = await client
      .from("companies")
      .select("name, slug, city, industry")
      .in("slug", FEATURED_SLUGS);
    if (!data) return [];
    // Preserve order from FEATURED_SLUGS
    const map = Object.fromEntries(
      (data as FeaturedCompany[]).map((c) => [c.slug, c])
    );
    return FEATURED_SLUGS.map((s) => map[s]).filter(Boolean) as FeaturedCompany[];
  } catch {
    return [];
  }
}

async function getRecentPublishedReviews(): Promise<Review[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!url || !key) return [];
  try {
    const client = getServerClient();
    const { data } = await client
      .from("reviews")
      .select("*")
      .eq("status", "published")
      .order("created_at", { ascending: false })
      .limit(3);
    if (!data) return [];
    return (data as Parameters<typeof fromRow>[0][]).map(fromRow);
  } catch {
    return [];
  }
}

// ── Static content ────────────────────────────────────────────────────────────

const WHAT_TO_CHECK = [
  { icon: Banknote,     label: "Реальність зарплати" },
  { icon: FileCheck,    label: "Офіційне оформлення" },
  { icon: ShieldCheck,  label: "Бронювання" },
  { icon: Clock,        label: "Затримки виплат" },
  { icon: Building2,    label: "Умови роботи" },
  { icon: FileX,        label: "Чесність вакансії" },
  { icon: FileSearch,   label: "Співбесіда" },
  { icon: GraduationCap, label: "Стажування" },
];

const TYPE_LABEL: Record<string, string> = {
  employee: "Працівник",
  interview: "Співбесіда",
  internship: "Стажування",
  applicant: "Кандидат",
};

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function HomePage() {
  const [featuredCompanies, recentReviews] = await Promise.all([
    getFeaturedCompanies(),
    getRecentPublishedReviews(),
  ]);

  return (
    <div className="container-page space-y-20 pb-20">
      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <section className="py-12 sm:py-20">
        <HeroAnimator className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-brand-100 bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">
            <ShieldCheck className="h-3.5 w-3.5" /> Анонімно · Для України
          </span>
          <h1 className="mt-5 font-display text-4xl font-bold leading-[1.1] tracking-tight text-ink sm:text-5xl">
            Перевірте роботодавця{" "}
            <span className="text-brand-600">перед відгуком на вакансію</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base text-ink-soft sm:text-lg">
            Прозора робота допомагає кандидатам перевіряти компанії, зарплати,
            оформлення, бронювання та ризики ще до співбесіди.
          </p>

          <div className="mx-auto mt-8 max-w-2xl">
            <SearchBar placeholder="Введіть назву компанії або вставте текст вакансії" />
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Button href="/check-vacancy" variant="primary">
              <FileSearch className="h-4 w-4" /> Перевірити вакансію
            </Button>
            <Button href="/companies" variant="secondary">
              <Building2 className="h-4 w-4" /> Знайти компанію
            </Button>
            <Button href="/add-review" variant="outline">
              <MessageSquarePlus className="h-4 w-4" /> Залишити відгук
            </Button>
          </div>
        </HeroAnimator>
      </section>

      <section>
        <Card className="flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-7">
          <div className="max-w-2xl">
            <h2 className="font-display text-2xl font-bold text-ink">
              Перевірте вакансію перед відгуком
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft sm:text-base">
              Вставте посилання або текст вакансії — ми покажемо ризики, що відомо
              про компанію, які є відгуки та що уточнити перед співбесідою.
            </p>
          </div>
          <Button href="/check-vacancy" size="lg" className="justify-center">
            <FileSearch className="h-4 w-4" /> Перевірити вакансію
          </Button>
        </Card>
      </section>

      {/* ── Що можна перевірити ───────────────────────────────────────── */}
      <section>
        <SectionTitle
          eyebrow="Що можна перевірити"
          title="Реальні умови — до того, як іти на співбесіду"
          description="Анонімний досвід людей, які вже там працювали або проходили відбір."
        />
        <StaggerGrid className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {WHAT_TO_CHECK.map(({ icon: Icon, label }) => (
            <div
              key={label}
              className="flex items-center gap-3 rounded-2xl border border-ink/[0.06] bg-white p-4"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                <Icon className="h-4 w-4" />
              </span>
              <span className="text-sm font-medium text-ink">{label}</span>
            </div>
          ))}
        </StaggerGrid>
      </section>

      {/* ── Популярні компанії (Supabase) ─────────────────────────────── */}
      {featuredCompanies.length > 0 && (
        <section>
          <SectionTitle
            eyebrow="Популярні компанії"
            title="Перевірте відомих роботодавців"
          />
          <StaggerGrid className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {featuredCompanies.map((c) => (
              <Link
                key={c.slug}
                href={`/companies/${c.slug}`}
                className="group focus-ring rounded-2xl"
              >
                <Card className="h-full p-5 transition-shadow group-hover:shadow-card-hover">
                  <p className="font-display font-bold text-ink group-hover:text-brand-700">
                    {c.name}
                  </p>
                  <div className="mt-1 space-y-0.5">
                    {c.industry && (
                      <p className="flex items-center gap-1 text-xs text-ink-muted">
                        <Briefcase className="h-3 w-3" />
                        {normalizeIndustry(c.industry)}
                      </p>
                    )}
                    {c.city && (
                      <p className="flex items-center gap-1 text-xs text-ink-muted">
                        <MapPin className="h-3 w-3" /> {c.city}
                      </p>
                    )}
                  </div>
                  <p className="mt-3 text-xs font-semibold text-brand-700">
                    Переглянути →
                  </p>
                </Card>
              </Link>
            ))}
          </StaggerGrid>
          <div className="mt-4 text-center">
            <Button href="/companies" variant="secondary" size="sm">
              Усі компанії
            </Button>
          </div>
        </section>
      )}

      {/* ── Останні відгуки (Supabase) ────────────────────────────────── */}
      {recentReviews.length > 0 && (
        <section>
          <SectionTitle
            eyebrow="Останні відгуки"
            title="Що пишуть зараз"
          />
          <StaggerGrid className="mt-6 grid gap-4 md:grid-cols-3">
            {recentReviews.map((r) => {
              const avgRating = (() => {
                const vals = [
                  r.ratings?.salary, r.ratings?.schedule, r.ratings?.management,
                  r.ratings?.conditions, r.ratings?.honesty,
                ].filter((v): v is number => typeof v === "number" && !isNaN(v));
                return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
              })();
              return (
                <Card key={r.id} className="space-y-3 p-5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-ink">{r.companyName}</p>
                      <p className="text-xs text-ink-muted">
                        {TYPE_LABEL[r.type] ?? r.type}
                      </p>
                    </div>
                    {avgRating !== null && (
                      <div className="flex items-center gap-1 rounded-lg bg-brand-50 px-2 py-1">
                        <Star className="h-3 w-3 text-amber-400" />
                        <span className="text-xs font-semibold text-brand-700">
                          {avgRating.toFixed(1)}
                        </span>
                      </div>
                    )}
                  </div>
                  <p className="line-clamp-3 text-sm text-ink-soft">{r.text}</p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-ink-muted">
                    <span className="flex items-center gap-1">
                      <MapPin className="h-3 w-3" /> {r.city}
                    </span>
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" /> {r.year}
                    </span>
                  </div>
                  <Link
                    href={`/companies/${r.companySlug}`}
                    className="text-xs font-semibold text-brand-700 hover:text-brand-800"
                  >
                    Переглянути компанію →
                  </Link>
                </Card>
              );
            })}
          </StaggerGrid>
        </section>
      )}

      {/* ── Блок довіри ───────────────────────────────────────────────── */}
      <section>
        <FadeInSection className="rounded-2xl border border-ink/[0.06] bg-white p-6 sm:p-8">
          <h2 className="font-display text-lg font-bold text-ink">
            Як ми дбаємо про конфіденційність
          </h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {[
              {
                icon: ShieldCheck,
                text: "Відгуки публікуються анонімно після модерації.",
              },
              {
                icon: FileX,
                text: "Ми не публікуємо телефони, email, Telegram або інші персональні дані.",
              },
              {
                icon: CheckCircle2,
                text: "Оцінки не є юридичним висновком.",
              },
            ].map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-start gap-3">
                <Icon className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
                <p className="text-sm text-ink-soft">{text}</p>
              </div>
            ))}
          </div>
        </FadeInSection>
      </section>

      {/* ── Bottom CTA ────────────────────────────────────────────────── */}
      <section>
        <FadeInSection className="rounded-2xl border border-brand-100 bg-brand-50 px-6 py-8 sm:px-10 sm:py-9">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
            <div className="space-y-1.5">
              <h2 className="font-display text-xl font-bold text-ink sm:text-2xl">
                Мали досвід роботи або співбесіди?
              </h2>
              <p className="text-sm leading-relaxed text-ink-soft sm:text-base">
                Поділіться досвідом анонімно — це допоможе іншим не помилитися з
                вибором роботодавця.
              </p>
            </div>
            <div className="shrink-0">
              <Button href="/add-review" variant="primary" size="lg" className="w-full sm:w-auto">
                Додати відгук
              </Button>
            </div>
          </div>
        </FadeInSection>
      </section>
    </div>
  );
}
