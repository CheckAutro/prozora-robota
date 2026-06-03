"use client";

import { useState, useEffect, useCallback } from "react";
import {
  AlertTriangle, CheckCircle2, XCircle, RefreshCw,
  Eye, EyeOff, Plus, Trash2, Globe, Loader2,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import type { ExternalSignal, ExternalSignalType, ExternalSignalStatus } from "@/lib/types";

// ── Sync header builder — token comes from parent ─────────────────────────────

function getAdminHeaders(accessToken: string): Record<string, string> {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${accessToken}`,
  };
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SIGNAL_TYPE_LABELS: Record<ExternalSignalType, string> = {
  salary_delay:               "Затримки зарплати",
  unclear_salary:             "Нечітка зарплата",
  schedule_risk:              "Ризик графіку",
  overload:                   "Навантаження",
  official_employment_issue:  "Питання оформлення",
  interview_issue:            "Питання співбесіди",
  management_issue:           "Питання керівництва",
  booking_info:               "Бронювання (інфо)",
  internship_info:            "Стажування (інфо)",
  positive_team:              "✓ Колектив",
  positive_salary:            "✓ Зарплата",
  positive_conditions:        "✓ Умови",
  other:                      "Інше",
};

const STATUS_META: Record<ExternalSignalStatus, { label: string; color: string }> = {
  needs_verification: { label: "На перевірці", color: "text-amber-700 bg-amber-50 border-amber-200" },
  verified:           { label: "Підтверджено",  color: "text-brand-700 bg-brand-50 border-brand-200" },
  rejected:           { label: "Відхилено",     color: "text-red-700 bg-red-50 border-red-200"   },
};

// ── SignalCard ────────────────────────────────────────────────────────────────

function SignalCard({
  signal,
  accessToken,
  onUpdate,
  onDelete,
}: {
  signal: ExternalSignal;
  accessToken: string;
  onUpdate: (id: string, patch: Record<string, unknown>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const statusMeta = STATUS_META[signal.status];

  async function act(patch: Record<string, unknown>) {
    setBusy(true);
    await onUpdate(signal.id, patch);
    setBusy(false);
  }

  return (
    <div className="rounded-xl border border-ink/[0.06] bg-white p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="font-semibold text-ink text-sm">{signal.companyName}</span>
          <span className="ml-2 text-xs text-ink-muted">{signal.companySlug}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn("rounded-md border px-2 py-0.5 text-xs font-medium", statusMeta.color)}>
            {statusMeta.label}
          </span>
          {signal.isPublic && (
            <span className="rounded-md border border-brand-200 bg-brand-50 px-2 py-0.5 text-xs text-brand-700">
              Публічний
            </span>
          )}
        </div>
      </div>

      <div className="space-y-1">
        <div className="text-xs font-medium text-ink-muted">
          {SIGNAL_TYPE_LABELS[signal.signalType]}
        </div>
        <p className="text-sm text-ink-soft">{signal.shortSummary}</p>
        {(signal.sourceName || signal.sourceUrl) && (
          <div className="flex items-center gap-1 text-xs text-ink-muted">
            <Globe className="h-3 w-3" />
            {signal.sourceName && <span>{signal.sourceName}</span>}
            {signal.sourceUrl && (
              <a href={signal.sourceUrl} target="_blank" rel="noopener noreferrer"
                 className="underline hover:text-brand-700">
                {signal.sourceUrl.length > 50 ? signal.sourceUrl.slice(0, 50) + "…" : signal.sourceUrl}
              </a>
            )}
          </div>
        )}
        <div className="text-xs text-ink-muted">
          {new Date(signal.createdAt).toLocaleDateString("uk-UA")}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-t border-ink/[0.06] pt-3">
        {signal.status !== "verified" && (
          <Button size="sm" variant="primary" disabled={busy}
            onClick={() => void act({ status: "verified" })}>
            <CheckCircle2 className="h-3.5 w-3.5" /> Підтвердити
          </Button>
        )}
        {signal.status !== "rejected" && (
          <Button size="sm" variant="ghost" disabled={busy}
            className="text-red-600 hover:bg-red-50"
            onClick={() => void act({ status: "rejected" })}>
            <XCircle className="h-3.5 w-3.5" /> Відхилити
          </Button>
        )}
        {signal.status !== "needs_verification" && (
          <Button size="sm" variant="outline" disabled={busy}
            onClick={() => void act({ status: "needs_verification" })}>
            <RefreshCw className="h-3.5 w-3.5" /> На перевірку
          </Button>
        )}
        <Button size="sm" variant="outline" disabled={busy}
          onClick={() => void act({ is_public: !signal.isPublic })}>
          {signal.isPublic
            ? <><EyeOff className="h-3.5 w-3.5" /> Приховати</>
            : <><Eye className="h-3.5 w-3.5" /> Зробити публічним</>
          }
        </Button>
        <Button size="sm" variant="ghost" disabled={busy}
          className="text-red-600 hover:bg-red-50 ml-auto"
          onClick={() => { if (confirm("Видалити сигнал?")) void onDelete(signal.id); }}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
        {busy && <Loader2 className="h-4 w-4 animate-spin text-ink-muted" />}
      </div>

      {/* Unused but keeps prop typed cleanly */}
      <span className="hidden">{accessToken.length}</span>
    </div>
  );
}

// ── CreateSignalForm ──────────────────────────────────────────────────────────

const EMPTY_FORM = {
  company_slug: "", company_name: "", short_summary: "",
  signal_type: "other" as ExternalSignalType,
  source_name: "", source_url: "",
};

function CreateSignalForm({
  accessToken,
  onCreate,
}: {
  accessToken: string;
  onCreate: () => void;
}) {
  const [open,   setOpen]   = useState(false);
  const [form,   setForm]   = useState(EMPTY_FORM);
  const [error,  setError]  = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit() {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/admin/external-signals", {
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
        <Plus className="h-3.5 w-3.5" /> Додати сигнал
      </Button>
    );
  }

  const inputCls = "w-full rounded-xl border border-ink/12 bg-white px-3 py-2 text-sm focus-ring";

  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-ink text-sm">Новий сигнал</h3>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-ink-muted hover:text-ink">
          Скасувати
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-ink">Slug компанії *</label>
          <input className={inputCls} placeholder="nova-poshta"
            value={form.company_slug}
            onChange={(e) => setForm({ ...form, company_slug: e.target.value })} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink">Назва компанії *</label>
          <input className={inputCls} placeholder="Нова Пошта"
            value={form.company_name}
            onChange={(e) => setForm({ ...form, company_name: e.target.value })} />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-ink">
          Короткий нейтральний опис * <span className="text-ink-muted">(10–500 символів)</span>
        </label>
        <textarea className={inputCls} rows={3}
          placeholder="У відкритих джерелах зустрічаються згадки про..."
          value={form.short_summary}
          onChange={(e) => setForm({ ...form, short_summary: e.target.value })} />
        <p className="mt-0.5 text-xs text-ink-muted">{form.short_summary.length} / 500</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-ink">Тип сигналу *</label>
          <select className={inputCls}
            value={form.signal_type}
            onChange={(e) => setForm({ ...form, signal_type: e.target.value as ExternalSignalType })}>
            {(Object.entries(SIGNAL_TYPE_LABELS) as [ExternalSignalType, string][]).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink">Джерело (назва)</label>
          <input className={inputCls} placeholder="DOU, Work.ua…"
            value={form.source_name}
            onChange={(e) => setForm({ ...form, source_name: e.target.value })} />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-ink">URL джерела</label>
        <input className={inputCls} placeholder="https://..."
          value={form.source_url}
          onChange={(e) => setForm({ ...form, source_url: e.target.value })} />
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4" /> {error}
        </div>
      )}

      <Button onClick={() => void handleSubmit()} disabled={saving} variant="primary" size="sm">
        {saving ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Збереження…</> : "Зберегти"}
      </Button>
    </Card>
  );
}

// ── AdminSignalsSection ───────────────────────────────────────────────────────

export function AdminSignalsSection({ accessToken }: { accessToken: string }) {
  const [signals,      setSignals]      = useState<ExternalSignal[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [statusFilter, setStatusFilter] = useState<ExternalSignalStatus | "">("");
  const [error,        setError]        = useState<string | null>(null);

  const load = useCallback(async () => {
    if (process.env.NODE_ENV === "development") {
      console.log("[AdminSignalsSection] fetch with auth", Boolean(accessToken));
    }
    setLoading(true);
    setError(null);
    try {
      const qs = statusFilter ? `?status=${statusFilter}` : "";
      const res = await fetch(`/api/admin/external-signals${qs}`, {
        headers: getAdminHeaders(accessToken),
      });
      if (res.status === 401) { setError("Сесія завершилась — перезавантажте сторінку."); return; }
      if (res.status === 403) { setError("Доступ заборонено."); return; }
      const data = await res.json() as { signals?: ExternalSignal[]; error?: string };
      if (data.error) { setError(data.error); setSignals([]); }
      else setSignals(data.signals ?? []);
    } catch {
      setError("Помилка завантаження");
    } finally {
      setLoading(false);
    }
  }, [accessToken, statusFilter]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  async function handleUpdate(id: string, patch: Record<string, unknown>) {
    const res = await fetch(`/api/admin/external-signals/${id}`, {
      method: "PATCH",
      headers: getAdminHeaders(accessToken),
      body: JSON.stringify(patch),
    });
    if (res.ok) await load();
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/admin/external-signals/${id}`, {
      method: "DELETE",
      headers: getAdminHeaders(accessToken),
    });
    if (res.ok) await load();
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display font-bold text-ink">Зовнішні сигнали</h2>
          <p className="text-xs text-ink-muted mt-0.5">
            Короткі нотатки адміна — не публікуються як відгуки, не впливають на рейтинги.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="rounded-lg border border-ink/12 bg-white px-2.5 py-1.5 text-xs focus-ring"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as ExternalSignalStatus | "")}>
            <option value="">Всі статуси</option>
            <option value="needs_verification">На перевірці</option>
            <option value="verified">Підтверджені</option>
            <option value="rejected">Відхилені</option>
          </select>
          <Button size="sm" variant="outline" onClick={() => void load()}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <CreateSignalForm accessToken={accessToken} onCreate={() => void load()} />

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
      {!loading && !error && signals.length === 0 && (
        <p className="text-sm text-ink-muted">Сигналів немає. Додайте перший.</p>
      )}
      {!loading && signals.map((s) => (
        <SignalCard
          key={s.id}
          signal={s}
          accessToken={accessToken}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
        />
      ))}
    </section>
  );
}
