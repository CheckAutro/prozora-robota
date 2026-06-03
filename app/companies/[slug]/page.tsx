import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  MapPin,
  Briefcase,
  PenLine,
} from "lucide-react";

import { COMPANIES } from "@/lib/mock-data";
import { getSupabaseCompanyBySlug } from "@/lib/company-service";
import { getPublicExternalRatings } from "@/lib/external-ratings-service";
import { getServerClient } from "@/lib/supabase/server";
import { normalizeIndustry } from "@/lib/industry";
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
                <Briefcase className="h-4 w-4" /> {normalizeIndustry(mockFallback.industry)}
              </span>
            )}
          </div>
          <div className="mt-5">
            <Button href={`/add-review?company=${encodeURIComponent(slug)}`}>
              <PenLine className="h-4 w-4" /> Додати відгук
            </Button>
          </div>
        </Card>
        <section className="space-y-3">
          <h2 className="font-display text-lg font-bold text-ink">Відгуки</h2>
          <CompanyReviewsSection
            companySlug={mockFallback.slug}
            companyName={mockFallback.name}
          />
          <p className="text-xs text-ink-muted">
            Відгуки публікуються анонімно після модерації.
          </p>
        </section>
        <ExternalRatingsSection ratings={externalRatings} />
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

      {/* Reviews: summary + ratings + risks + geo/roles + list (all from Supabase) */}
      <section className="space-y-3">
        <h2 className="font-display text-lg font-bold text-ink">Відгуки</h2>
        <CompanyReviewsSection
          companySlug={sbCompany.slug}
          companyName={sbCompany.name}
        />
        <p className="text-xs text-ink-muted">
          Відгуки публікуються анонімно після модерації.
        </p>
      </section>

      <ExternalRatingsSection ratings={externalRatings} />

      <p className="text-center text-xs text-ink-muted">
        Інформація про компанію формується на основі анонімних відгуків і не є офіційною
        оцінкою роботодавця.
      </p>
    </div>
  );
}
