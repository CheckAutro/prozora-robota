"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  MessageSquareText,
  PenLine,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  XCircle,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import type {
  ExternalReviewSignal,
  ExternalReviewSignalConfidence,
  ExternalReviewSignalSentiment,
  ExternalReviewSignalStatus,
  ExternalReviewSignalTopic,
} from "@/lib/types";

function getAdminHeaders(accessToken: string): Record<string, string> {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${accessToken}`,
  };
}

const TOPIC_OPTIONS: Array<{ value: ExternalReviewSignalTopic; label: string }> = [
  { value: "salary", label: "Зарплата" },
  { value: "schedule", label: "Графік" },
  { value: "employment", label: "Оформлення" },
  { value: "management", label: "Керівництво" },
  { value: "workload", label: "Навантаження" },
  { value: "payment_delay", label: "Затримки виплат" },
  { value: "interview", label: "Співбесіда" },
  { value: "booking", label: "Бронювання" },
  { value: "benefits", label: "Бонуси / переваги" },
  { value: "career", label: "Карʼєра" },
  { value: "culture", label: "Культура" },
  { value: "other", label: "Інше" },
];

const SENTIMENT_OPTIONS: Array<{ value: ExternalReviewSignalSentiment; label: string }> = [
  { value: "positive", label: "Позитивно" },
  { value: "mixed", label: "Змішано" },
  { value: "negative", label: "Негативно" },
  { value: "neutral", label: "Нейтрально" },
];

const CONFIDENCE_OPTIONS: Array<{ value: ExternalReviewSignalConfidence; label: string }> = [
  { value: "low", label: "Низька" },
  { value: "medium", label: "Середня" },
  { value: "high", label: "Висока" },
];

const STATUS_META: Record<ExternalReviewSignalStatus, { label: string; color: string }> = {
  needs_verification: { label: "На перевірці", color: "text-amber-700 bg-amber-50 border-amber-200" },
  verified:           { label: "Підтверджено",  color: "text-brand-700 bg-brand-50 border-brand-200" },
  rejected:           { label: "Відхилено",     color: "text-red-700 bg-red-50 border-red-200" },
};

const SENTIMENT_META: Record<ExternalReviewSignalSentiment, { label: string; color: string }> = {
  positive: { label: "позитивно", color: "text-brand-700 bg-brand-50 border-brand-200" },
  mixed:    { label: "змішано",   color: "text-amber-700 bg-amber-50 border-amber-200" },
  negative: { label: "негативно", color: "text-red-700 bg-red-50 border-red-200" },
  neutral:  { label: "нейтрально", color: "text-ink-soft bg-ink/[0.04] border-ink/10" },
};

function topicLabel(topic: ExternalReviewSignalTopic): string {
  return TOPIC_OPTIONS.find((item) => item.value === topic)?.label ?? "Інше";
}

function toDateInput(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function toEditableForm(signal?: ExternalReviewSignal) {
  return {
    company_slug: signal?.companySlug ?? "",
    company_name: signal?.companyName ?? "",
    source_name: signal?.sourceName ?? "",
    source_url: signal?.sourceUrl ?? "",
    topic: signal?.topic ?? "other",
    sentiment: signal?.sentiment ?? "neutral",
    summary: signal?.summary ?? "",
    mentions_count: String(signal?.mentionsCount ?? 1),
    sample_size: signal?.sampleSize === null || signal?.sampleSize === undefined ? "" : String(signal.sampleSize),
    confidence: signal?.confidence ?? "medium",
    collected_at: toDateInput(signal?.collectedAt ?? null),
    status: signal?.status ?? "needs_verification",
    is_public: signal?.isPublic ?? false,
    admin_note: signal?.adminNote ?? "",
  };
}

function formToPatch(form: ReturnType<typeof toEditableForm>) {
  return {
    ...form,
    mentions_count: form.mentions_count.trim() ? Number(form.mentions_count) : 1,
    sample_size: form.sample_size.trim() ? Number(form.sample_size) : null,
  };
}

function formatDate(value: string | null): string {
  if (!value) return "Без дати";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Без дати";
  return date.toLocaleDateString("uk-UA");
}

function SignalForm({
  title,
  initial,
  busy,
  onCancel,
  onSave,
}: {
  title: string;
  initial?: ExternalReviewSignal;
  busy: boolean;
  onCancel: () => void;
  onSave: (patch: Record<string, unknown>) => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => toEditableForm(initial));
  const inputCls = "w-full rounded-xl border border-ink/12 bg-white px-3 py-2 text-sm focus-ring";

  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        <button type="button" onClick={onCancel} className="text-xs text-ink-muted hover:text-ink">
          Скасувати
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {[
          ["company_slug", "Slug компанії *"],
          ["company_name", "Назва компанії *"],
          ["source_name", "Джерело *"],
          ["source_url", "URL джерела"],
        ].map(([key, label]) => (
          <div key={key}>
            <label className="mb-1 block text-xs font-medium text-ink">{label}</label>
            <input
              className={inputCls}
              value={String(draft[key as keyof typeof draft])}
              onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
            />
          </div>
        ))}

        <div>
          <label className="mb-1 block text-xs font-medium text-ink">Тема</label>
          <select
            className={inputCls}
            value={draft.topic}
            onChange={(e) => setDraft({ ...draft, topic: e.target.value as ExternalReviewSignalTopic })}
          >
            {TOPIC_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink">Тональність</label>
          <select
            className={inputCls}
            value={draft.sentiment}
            onChange={(e) => setDraft({ ...draft, sentiment: e.target.value as ExternalReviewSignalSentiment })}
          >
            {SENTIMENT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink">Кількість згадок</label>
          <input
            type="number"
            min="0"
            className={inputCls}
            value={draft.mentions_count}
            onChange={(e) => setDraft({ ...draft, mentions_count: e.target.value })}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink">Розмір вибірки</label>
          <input
            type="number"
            min="0"
            className={inputCls}
            value={draft.sample_size}
            onChange={(e) => setDraft({ ...draft, sample_size: e.target.value })}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink">Впевненість</label>
          <select
            className={inputCls}
            value={draft.confidence}
            onChange={(e) => setDraft({ ...draft, confidence: e.target.value as ExternalReviewSignalConfidence })}
          >
            {CONFIDENCE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink">Статус</label>
          <select
            className={inputCls}
            value={draft.status}
            onChange={(e) => setDraft({ ...draft, status: e.target.value as ExternalReviewSignalStatus })}
          >
            <option value="needs_verification">На перевірці</option>
            <option value="verified">Підтверджено</option>
            <option value="rejected">Відхилено</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink">Дата збору</label>
          <input
            type="date"
            className={inputCls}
            value={draft.collected_at}
            onChange={(e) => setDraft({ ...draft, collected_at: e.target.value })}
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-ink">
          Коротке узагальнення сенсу * <span className="font-normal text-ink-muted">(20-300 символів, не дослівний відгук)</span>
        </label>
        <textarea
          className={inputCls}
          rows={4}
          value={draft.summary}
          onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-ink">Admin note</label>
        <textarea
          className={inputCls}
          rows={2}
          value={draft.admin_note}
          onChange={(e) => setDraft({ ...draft, admin_note: e.target.value })}
        />
      </div>

      <label className="flex items-center gap-2 rounded-xl border border-ink/12 bg-white px-3 py-2 text-sm text-ink-soft">
        <input
          type="checkbox"
          checked={draft.is_public}
          onChange={(e) => setDraft({ ...draft, is_public: e.target.checked })}
        />
        Показувати публічно після перевірки
      </label>

      <Button size="sm" disabled={busy} onClick={() => void onSave(formToPatch(draft))}>
        {busy ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Збереження…</> : "Зберегти"}
      </Button>
    </Card>
  );
}

function SignalCard({
  signal,
  onUpdate,
  onDelete,
}: {
  signal: ExternalReviewSignal;
  onUpdate: (id: string, patch: Record<string, unknown>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const statusMeta = STATUS_META[signal.status];
  const sentimentMeta = SENTIMENT_META[signal.sentiment];

  async function act(patch: Record<string, unknown>) {
    setBusy(true);
    await onUpdate(signal.id, patch);
    setBusy(false);
  }

  async function save(patch: Record<string, unknown>) {
    setBusy(true);
    await onUpdate(signal.id, patch);
    setEditing(false);
    setBusy(false);
  }

  if (editing) {
    return (
      <SignalForm
        title="Редагувати сигнал з відкритих джерел"
        initial={signal}
        busy={busy}
        onCancel={() => setEditing(false)}
        onSave={save}
      />
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-ink/[0.06] bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-ink">{signal.companyName}</span>
            <span className="text-xs text-ink-muted">{signal.companySlug}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
            <MessageSquareText className="h-3.5 w-3.5" />
            <span>{signal.sourceName}</span>
            {signal.sourceUrl && (
              <a href={signal.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-brand-700">
                Джерело
              </a>
            )}
            <span>Зібрано: {formatDate(signal.collectedAt)}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("rounded-md border px-2 py-0.5 text-xs font-medium", sentimentMeta.color)}>
            {sentimentMeta.label}
          </span>
          <span className={cn("rounded-md border px-2 py-0.5 text-xs font-medium", statusMeta.color)}>
            {statusMeta.label}
          </span>
          {signal.isPublic && (
            <span className="rounded-md border border-brand-200 bg-brand-50 px-2 py-0.5 text-xs text-brand-700">
              Публічно
            </span>
          )}
        </div>
      </div>

      <div className="rounded-xl bg-ink/[0.03] px-4 py-3">
        <p className="text-sm font-semibold text-ink">
          {topicLabel(signal.topic)}: {sentimentMeta.label}
        </p>
        <p className="mt-1 text-sm leading-relaxed text-ink-soft">{signal.summary}</p>
        <p className="mt-2 text-xs text-ink-muted">
          {signal.mentionsCount} згадок · впевненість: {signal.confidence}
          {signal.sampleSize !== null ? ` · вибірка: ${signal.sampleSize}` : ""}
        </p>
      </div>

      {signal.adminNote && (
        <p className="text-xs leading-relaxed text-ink-muted">Admin note: {signal.adminNote}</p>
      )}

      <div className="flex flex-wrap gap-2 border-t border-ink/[0.06] pt-3">
        <Button size="sm" variant="primary" disabled={busy} onClick={() => void act({ status: "verified" })}>
          <CheckCircle2 className="h-3.5 w-3.5" /> Підтвердити
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || signal.isPublic || signal.status !== "verified" || !signal.sourceUrl}
          onClick={() => void act({ is_public: true })}
        >
          <Eye className="h-3.5 w-3.5" /> Зробити публічним
        </Button>
        <Button size="sm" variant="outline" disabled={busy || !signal.isPublic} onClick={() => void act({ is_public: false })}>
          <EyeOff className="h-3.5 w-3.5" /> Приховати
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void act({ status: "rejected" })}>
          <XCircle className="h-3.5 w-3.5" /> Відхилити
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditing(true)}>
          <PenLine className="h-3.5 w-3.5" /> Редагувати
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          className="ml-auto text-red-600 hover:bg-red-50"
          onClick={() => { if (confirm("Видалити сигнал з відкритих джерел?")) void onDelete(signal.id); }}
        >
          <Trash2 className="h-3.5 w-3.5" /> Видалити
        </Button>
        {busy && <Loader2 className="h-4 w-4 animate-spin text-ink-muted" />}
      </div>
    </div>
  );
}

export function AdminExternalReviewSignalsSection({ accessToken }: { accessToken: string }) {
  const [signals, setSignals] = useState<ExternalReviewSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyCreate, setBusyCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | ExternalReviewSignalStatus>("needs_verification");
  const [companyFilter, setCompanyFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [topicFilter, setTopicFilter] = useState<"all" | ExternalReviewSignalTopic>("all");
  const [sentimentFilter, setSentimentFilter] = useState<"all" | ExternalReviewSignalSentiment>("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/external-review-signals", {
        headers: getAdminHeaders(accessToken),
      });
      if (res.status === 401) { setError("Сесія завершилась — перезавантажте сторінку."); return; }
      if (res.status === 403) { setError("Доступ заборонено."); return; }
      const data = await res.json() as { signals?: ExternalReviewSignal[]; error?: string };
      if (data.error) {
        setError(data.error);
        setSignals([]);
      } else {
        setSignals(data.signals ?? []);
      }
    } catch {
      setError("Помилка завантаження");
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const company = companyFilter.trim().toLowerCase();
    const source = sourceFilter.trim().toLowerCase();
    return signals.filter((signal) => {
      if (statusFilter !== "all" && signal.status !== statusFilter) return false;
      if (topicFilter !== "all" && signal.topic !== topicFilter) return false;
      if (sentimentFilter !== "all" && signal.sentiment !== sentimentFilter) return false;
      if (company && !`${signal.companyName} ${signal.companySlug}`.toLowerCase().includes(company)) return false;
      if (source && !signal.sourceName.toLowerCase().includes(source)) return false;
      return true;
    });
  }, [signals, statusFilter, topicFilter, sentimentFilter, companyFilter, sourceFilter]);

  async function handleCreate(patch: Record<string, unknown>) {
    setBusyCreate(true);
    setError(null);
    const res = await fetch("/api/admin/external-review-signals", {
      method: "POST",
      headers: getAdminHeaders(accessToken),
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      setShowCreate(false);
      await load();
    } else {
      const data = await res.json().catch(() => ({})) as { error?: string };
      setError(data.error ?? "Не вдалося створити сигнал");
    }
    setBusyCreate(false);
  }

  async function handleUpdate(id: string, patch: Record<string, unknown>) {
    const res = await fetch(`/api/admin/external-review-signals/${id}`, {
      method: "PATCH",
      headers: getAdminHeaders(accessToken),
      body: JSON.stringify(patch),
    });
    if (res.ok) await load();
    else {
      const data = await res.json().catch(() => ({})) as { error?: string };
      setError(data.error ?? "Не вдалося оновити сигнал");
    }
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/admin/external-review-signals/${id}`, {
      method: "DELETE",
      headers: getAdminHeaders(accessToken),
    });
    if (res.ok) await load();
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display font-bold text-ink">Сигнали з відкритих джерел</h2>
          <p className="mt-0.5 text-xs text-ink-muted">
            Короткі перевірені узагальнення зовнішніх відгуків. Не є відгуками
            Прозора робота і не впливають на внутрішній рейтинг.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowCreate((value) => !value)}>
            <Plus className="h-3.5 w-3.5" /> Додати сигнал
          </Button>
          <Button size="sm" variant="outline" onClick={() => void load()}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {showCreate && (
        <SignalForm
          title="Додати сигнал з відкритих джерел"
          busy={busyCreate}
          onCancel={() => setShowCreate(false)}
          onSave={handleCreate}
        />
      )}

      <div className="flex flex-wrap gap-2">
        <select
          className="rounded-xl border border-ink/12 bg-white px-3 py-2 text-sm focus-ring"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as "all" | ExternalReviewSignalStatus)}
        >
          <option value="all">Усі статуси</option>
          <option value="needs_verification">На перевірці</option>
          <option value="verified">Підтверджено</option>
          <option value="rejected">Відхилено</option>
        </select>
        <select
          className="rounded-xl border border-ink/12 bg-white px-3 py-2 text-sm focus-ring"
          value={topicFilter}
          onChange={(e) => setTopicFilter(e.target.value as "all" | ExternalReviewSignalTopic)}
        >
          <option value="all">Усі теми</option>
          {TOPIC_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <select
          className="rounded-xl border border-ink/12 bg-white px-3 py-2 text-sm focus-ring"
          value={sentimentFilter}
          onChange={(e) => setSentimentFilter(e.target.value as "all" | ExternalReviewSignalSentiment)}
        >
          <option value="all">Усі тональності</option>
          {SENTIMENT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <div className="flex items-center gap-2 rounded-xl border border-ink/12 bg-white px-3 py-2">
          <Search className="h-4 w-4 text-ink-muted" />
          <input
            value={companyFilter}
            onChange={(e) => setCompanyFilter(e.target.value)}
            placeholder="Компанія або slug"
            className="bg-transparent text-sm focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-ink/12 bg-white px-3 py-2">
          <Search className="h-4 w-4 text-ink-muted" />
          <input
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            placeholder="Джерело"
            className="bg-transparent text-sm focus:outline-none"
          />
        </div>
      </div>

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
      {!loading && !error && filtered.length === 0 && (
        <p className="text-sm text-ink-muted">Підтверджених або чернеткових зовнішніх сигналів ще немає.</p>
      )}
      {!loading && filtered.map((signal) => (
        <SignalCard key={signal.id} signal={signal} onUpdate={handleUpdate} onDelete={handleDelete} />
      ))}
    </section>
  );
}
