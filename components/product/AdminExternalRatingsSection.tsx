"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  EyeOff,
  Globe,
  Loader2,
  Plus,
  RefreshCw,
  Star,
  Trash2,
  UsersRound,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import type { ExternalRating, ExternalRatingStatus } from "@/lib/types";

function getAdminHeaders(accessToken: string): Record<string, string> {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${accessToken}`,
  };
}

const STATUS_META: Record<ExternalRatingStatus, { label: string; color: string }> = {
  needs_verification: { label: "На перевірці", color: "text-amber-700 bg-amber-50 border-amber-200" },
  verified:           { label: "Підтверджено",  color: "text-brand-700 bg-brand-50 border-brand-200" },
  rejected:           { label: "Відхилено",     color: "text-red-700 bg-red-50 border-red-200" },
};

const EMPTY_FORM = {
  company_slug: "",
  company_name: "",
  source_name: "",
  source_url: "",
  rating_value: "",
  rating_scale: "5",
  reviews_count: "0",
  fetched_at: "",
  note: "",
  status: "needs_verification" as ExternalRatingStatus,
  is_public: false,
};

function formatDate(value: string | null): string {
  if (!value) return "Без дати";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Без дати";
  return date.toLocaleDateString("uk-UA");
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("uk-UA").format(value);
}

function RatingCard({
  rating,
  onUpdate,
  onDelete,
}: {
  rating: ExternalRating;
  onUpdate: (id: string, patch: Record<string, unknown>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const statusMeta = STATUS_META[rating.status];

  async function act(patch: Record<string, unknown>) {
    setBusy(true);
    await onUpdate(rating.id, patch);
    setBusy(false);
  }

  return (
    <div className="space-y-3 rounded-xl border border-ink/[0.06] bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-ink">{rating.companyName}</span>
            <span className="text-xs text-ink-muted">{rating.companySlug}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
            <Globe className="h-3.5 w-3.5" />
            <span>{rating.sourceName}</span>
            {rating.sourceUrl && (
              <a
                href={rating.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-brand-700"
              >
                Джерело
              </a>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("rounded-md border px-2 py-0.5 text-xs font-medium", statusMeta.color)}>
            {statusMeta.label}
          </span>
          {rating.isPublic && (
            <span className="rounded-md border border-brand-200 bg-brand-50 px-2 py-0.5 text-xs text-brand-700">
              Публічно
            </span>
          )}
        </div>
      </div>

      <div className="grid gap-2 text-sm text-ink-soft sm:grid-cols-3">
        <div className="inline-flex items-center gap-1.5">
          <Star className="h-4 w-4 text-amber-400" />
          <span className="font-semibold text-ink">
            {rating.ratingValue !== null
              ? `${rating.ratingValue.toFixed(1)} / ${rating.ratingScale ?? 5}`
              : "Без оцінки"}
          </span>
        </div>
        <div className="inline-flex items-center gap-1.5">
          <UsersRound className="h-4 w-4 text-brand-600" />
          <span>{formatNumber(rating.reviewsCount)}</span>
        </div>
        <div className="inline-flex items-center gap-1.5">
          <CalendarClock className="h-4 w-4 text-brand-600" />
          <span>{formatDate(rating.fetchedAt)}</span>
        </div>
      </div>

      {rating.note && (
        <p className="rounded-lg bg-ink/[0.03] px-3 py-2 text-xs text-ink-muted">
          {rating.note}
        </p>
      )}

      <div className="flex flex-wrap gap-2 border-t border-ink/[0.06] pt-3">
        <Button
          size="sm"
          variant="primary"
          disabled={busy}
          onClick={() => void act({ status: "verified", is_public: true })}
        >
          <CheckCircle2 className="h-3.5 w-3.5" /> Підтвердити
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !rating.isPublic}
          onClick={() => void act({ is_public: false })}
        >
          <EyeOff className="h-3.5 w-3.5" /> Приховати
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          className="ml-auto text-red-600 hover:bg-red-50"
          onClick={() => { if (confirm("Видалити зовнішню оцінку?")) void onDelete(rating.id); }}
        >
          <Trash2 className="h-3.5 w-3.5" /> Видалити
        </Button>
        {busy && <Loader2 className="h-4 w-4 animate-spin text-ink-muted" />}
      </div>
    </div>
  );
}

function CreateRatingForm({
  accessToken,
  onCreate,
}: {
  accessToken: string;
  onCreate: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/external-ratings", {
        method: "POST",
        headers: getAdminHeaders(accessToken),
        body: JSON.stringify(form),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (data.ok) {
        setForm(EMPTY_FORM);
        setOpen(false);
        onCreate();
      } else {
        setError(data.error ?? "Помилка збереження");
      }
    } catch {
      setError("Помилка зʼєднання");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5" /> Додати оцінку
      </Button>
    );
  }

  const inputCls = "w-full rounded-xl border border-ink/12 bg-white px-3 py-2 text-sm focus-ring";

  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-ink">Нова зовнішня оцінка</h3>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-ink-muted hover:text-ink"
        >
          Скасувати
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-ink">Slug компанії *</label>
          <input
            className={inputCls}
            placeholder="nova-poshta"
            value={form.company_slug}
            onChange={(e) => setForm({ ...form, company_slug: e.target.value })}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink">Назва компанії *</label>
          <input
            className={inputCls}
            placeholder="Нова Пошта"
            value={form.company_name}
            onChange={(e) => setForm({ ...form, company_name: e.target.value })}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink">Джерело *</label>
          <input
            className={inputCls}
            placeholder="Google, Work.ua, DOU..."
            value={form.source_name}
            onChange={(e) => setForm({ ...form, source_name: e.target.value })}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink">URL джерела</label>
          <input
            className={inputCls}
            placeholder="https://..."
            value={form.source_url}
            onChange={(e) => setForm({ ...form, source_url: e.target.value })}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink">Оцінка</label>
          <input
            className={inputCls}
            inputMode="decimal"
            placeholder="4.2"
            value={form.rating_value}
            onChange={(e) => setForm({ ...form, rating_value: e.target.value })}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink">Шкала</label>
          <input
            className={inputCls}
            inputMode="decimal"
            value={form.rating_scale}
            onChange={(e) => setForm({ ...form, rating_scale: e.target.value })}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink">Кількість оцінок</label>
          <input
            className={inputCls}
            inputMode="numeric"
            value={form.reviews_count}
            onChange={(e) => setForm({ ...form, reviews_count: e.target.value })}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink">Дата отримання</label>
          <input
            type="date"
            className={inputCls}
            value={form.fetched_at}
            onChange={(e) => setForm({ ...form, fetched_at: e.target.value })}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink">Статус</label>
          <select
            className={inputCls}
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value as ExternalRatingStatus })}
          >
            <option value="needs_verification">На перевірці</option>
            <option value="verified">Підтверджено</option>
            <option value="rejected">Відхилено</option>
          </select>
        </div>
        <label className="flex items-center gap-2 self-end rounded-xl border border-ink/12 bg-white px-3 py-2 text-sm text-ink-soft">
          <input
            type="checkbox"
            checked={form.is_public}
            onChange={(e) => setForm({ ...form, is_public: e.target.checked })}
          />
          Показувати публічно
        </label>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-ink">Нотатка</label>
        <textarea
          className={inputCls}
          rows={3}
          value={form.note}
          onChange={(e) => setForm({ ...form, note: e.target.value })}
        />
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4" /> {error}
        </div>
      )}

      <Button onClick={() => void handleSubmit()} disabled={saving} size="sm">
        {saving
          ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Збереження…</>
          : "Зберегти оцінку"
        }
      </Button>
    </Card>
  );
}

export function AdminExternalRatingsSection({ accessToken }: { accessToken: string }) {
  const [ratings, setRatings] = useState<ExternalRating[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/external-ratings", {
        headers: getAdminHeaders(accessToken),
      });
      if (res.status === 401) { setError("Сесія завершилась — перезавантажте сторінку."); return; }
      if (res.status === 403) { setError("Доступ заборонено."); return; }
      const data = await res.json() as { ratings?: ExternalRating[]; error?: string };
      if (data.error) {
        setError(data.error);
        setRatings([]);
      } else {
        setRatings(data.ratings ?? []);
      }
    } catch {
      setError("Помилка завантаження");
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  async function handleUpdate(id: string, patch: Record<string, unknown>) {
    const res = await fetch(`/api/admin/external-ratings/${id}`, {
      method: "PATCH",
      headers: getAdminHeaders(accessToken),
      body: JSON.stringify(patch),
    });
    if (res.ok) await load();
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/admin/external-ratings/${id}`, {
      method: "DELETE",
      headers: getAdminHeaders(accessToken),
    });
    if (res.ok) await load();
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display font-bold text-ink">Оцінки з відкритих джерел</h2>
          <p className="mt-0.5 text-xs text-ink-muted">
            Окремі довідкові оцінки. Не додаються до відгуків і не впливають на
            внутрішній рейтинг.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => void load()}>
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      <CreateRatingForm accessToken={accessToken} onCreate={() => void load()} />

      {loading && (
        <div className="flex items-center gap-2 text-sm text-ink-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Завантаження…
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4" /> {error}
        </div>
      )}
      {!loading && !error && ratings.length === 0 && (
        <p className="text-sm text-ink-muted">Зовнішніх оцінок ще немає.</p>
      )}
      {!loading && ratings.map((rating) => (
        <RatingCard
          key={rating.id}
          rating={rating}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
        />
      ))}
    </section>
  );
}
