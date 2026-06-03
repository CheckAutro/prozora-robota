"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { SectionTitle } from "@/components/ui/Card";
import { ReviewForm } from "@/components/product/ReviewForm";
import { isSupabaseConfigured, getBrowserClient } from "@/lib/supabase/client";
import { COMPANIES } from "@/lib/mock-data";

interface PrefilledCompany {
  name: string;
  slug: string;
}

/**
 * Resolves ?company=<slug> query param to a { name, slug } pair.
 * Tries Supabase first, then falls back to mock data, then gives up.
 */
async function resolveCompanyBySlug(slug: string): Promise<PrefilledCompany | null> {
  // Try Supabase
  if (isSupabaseConfigured()) {
    try {
      const client = getBrowserClient();
      const { data, error } = await client
        .from("companies")
        .select("name, slug")
        .eq("slug", slug)
        .single();
      if (!error && data) return data as PrefilledCompany;
    } catch {
      // fall through
    }
  }
  // Try mock data
  const mock = COMPANIES.find((c) => c.slug === slug);
  if (mock) return { name: mock.name, slug: mock.slug };
  return null;
}

export function AddReviewClient() {
  const searchParams = useSearchParams();
  const companyParam = searchParams.get("company") ?? "";

  const [prefilled, setPrefilled] = useState<PrefilledCompany | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!companyParam) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setReady(true);
      return;
    }
    // If the param looks like a slug (no spaces, lowercase) try to resolve it.
    // Otherwise treat it directly as a company name with no known slug.
    const looksLikeSlug = /^[a-z0-9-]+$/.test(companyParam);
    if (looksLikeSlug) {
      resolveCompanyBySlug(companyParam).then((result) => {
        setPrefilled(result);
        setReady(true);
      });
    } else {
      // Raw name passed (legacy behaviour) — use as-is, no slug
      setPrefilled({ name: companyParam, slug: "" });
      setReady(true);
    }
  }, [companyParam]);

  if (!ready) {
    return <div className="container-page py-10 text-ink-muted">Завантаження…</div>;
  }

  return (
    <div className="container-page max-w-3xl space-y-8 py-8 sm:py-10">
      <SectionTitle
        eyebrow="Анонімний відгук"
        title="Поділіться досвідом роботи або співбесіди"
        description="Це займе 2–3 хвилини. Відгук буде опубліковано анонімно після модерації."
      />

      <p className="flex items-start gap-2 rounded-xl border border-brand-100 bg-brand-50/60 p-4 text-sm text-ink-soft">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
        Не вказуйте у тексті імена, телефони, Telegram, email або документи — ми не публікуємо
        персональні дані й приберемо їх на модерації.
      </p>

      <ReviewForm
        defaultCompany={prefilled?.name ?? ""}
        defaultCompanySlug={prefilled?.slug ?? null}
      />
    </div>
  );
}
