"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Building2,
  CheckCircle2,
  Link2,
  Loader2,
  PenLine,
  RefreshCw,
  Search,
  Trash2,
  XCircle,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import type { CompanyDiscoveryQueueItem, CompanyDiscoveryStatus } from "@/lib/types";

function getAdminHeaders(accessToken: string): Record<string, string> {
  return {
    "content-type": "application/json",
    authorization: "Bearer " + accessToken,
  };
}

const STATUS_META: Record<CompanyDiscoveryStatus, { label: string; color: string }> = {
  needs_review: { label: "Потребує перевірки", color: "text-amber-700 bg-amber-50 border-amber-200" },
  auto_imported: { label: "Імпортовано", color: "text-brand-700 bg-brand-50 border-brand-200" },
  matched_existing: { label: "Звʼязано", color: "text-brand-700 bg-brand-50 border-brand-200" },
  rejected: { label: "Відхилено", color: "text-red-700 bg-red-50 border-red-200" },
};

function toDateInput(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function toEditableForm(item: CompanyDiscoveryQueueItem) {
  return {
    discovered_name: item.discoveredName,
    suggested_slug: item.suggestedSlug,
    source_name: item.sourceName,
    source_url: item.sourceUrl ?? "",
    city: item.city ?? "",
    industry: item.industry ?? "",
    description: item.description ?? "",
    company_size: item.companySize ?? "",
    matched_existing_slug: item.matchedExistingSlug ?? "",
    match_confidence: item.matchConfidence,
    status: item.status,
    is_imported: item.isImported,
    imported_company_slug: item.importedCompanySlug ?? "",
    raw_excerpt: item.rawExcerpt ?? "",
    collected_at: toDateInput(item.collectedAt),
    admin_note: item.adminNote ?? "",
  };
}

function formatDate(value: string | null): string {
  if (!value) return "Без дати";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Без дати";
  return date.toLocaleDateString("uk-UA");
}

function DiscoveryEditForm({
  item,
  busy,
  onCancel,
  onSave,
}: {
  item: CompanyDiscoveryQueueItem;
  busy: boolean;
  onCancel: () => void;
  onSave: (patch: Record<string, unknown>) => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => toEditableForm(item));
  const inputCls = "w-full rounded-xl border border-ink/12 bg-white px-3 py-2 text-sm focus-ring";

  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-ink">Редагувати знайдену компанію</h3>
        <button type="button" onClick={onCancel} className="text-xs text-ink-muted hover:text-ink">
          Скасувати
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {[
          ["discovered_name", "Назва *"],
          ["suggested_slug", "Slug *"],
          ["source_name", "Джерело *"],
          ["source_url", "URL джерела"],
          ["city", "Місто"],
          ["industry", "Сфера"],
          ["company_size", "Розмір компанії"],
          ["matched_existing_slug", "Slug існуючої компанії"],
          ["imported_company_slug", "Slug імпортованої компанії"],
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
          <label className="mb-1 block text-xs font-medium text-ink">Впевненість</label>
          <select
            className={inputCls}
            value={draft.match_confidence}
            onChange={(e) => setDraft({ ...draft, match_confidence: e.target.value as typeof draft.match_confidence })}
          >
            <option value="low">Низька</option>
            <option value="medium">Середня</option>
            <option value="high">Висока</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink">Статус</label>
          <select
            className={inputCls}
            value={draft.status}
            onChange={(e) => setDraft({ ...draft, status: e.target.value as CompanyDiscoveryStatus })}
          >
            <option value="needs_review">Потребує перевірки</option>
            <option value="auto_imported">Імпортовано</option>
            <option value="matched_existing">Звʼязано</option>
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

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-ink">Опис</label>
          <textarea
            className={inputCls}
            rows={4}
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink">Raw excerpt</label>
          <textarea
            className={inputCls}
            rows={4}
            value={draft.raw_excerpt}
            onChange={(e) => setDraft({ ...draft, raw_excerpt: e.target.value })}
          />
        </div>
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

      <Button size="sm" disabled={busy} onClick={() => void onSave(draft)}>
        {busy ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Збереження...</> : "Зберегти зміни"}
      </Button>
    </Card>
  );
}

function DiscoveryCard({
  item,
  onUpdate,
  onDelete,
}: {
  item: CompanyDiscoveryQueueItem;
  onUpdate: (id: string, patch: Record<string, unknown>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const statusMeta = STATUS_META[item.status];

  async function act(patch: Record<string, unknown>) {
    setBusy(true);
    await onUpdate(item.id, patch);
    setBusy(false);
  }

  async function save(patch: Record<string, unknown>) {
    setBusy(true);
    await onUpdate(item.id, patch);
    setEditing(false);
    setBusy(false);
  }

  async function linkExisting() {
    const slug = window.prompt("Вкажіть slug існуючої компанії", item.matchedExistingSlug ?? "");
    if (!slug) return;
    await act({ action: "link_existing", matched_existing_slug: slug.trim() });
  }

  if (editing) {
    return <DiscoveryEditForm item={item} busy={busy} onCancel={() => setEditing(false)} onSave={save} />;
  }

  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-lg font-bold text-ink">{item.discoveredName}</h3>
            <span className={cn("rounded-full border px-2.5 py-1 text-xs font-medium", statusMeta.color)}>
              {statusMeta.label}
            </span>
            <span className="rounded-full bg-ink/[0.04] px-2.5 py-1 text-xs text-ink-soft">
              {item.matchConfidence}
            </span>
          </div>
          <p className="mt-1 text-sm text-ink-soft">
            {item.suggestedSlug} · {item.sourceName} · {formatDate(item.collectedAt)}
          </p>
        </div>
        {item.sourceUrl && (
          <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-brand-700 hover:text-brand-800">
            Джерело
          </a>
        )}
      </div>

      <div className="grid gap-2 text-sm text-ink-soft sm:grid-cols-2">
        <span><strong className="text-ink">Місто:</strong> {item.city ?? "Не вказано"}</span>
        <span><strong className="text-ink">Сфера:</strong> {item.industry ?? "Не вказано"}</span>
        <span><strong className="text-ink">Розмір:</strong> {item.companySize ?? "Не вказано"}</span>
        <span><strong className="text-ink">Збіг:</strong> {item.matchedExistingSlug ?? "Не звʼязано"}</span>
      </div>

      {item.description && <p className="text-sm leading-relaxed text-ink-soft">{item.description}</p>}
      {item.adminNote && <p className="rounded-xl bg-ink/[0.03] px-3 py-2 text-xs text-ink-muted">{item.adminNote}</p>}

      <div className="flex flex-wrap gap-2 border-t border-ink/[0.06] pt-4">
        <Button size="sm" onClick={() => setEditing(true)} variant="outline" disabled={busy}>
          <PenLine className="h-3.5 w-3.5" /> Редагувати
        </Button>
        <Button size="sm" onClick={() => void act({ action: "create_company" })} disabled={busy || item.status === "auto_imported"}>
          <Building2 className="h-3.5 w-3.5" /> Створити компанію
        </Button>
        <Button size="sm" onClick={() => void linkExisting()} variant="secondary" disabled={busy}>
          <Link2 className="h-3.5 w-3.5" /> Звʼязати з існуючою
        </Button>
        <Button size="sm" onClick={() => void act({ status: "rejected" })} variant="secondary" disabled={busy}>
          <XCircle className="h-3.5 w-3.5" /> Відхилити
        </Button>
        <Button size="sm" onClick={() => void onDelete(item.id)} variant="ghost" disabled={busy} className="text-red-700">
          <Trash2 className="h-3.5 w-3.5" /> Видалити
        </Button>
      </div>
    </Card>
  );
}

export function AdminCompanyDiscoverySection({ accessToken }: { accessToken: string }) {
  const [items, setItems] = useState<CompanyDiscoveryQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | CompanyDiscoveryStatus>("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/company-discovery", { headers: getAdminHeaders(accessToken) });
      const data = await res.json() as { items?: CompanyDiscoveryQueueItem[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Не вдалося завантажити нові компанії");
      setItems(data.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка завантаження");
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      if (status !== "all" && item.status !== status) return false;
      if (!needle) return true;
      return [item.discoveredName, item.suggestedSlug, item.sourceName, item.city, item.industry, item.matchedExistingSlug]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
    });
  }, [items, query, status]);

  async function updateItem(id: string, patch: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/company-discovery/" + id, {
        method: "PATCH",
        headers: getAdminHeaders(accessToken),
        body: JSON.stringify(patch),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Не вдалося оновити запис");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка оновлення");
    } finally {
      setBusy(false);
    }
  }

  async function deleteItem(id: string) {
    if (!window.confirm("Видалити запис з черги?")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/company-discovery/" + id, {
        method: "DELETE",
        headers: getAdminHeaders(accessToken),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Не вдалося видалити запис");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка видалення");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold text-ink">Нові компанії з відкритих джерел</h2>
          <p className="mt-1 max-w-3xl text-sm text-ink-soft">
            Черга для компаній, знайдених у відкритих вакансіях. Автоімпорт вимкнений за замовчуванням;
            сумнівні збіги залишаються на перевірці, щоб не створювати дублікати.
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => void load()} disabled={loading || busy}>
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /> Оновити
        </Button>
      </div>

      {error && <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <div className="flex flex-col gap-3 rounded-2xl border border-ink/[0.06] bg-white p-4 shadow-card sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-ink/10 px-3">
          <Search className="h-4 w-4 shrink-0 text-ink-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Пошук за назвою, slug або джерелом"
            className="w-full bg-transparent py-2.5 text-sm focus:outline-none"
          />
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
          className="rounded-xl border border-ink/12 bg-white px-3 py-2.5 text-sm focus-ring"
        >
          <option value="all">Усі статуси</option>
          <option value="needs_review">Потребує перевірки</option>
          <option value="auto_imported">Імпортовано</option>
          <option value="matched_existing">Звʼязано</option>
          <option value="rejected">Відхилено</option>
        </select>
      </div>

      {loading ? (
        <p className="text-sm text-ink-muted"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Завантаження...</p>
      ) : filtered.length === 0 ? (
        <Card className="p-6 text-sm text-ink-soft">
          Нових компаній у черзі немає.
        </Card>
      ) : (
        <div className="space-y-4">
          {filtered.map((item) => (
            <DiscoveryCard key={item.id} item={item} onUpdate={updateItem} onDelete={deleteItem} />
          ))}
        </div>
      )}

      <p className="rounded-xl bg-ink/[0.03] px-4 py-3 text-xs text-ink-muted">
        Цей блок не створює відгуки, рейтинги або зовнішні сигнали. Він лише допомагає додавати нові компанії без дублів.
      </p>
    </section>
  );
}
