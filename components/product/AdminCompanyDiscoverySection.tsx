"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Building2,
  Link2,
  Loader2,
  PenLine,
  RefreshCw,
  Search,
  Square,
  CheckSquare,
  Trash2,
  XCircle,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { AdminBulkActionDialog } from "@/components/product/AdminBulkActionDialog";
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

type DiscoveryBulkAction = "reject" | "needs_review" | "create_safe";

interface BulkSummary {
  updated_count: number;
  skipped_count: number;
  errors: Array<{ id: string; error: string }>;
}

interface PendingBulkAction {
  action: DiscoveryBulkAction;
  ids: string[];
  title: string;
  fieldLabel: string;
  changeLabel: string;
  warning?: string;
  confirmLabel: string;
}

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
  selected,
  onSelect,
  onUpdate,
  onDelete,
}: {
  item: CompanyDiscoveryQueueItem;
  selected: boolean;
  onSelect: (checked: boolean) => void;
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
        <div className="flex min-w-0 gap-3">
          <button
            type="button"
            onClick={() => onSelect(!selected)}
            className="mt-1 text-ink-muted hover:text-brand-700"
            aria-label={selected ? "Зняти вибір" : "Вибрати запис"}
          >
            {selected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
          </button>
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
            {item.suggestedSlug} · {item.sourceName} · створено: {formatDate(item.createdAt)}
          </p>
          {item.collectedAt && (
            <p className="mt-0.5 text-xs text-ink-muted">Зібрано: {formatDate(item.collectedAt)}</p>
          )}
          </div>
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
      {item.rawExcerpt && (
        <p className="rounded-xl bg-ink/[0.03] px-3 py-2 text-xs leading-relaxed text-ink-muted">
          Raw excerpt: {item.rawExcerpt}
        </p>
      )}
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
        <Button size="sm" onClick={() => void act({ status: "needs_review" })} variant="outline" disabled={busy}>
          <RefreshCw className="h-3.5 w-3.5" /> Повернути на перевірку
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
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [pendingBulk, setPendingBulk] = useState<PendingBulkAction | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | CompanyDiscoveryStatus>("all");
  const [sourceName, setSourceName] = useState("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

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
      if (sourceName !== "all" && item.sourceName !== sourceName) return false;
      if (!needle) return true;
      return [item.discoveredName, item.suggestedSlug, item.sourceName, item.city, item.industry, item.matchedExistingSlug]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
    });
  }, [items, query, sourceName, status]);

  const sourceOptions = useMemo(() => {
    return Array.from(new Set(items.map((item) => item.sourceName).filter(Boolean))).sort((a, b) => a.localeCompare(b, "uk"));
  }, [items]);

  const selectedItems = useMemo(() => {
    return filtered.filter((item) => selectedIds.has(item.id));
  }, [filtered, selectedIds]);

  const allVisibleSelected = filtered.length > 0 && filtered.every((item) => selectedIds.has(item.id));

  function toggleSelected(id: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAllFiltered() {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const item of filtered) {
        if (allVisibleSelected) next.delete(item.id);
        else next.add(item.id);
      }
      return next;
    });
  }

  function selectCurrentFilter() {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const item of filtered) next.add(item.id);
      return next;
    });
  }

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

  function requestBulkAction(action: DiscoveryBulkAction) {
    setError(null);
    setBulkMessage(null);
    if (selectedItems.length === 0) {
      setError("Спочатку виберіть записи для bulk-дії.");
      return;
    }

    const createTargets = action === "create_safe"
      ? selectedItems.filter((item) => item.status === "needs_review" && !item.isImported)
      : selectedItems;
    if (createTargets.length === 0) {
      setError("Немає needs_review записів для bulk create.");
      return;
    }

    const meta: Record<DiscoveryBulkAction, Omit<PendingBulkAction, "action" | "ids">> = {
      reject: {
        title: "Bulk: Ignore / reject",
        fieldLabel: "status / is_imported",
        changeLabel: "rejected; is_imported=false",
        confirmLabel: "Bulk ignore",
      },
      needs_review: {
        title: "Bulk: Mark needs_review",
        fieldLabel: "status / is_imported",
        changeLabel: "needs_review; is_imported=false",
        confirmLabel: "Mark needs_review",
      },
      create_safe: {
        title: "Bulk: Create companies where safe",
        fieldLabel: "public.companies / company_discovery_queue",
        changeLabel: "create company only if suggested_slug is free; mark queue item imported",
        warning: "Ця дія створює компанії в public.companies, але не створює reviews і не змінює рейтинги. Зайняті або невалідні slugs будуть пропущені.",
        confirmLabel: "Create safe companies",
      },
    };

    setPendingBulk({ action, ids: createTargets.map((item) => item.id), ...meta[action] });
  }

  async function executeBulkAction() {
    if (!pendingBulk) return;
    setBulkBusy(true);
    setError(null);
    setBulkMessage(null);
    try {
      const res = await fetch("/api/admin/company-discovery/bulk", {
        method: "POST",
        headers: getAdminHeaders(accessToken),
        body: JSON.stringify({ action: pendingBulk.action, ids: pendingBulk.ids }),
      });
      const data = await res.json() as Partial<BulkSummary> & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Bulk action failed");
      setBulkMessage(
        `Bulk complete: updated ${data.updated_count ?? 0}, skipped ${data.skipped_count ?? 0}` +
          (data.errors?.length ? `. Errors: ${data.errors.slice(0, 3).map((item) => item.error).join("; ")}` : "")
      );
      setPendingBulk(null);
      setSelectedIds(new Set());
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка bulk-дії");
    } finally {
      setBulkBusy(false);
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
        <select
          value={sourceName}
          onChange={(e) => setSourceName(e.target.value)}
          className="rounded-xl border border-ink/12 bg-white px-3 py-2.5 text-sm focus-ring"
        >
          <option value="all">Усі джерела</option>
          {sourceOptions.map((source) => (
            <option key={source} value={source}>{source}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-ink/[0.06] bg-white p-3 text-sm shadow-card">
        <label className="flex items-center gap-2 rounded-xl border border-ink/12 bg-white px-3 py-2 text-sm text-ink-soft">
          <input
            type="checkbox"
            checked={allVisibleSelected}
            onChange={toggleAllFiltered}
            disabled={filtered.length === 0 || busy || bulkBusy}
          />
          Вибрати всі на сторінці
        </label>
        <Button size="sm" variant="outline" onClick={selectCurrentFilter} disabled={filtered.length === 0 || busy || bulkBusy}>
          {allVisibleSelected ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
          Вибрати всі за фільтром ({filtered.length})
        </Button>
        <span className="rounded-lg bg-ink/[0.04] px-2.5 py-1 text-xs font-medium text-ink-soft">
          Вибрано: {selectedItems.length}
        </span>
        <Button size="sm" variant="secondary" disabled={busy || bulkBusy || selectedItems.length === 0} onClick={() => requestBulkAction("reject")}>
          <XCircle className="h-3.5 w-3.5" /> Bulk ignore
        </Button>
        <Button size="sm" variant="outline" disabled={busy || bulkBusy || selectedItems.length === 0} onClick={() => requestBulkAction("needs_review")}>
          <RefreshCw className="h-3.5 w-3.5" /> Needs review
        </Button>
        <Button size="sm" disabled={busy || bulkBusy || selectedItems.length === 0} onClick={() => requestBulkAction("create_safe")}>
          <Building2 className="h-3.5 w-3.5" /> Bulk create safe
        </Button>
        <span className="text-xs text-ink-muted">
          Bulk-дії застосовуються тільки до вибраних записів.
        </span>
      </div>

      {bulkMessage && (
        <div className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-700">
          {bulkMessage}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-ink-muted"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Завантаження...</p>
      ) : filtered.length === 0 ? (
        <Card className="p-6 text-sm text-ink-soft">
          Нових компаній у черзі немає.
        </Card>
      ) : (
        <div className="space-y-4">
          {filtered.map((item) => (
            <DiscoveryCard
              key={item.id}
              item={item}
              selected={selectedIds.has(item.id)}
              onSelect={(checked) => toggleSelected(item.id, checked)}
              onUpdate={updateItem}
              onDelete={deleteItem}
            />
          ))}
        </div>
      )}

      <p className="rounded-xl bg-ink/[0.03] px-4 py-3 text-xs text-ink-muted">
        Цей блок не створює відгуки, рейтинги або зовнішні сигнали. Він лише допомагає додавати нові компанії без дублів.
      </p>

      <AdminBulkActionDialog
        open={Boolean(pendingBulk)}
        title={pendingBulk?.title ?? ""}
        count={pendingBulk?.ids.length ?? 0}
        fieldLabel={pendingBulk?.fieldLabel ?? ""}
        changeLabel={pendingBulk?.changeLabel ?? ""}
        warning={pendingBulk?.warning}
        confirmLabel={pendingBulk?.confirmLabel}
        busy={bulkBusy}
        onCancel={() => setPendingBulk(null)}
        onConfirm={() => void executeBulkAction()}
      />
    </section>
  );
}
