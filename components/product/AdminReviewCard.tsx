"use client";

import { useState, useRef, useCallback } from "react";
import {
  MapPin, Calendar, Check, X, PenLine, AlertTriangle,
  Building2, CheckCircle2, Link2, Plus, Search, Loader2,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { detectReviewRisks } from "@/lib/detect-risks";
import type { Review, ReviewType } from "@/lib/types";

const TYPE_LABEL: Record<ReviewType, string> = {
  employee:  "Працівник",
  interview: "Кандидат (співбесіда)",
  internship: "Стажер",
  applicant:  "Кандидат (відгукнувся)",
};

const ANSWER_LABELS: Record<string, string> = {
  yes: "так", no: "ні", partial: "частково", unknown: "не знаю",
  promised_later: "обіцяли пізніше", not_applicable: "не актуально",
  official_day_one: "офіційне з першого дня",
  after_internship: "після стажування",
  unofficial: "неофіційне", no_internship: "не було стажування",
};

function ans(v: string): string { return ANSWER_LABELS[v] ?? v; }

/** Synchronous — token comes from parent, no session reads here. */
function getAdminHeaders(accessToken: string): Record<string, string> {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${accessToken}`,
  };
}

interface CompanySuggestion {
  name: string; slug: string; city: string | null; industry: string | null;
}

// ── BindCombobox ──────────────────────────────────────────────────────────────

function BindCombobox({
  accessToken,
  onBind,
  onCancel,
}: {
  accessToken: string;
  onBind: (c: CompanySuggestion) => void;
  onCancel: () => void;
}) {
  const [query,   setQuery]   = useState("");
  const [results, setResults] = useState<CompanySuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(async (q: string) => {
    if (q.length < 2) { setResults([]); return; }
    setLoading(true);
    try {
      const res = await fetch(
        `/api/admin/companies/search?q=${encodeURIComponent(q)}`,
        { headers: getAdminHeaders(accessToken) }
      );
      const data = await res.json() as { companies?: CompanySuggestion[] };
      setResults(data.companies ?? []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  function handleInput(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setQuery(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void search(v), 220);
  }

  return (
    <div className="space-y-2">
      <div className="relative flex items-center gap-2 rounded-xl border border-ink/12 bg-white px-3">
        <Search className="h-4 w-4 shrink-0 text-ink-muted" />
        <input
          autoFocus value={query} onChange={handleInput}
          placeholder="Знайти компанію…"
          className="w-full bg-transparent py-2 text-sm focus:outline-none"
        />
        {loading && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-ink-muted" />}
      </div>
      {results.length > 0 && (
        <ul className="max-h-48 overflow-y-auto rounded-xl border border-ink/12 bg-white shadow-lg">
          {results.map((c) => (
            <li key={c.slug}>
              <button type="button" onClick={() => onBind(c)}
                className="flex w-full flex-col px-4 py-2.5 text-left hover:bg-brand-50">
                <span className="text-sm font-medium text-ink">{c.name}</span>
                <span className="text-xs text-ink-muted">
                  {[c.city, c.industry].filter(Boolean).join(" · ")} · {c.slug}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Button variant="ghost" size="sm" onClick={onCancel} className="text-ink-muted">
        Скасувати
      </Button>
    </div>
  );
}

// ── Main card ─────────────────────────────────────────────────────────────────

type CompanyStatus = { type: "loading" } | { type: "exists" } | { type: "missing" };

export function AdminReviewCard({
  review: initialReview,
  accessToken,
  onPublish,
  onReject,
  onNeedsEdit,
}: {
  review: Review;
  accessToken: string;
  onPublish: () => void;
  onReject: () => void;
  onNeedsEdit: () => void;
}) {
  const [review, setReview]         = useState(initialReview);
  const [companyStatus, setCompanyStatus] = useState<CompanyStatus>({ type: "loading" });
  const [mode, setMode]             = useState<"idle" | "bind">("idle");
  const [actionMsg, setActionMsg]   = useState<string | null>(null);
  const [creating, setCreating]     = useState(false);

  const risks = detectReviewRisks(review.text, review.companyName);

  // Check company existence on mount — use passed token
  const checkCompany = useCallback(async () => {
    if (process.env.NODE_ENV === "development") {
      console.log("[AdminReviewCard] action with auth", Boolean(accessToken));
    }
    try {
      const res = await fetch(
        `/api/admin/companies?slugs=${encodeURIComponent(review.companySlug)}`,
        { headers: getAdminHeaders(accessToken) }
      );
      const data = await res.json() as { existing?: string[] };
      const exists = (data.existing ?? []).includes(review.companySlug);
      setCompanyStatus({ type: exists ? "exists" : "missing" });
    } catch {
      setCompanyStatus({ type: "missing" });
    }
  }, [accessToken, review.companySlug]);

  // Run on mount
  useState(() => { void checkCompany(); });

  async function handleCreateCompany() {
    setCreating(true);
    setActionMsg(null);
    try {
      const res = await fetch("/api/admin/companies", {
        method: "POST",
        headers: getAdminHeaders(accessToken),
        body: JSON.stringify({
          name:     review.companyName,
          slug:     review.companySlug,
          city:     review.city ?? null,
          industry: null,
        }),
      });
      const data = await res.json() as { ok?: boolean; created?: boolean; error?: string };
      if (data.ok) {
        setCompanyStatus({ type: "exists" });
        setActionMsg(
          data.created
            ? `Компанію "${review.companyName}" створено в базі.`
            : `Компанія "${review.companyName}" вже є в базі.`
        );
      } else {
        setActionMsg(`Помилка: ${data.error ?? "невідома"}`);
      }
    } catch {
      setActionMsg("Помилка зʼєднання з сервером.");
    } finally {
      setCreating(false);
    }
  }

  async function handleBind(selected: CompanySuggestion) {
    setMode("idle");
    setActionMsg(null);
    try {
      const res = await fetch(`/api/admin/reviews/${review.id}/company`, {
        method: "PATCH",
        headers: getAdminHeaders(accessToken),
        body: JSON.stringify({
          company_name: selected.name,
          company_slug: selected.slug,
        }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (data.ok) {
        setReview((r) => ({ ...r, companyName: selected.name, companySlug: selected.slug }));
        setCompanyStatus({ type: "exists" });
        setActionMsg(`Відгук привʼязано до компанії "${selected.name}".`);
      } else {
        setActionMsg(`Помилка: ${data.error ?? "невідома"}`);
      }
    } catch {
      setActionMsg("Помилка зʼєднання з сервером.");
    }
  }

  return (
    <Card className="space-y-4 p-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-display font-bold text-ink">{review.companyName}</span>
          <Badge tone="neutral">{TYPE_LABEL[review.type]}</Badge>
        </div>
        <div className="flex items-center gap-3 text-xs text-ink-muted">
          <span className="inline-flex items-center gap-1">
            <MapPin className="h-3 w-3" /> {review.city}
          </span>
          <span className="inline-flex items-center gap-1">
            <Calendar className="h-3 w-3" /> {review.year}
          </span>
        </div>
      </div>

      {/* Company status block */}
      <div className="rounded-xl border border-ink/[0.06] bg-white p-3 space-y-2">
        <div className="flex items-center gap-2 text-sm">
          <Building2 className="h-4 w-4 shrink-0 text-ink-muted" />
          <span className="text-ink-soft">
            Slug: <code className="rounded bg-ink/[0.06] px-1 py-0.5 text-xs">{review.companySlug}</code>
          </span>
        </div>

        {companyStatus.type === "loading" && (
          <div className="flex items-center gap-2 text-xs text-ink-muted">
            <Loader2 className="h-3 w-3 animate-spin" /> Перевірка бази…
          </div>
        )}
        {companyStatus.type === "exists" && (
          <div className="flex items-center gap-2 text-xs text-brand-700">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>Компанія є в базі —</span>
            <a href={`/companies/${review.companySlug}`} target="_blank" rel="noopener noreferrer"
               className="inline-flex items-center gap-0.5 underline hover:text-brand-800">
              <Link2 className="h-3 w-3" /> /companies/{review.companySlug}
            </a>
          </div>
        )}
        {companyStatus.type === "missing" && mode === "idle" && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-amber-700">
              <AlertTriangle className="h-3.5 w-3.5" />
              Компанії немає в базі
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => void handleCreateCompany()} disabled={creating}>
                <Plus className="h-3.5 w-3.5" />
                {creating ? "Створення…" : "Створити компанію з відгуку"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setMode("bind")}>
                <Search className="h-3.5 w-3.5" /> Привʼязати до існуючої
              </Button>
            </div>
          </div>
        )}
        {companyStatus.type === "missing" && mode === "bind" && (
          <BindCombobox
            accessToken={accessToken}
            onBind={(c) => void handleBind(c)}
            onCancel={() => setMode("idle")}
          />
        )}
        {actionMsg && (
          <p className="text-xs font-medium text-brand-700">{actionMsg}</p>
        )}
      </div>

      {/* Review text */}
      <p className="rounded-xl bg-ink/[0.03] p-3 text-sm leading-relaxed text-ink-soft">
        {review.text}
      </p>

      {/* Auto-flags */}
      {risks.length > 0 && (
        <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-800">
            <AlertTriangle className="h-4 w-4" /> Автоматичні флаги ризику
          </div>
          <ul className="space-y-1">
            {risks.map((r) => (
              <li key={r.code} className="text-xs text-amber-800">• {r.label}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Details */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3">
        <Detail label="Зарплата збіглась"  value={ans(review.salaryMatch)} />
        <Detail label="Оформлення"          value={ans(review.officialEmployment)} />
        <Detail label="Затримки виплат"     value={ans(review.paymentDelay)} />
        <Detail label="Бронь обіцяли"       value={ans(review.bookingPromised)} />
        <Detail label="Бронь оформили"      value={ans(review.bookingReceived)} />
        <Detail label="Стажування оплата"   value={ans(review.internshipPaid)} />
      </div>

      {/* Moderation actions */}
      <div className="flex flex-wrap gap-2 border-t border-ink/[0.06] pt-4">
        <Button onClick={onPublish} variant="primary" size="sm">
          <Check className="h-4 w-4" /> Опублікувати
        </Button>
        <Button onClick={onNeedsEdit} variant="outline" size="sm">
          <PenLine className="h-4 w-4" /> Потребує редагування
        </Button>
        <Button onClick={onReject} variant="ghost" size="sm" className="text-red-600 hover:bg-red-50">
          <X className="h-4 w-4" /> Відхилити
        </Button>
      </div>
    </Card>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-ink-muted">{label}:</span>
      <span className="font-medium text-ink-soft">{value}</span>
    </div>
  );
}
