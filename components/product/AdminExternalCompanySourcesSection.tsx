"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  RefreshCw,
  Square,
  CheckSquare,
  Trash2,
  Globe,
  AlertTriangle,
  XCircle,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { AdminBulkActionDialog } from "@/components/product/AdminBulkActionDialog";
import type { ExternalCompanySource, ExternalCompanySourceStatus, ExternalCompanySourceType } from "@/lib/types";

function getAdminHeaders(accessToken: string): Record<string, string> {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${accessToken}`,
  };
}

const STATUS_META: Record<ExternalCompanySourceStatus, { label: string; color: string }> = {
  needs_verification: { label: "На перевірці", color: "text-amber-700 bg-amber-50 border-amber-200" },
  verified: { label: "Підтверджено", color: "text-brand-700 bg-brand-50 border-brand-200" },
  rejected: { label: "Відхилено", color: "text-red-700 bg-red-50 border-red-200" },
};

const TYPE_META: Record<ExternalCompanySourceType, string> = {
  reviews: "Відгуки",
  rating: "Оцінка",
  vacancy: "Вакансія",
  company_page: "Сторінка компанії",
  article: "Стаття",
  other: "Інше",
};

type BulkAction = "approve" | "publish" | "unpublish" | "reject" | "mark_needs_verification";

const EMPTY_FORM = {
  company_slug: "",
  company_name: "",
  source_name: "",
  source_url: "",
  source_type: "company_page" as ExternalCompanySourceType,
  title: "",
  short_summary: "",
  status: "needs_verification" as ExternalCompanySourceStatus,
  is_public: false,
};

interface PendingBulkAction {
  action: BulkAction;
  ids: string[];
  title: string;
  fieldLabel: string;
  changeLabel: string;
  warning?: string;
  confirmLabel: string;
}

function formatDate(value: string | null): string {
  if (!value) return "Без дати";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Без дати";
  return date.toLocaleDateString("uk-UA");
}

function isValidUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return ["http:", "https:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

function filterItems(items: ExternalCompanySource[], query: { search: string; source: string; status: string; type: string }) {
  const search = query.search.trim().toLowerCase();
  return items.filter((item) => {
    if (query.status && item.status !== query.status) return false;
    if (query.source && item.sourceName.toLowerCase() !== query.source.toLowerCase()) return false;
    if (query.type && item.sourceType !== query.type) return false;
    if (!search) return true;
    return [
      item.companyName,
      item.companySlug,
      item.sourceName,
      item.sourceUrl,
      item.title ?? "",
      item.shortSummary,
    ].some((value) => (value ?? "").toLowerCase().includes(search));
  });
}

export function AdminExternalCompanySourcesSection({ accessToken }: { accessToken: string }) {
  const [items, setItems] = useState<ExternalCompanySource[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [filters, setFilters] = useState({ search: "", source: "", status: "", type: "" });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [pendingBulkAction, setPendingBulkAction] = useState<PendingBulkAction | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/external-company-sources", {
        headers: getAdminHeaders(accessToken),
      });
      if (!res.ok) throw new Error("Не вдалося завантажити зовнішні джерела.");
      const data = await res.json() as { sources: ExternalCompanySource[] };
      setItems(data.sources ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка завантаження зовнішніх джерел.");
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const filtered = useMemo(() => filterItems(items, filters), [items, filters]);
  const selectedItems = useMemo(() => filtered.filter((item) => selectedIds.has(item.id)), [filtered, selectedIds]);
  const allVisibleSelected = filtered.length > 0 && filtered.every((item) => selectedIds.has(item.id));

  function toggleVisibleSelection() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        filtered.forEach((item) => next.delete(item.id));
      } else {
        filtered.forEach((item) => next.add(item.id));
      }
      return next;
    });
  }

  function selectAllFiltered() {
    setSelectedIds(new Set(filtered.map((item) => item.id)));
  }

  async function refresh() {
    await load();
  }

  async function saveItem(id: string, patch: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/external-company-sources/${id}`, {
        method: "PATCH",
        headers: getAdminHeaders(accessToken),
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error ?? "Не вдалося оновити джерело.");
      }
      setMessage("Джерело оновлено.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка оновлення.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteItem(id: string) {
    if (!confirm("Видалити зовнішнє джерело?")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/external-company-sources/${id}`, {
        method: "DELETE",
        headers: getAdminHeaders(accessToken),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Не вдалося видалити джерело.");
      setMessage("Джерело видалено.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка видалення.");
    } finally {
      setBusy(false);
    }
  }

  async function submitForm(action: "create" | "collect") {
    if (!form.company_name.trim() || !form.source_name.trim()) {
      setError("Назва компанії та джерело обовʼязкові.");
      return;
    }
    if (action === "collect" && !form.source_url.trim()) {
      setError("URL джерела потрібен для збору даних.");
      return;
    }
    if (form.source_url.trim() && !isValidUrl(form.source_url.trim())) {
      setError("URL джерела має бути валідним.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/external-company-sources", {
        method: "POST",
        headers: getAdminHeaders(accessToken),
        body: JSON.stringify({
          ...form,
          action,
          company_slug: form.company_slug.trim() || undefined,
          source_url: form.source_url.trim() || undefined,
          short_summary: form.short_summary.trim() || undefined,
          title: form.title.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Не вдалося зберегти джерело.");
      setMessage(action === "collect" ? "Дані з джерела зібрано." : "Джерело додано.");
      setForm({ ...EMPTY_FORM });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка збереження.");
    } finally {
      setBusy(false);
    }
  }

  function requestBulkAction(action: BulkAction) {
    if (selectedItems.length === 0) return;
    const config: Record<BulkAction, PendingBulkAction> = {
      approve: {
        action,
        ids: selectedItems.map((item) => item.id),
        title: "Bulk: Підтвердити",
        fieldLabel: "status",
        changeLabel: "verified",
        confirmLabel: "Підтвердити",
      },
      publish: {
        action,
        ids: selectedItems.map((item) => item.id),
        title: "Bulk: Опублікувати",
        fieldLabel: "status / is_public",
        changeLabel: "verified; is_public=true",
        warning: "Публікація можлива лише для verified записів.",
        confirmLabel: "Опублікувати",
      },
      unpublish: {
        action,
        ids: selectedItems.map((item) => item.id),
        title: "Bulk: Приховати",
        fieldLabel: "is_public",
        changeLabel: "false",
        confirmLabel: "Приховати",
      },
      reject: {
        action,
        ids: selectedItems.map((item) => item.id),
        title: "Bulk: Відхилити",
        fieldLabel: "status / is_public",
        changeLabel: "rejected; is_public=false",
        confirmLabel: "Відхилити",
      },
      mark_needs_verification: {
        action,
        ids: selectedItems.map((item) => item.id),
        title: "Bulk: На перевірку",
        fieldLabel: "status",
        changeLabel: "needs_verification",
        confirmLabel: "Застосувати",
      },
    };
    setPendingBulkAction(config[action]);
  }

  async function runBulkAction() {
    if (!pendingBulkAction) return;
    setBulkBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/external-company-sources/bulk", {
        method: "POST",
        headers: getAdminHeaders(accessToken),
        body: JSON.stringify({
          action: pendingBulkAction.action,
          ids: pendingBulkAction.ids,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Не вдалося виконати bulk-дію.");
      setMessage(`Оновлено: ${data.updated_count ?? 0}, пропущено: ${data.skipped_count ?? 0}.`);
      setPendingBulkAction(null);
      setSelectedIds(new Set());
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка bulk-дії.");
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <Card className="space-y-5 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold text-ink">Відкриті зовнішні джерела</h2>
          <p className="mt-1 text-sm text-ink-soft">
            Додавання, модерація та публікація verified зовнішніх джерел окремо від відгуків Прозора робота.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => void refresh()} disabled={loading || busy || bulkBusy}>
            <RefreshCw className={cn("h-4 w-4", loading ? "animate-spin" : "")} /> Оновити
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}
      {message && (
        <div className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-800">
          {message}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <input
          className="w-full rounded-xl border border-ink/12 bg-white px-3 py-2 text-sm focus-ring"
          placeholder="Назва компанії"
          value={form.company_name}
          onChange={(e) => setForm({ ...form, company_name: e.target.value })}
        />
        <input
          className="w-full rounded-xl border border-ink/12 bg-white px-3 py-2 text-sm focus-ring"
          placeholder="Slug компанії"
          value={form.company_slug}
          onChange={(e) => setForm({ ...form, company_slug: e.target.value })}
        />
        <input
          className="w-full rounded-xl border border-ink/12 bg-white px-3 py-2 text-sm focus-ring"
          placeholder="Назва джерела"
          value={form.source_name}
          onChange={(e) => setForm({ ...form, source_name: e.target.value })}
        />
        <input
          className="w-full rounded-xl border border-ink/12 bg-white px-3 py-2 text-sm focus-ring"
          placeholder="URL джерела"
          value={form.source_url}
          onChange={(e) => setForm({ ...form, source_url: e.target.value })}
        />
        <select
          className="w-full rounded-xl border border-ink/12 bg-white px-3 py-2 text-sm focus-ring"
          value={form.source_type}
          onChange={(e) => setForm({ ...form, source_type: e.target.value as ExternalCompanySourceType })}
        >
          {Object.entries(TYPE_META).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <input
          className="w-full rounded-xl border border-ink/12 bg-white px-3 py-2 text-sm focus-ring"
          placeholder="Короткий заголовок / title"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
        />
      </div>

      <div className="grid gap-3">
        <textarea
          className="min-h-24 w-full rounded-xl border border-ink/12 bg-white px-3 py-2 text-sm focus-ring"
          placeholder="Коротке узагальнення / short summary"
          value={form.short_summary}
          onChange={(e) => setForm({ ...form, short_summary: e.target.value })}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy} onClick={() => void submitForm("collect")}>
          <Globe className="h-4 w-4" /> Зібрати дані з джерела
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void submitForm("create")}>
          <Plus className="h-4 w-4" /> Додати вручну
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <input
          className="w-full rounded-xl border border-ink/12 bg-white px-3 py-2 text-sm focus-ring"
          placeholder="Пошук"
          value={filters.search}
          onChange={(e) => setFilters({ ...filters, search: e.target.value })}
        />
        <input
          className="w-full rounded-xl border border-ink/12 bg-white px-3 py-2 text-sm focus-ring"
          placeholder="Фільтр по джерелу"
          value={filters.source}
          onChange={(e) => setFilters({ ...filters, source: e.target.value })}
        />
        <select
          className="w-full rounded-xl border border-ink/12 bg-white px-3 py-2 text-sm focus-ring"
          value={filters.status}
          onChange={(e) => setFilters({ ...filters, status: e.target.value })}
        >
          <option value="">Усі статуси</option>
          <option value="needs_verification">На перевірці</option>
          <option value="verified">Підтверджено</option>
          <option value="rejected">Відхилено</option>
        </select>
        <select
          className="w-full rounded-xl border border-ink/12 bg-white px-3 py-2 text-sm focus-ring"
          value={filters.type}
          onChange={(e) => setFilters({ ...filters, type: e.target.value })}
        >
          <option value="">Усі типи</option>
          {Object.entries(TYPE_META).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm text-ink-soft">
        <button type="button" onClick={toggleVisibleSelection} className="inline-flex items-center gap-2 rounded-xl border border-ink/12 px-3 py-2 hover:bg-ink/[0.03]">
          {allVisibleSelected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
          Вибрати всі на сторінці
        </button>
        <button type="button" onClick={selectAllFiltered} className="inline-flex items-center gap-2 rounded-xl border border-ink/12 px-3 py-2 hover:bg-ink/[0.03]">
          <CheckSquare className="h-4 w-4" />
          Вибрати всі за фільтром
        </button>
        <span>Вибрано: {selectedItems.length}</span>
        <Button size="sm" variant="outline" disabled={selectedItems.length === 0 || bulkBusy} onClick={() => requestBulkAction("approve")}>
          <CheckCircle2 className="h-4 w-4" /> Підтвердити
        </Button>
        <Button size="sm" variant="outline" disabled={selectedItems.length === 0 || bulkBusy} onClick={() => requestBulkAction("publish")}>
          <Eye className="h-4 w-4" /> Опублікувати
        </Button>
        <Button size="sm" variant="outline" disabled={selectedItems.length === 0 || bulkBusy} onClick={() => requestBulkAction("unpublish")}>
          <EyeOff className="h-4 w-4" /> Приховати
        </Button>
        <Button size="sm" variant="secondary" disabled={selectedItems.length === 0 || bulkBusy} onClick={() => requestBulkAction("reject")}>
          <XCircle className="h-4 w-4" /> Відхилити
        </Button>
        <Button size="sm" variant="ghost" disabled={selectedItems.length === 0 || bulkBusy} onClick={() => requestBulkAction("mark_needs_verification")}>
          На перевірку
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-ink-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Завантаження…
        </div>
      ) : filtered.length === 0 ? (
        <p className="rounded-xl bg-ink/[0.03] px-4 py-3 text-sm text-ink-soft">Немає записів за поточним фільтром.</p>
      ) : (
        <div className="space-y-3">
          {filtered.map((item) => {
            const selected = selectedIds.has(item.id);
            const statusMeta = STATUS_META[item.status];
            return (
              <div key={item.id} className={cn("rounded-2xl border p-4", selected ? "border-brand-300 bg-brand-50/30" : "border-ink/[0.06] bg-white")}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => setSelectedIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(item.id)) next.delete(item.id);
                        else next.add(item.id);
                        return next;
                      })}
                      className="mt-1 text-ink-muted hover:text-brand-700"
                      aria-label={selected ? "Зняти вибір" : "Вибрати джерело"}
                    >
                      {selected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                    </button>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-ink">{item.companyName}</h3>
                        <span className="text-xs text-ink-muted">{item.companySlug}</span>
                        <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", statusMeta.color)}>{statusMeta.label}</span>
                        {item.isPublic && <span className="rounded-full border border-brand-200 bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700">public</span>}
                        <span className="rounded-full border border-ink/10 bg-ink/[0.04] px-2 py-0.5 text-[11px] font-medium text-ink-soft">
                          {TYPE_META[item.sourceType]}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-ink-muted">
                        {item.sourceName} · {formatDate(item.collectedAt)}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => void saveItem(item.id, { status: "verified" })}>
                      Підтвердити
                    </Button>
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => void saveItem(item.id, { status: "verified", is_public: true })}>
                      Опублікувати
                    </Button>
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => void saveItem(item.id, { is_public: false })}>
                      Приховати
                    </Button>
                    <Button size="sm" variant="secondary" disabled={busy} onClick={() => void saveItem(item.id, { status: "rejected", is_public: false })}>
                      Відхилити
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => void deleteItem(item.id)}>
                      <Trash2 className="h-4 w-4" /> Видалити
                    </Button>
                  </div>
                </div>

                <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]">
                  <div className="space-y-2">
                    <p className="text-sm leading-relaxed text-ink-soft">{item.shortSummary}</p>
                    {item.title && <p className="text-sm font-medium text-ink">{item.title}</p>}
                    <div className="flex flex-wrap gap-2 text-xs text-ink-muted">
                      {item.sourceUrl && (
                        <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline hover:text-brand-700">
                          Джерело <Globe className="h-3.5 w-3.5" />
                        </a>
                      )}
                      <span>Оновлено: {formatDate(item.updatedAt)}</span>
                    </div>
                  </div>
                  <div className="space-y-2 text-xs text-ink-muted">
                    {item.positivePoints.length > 0 && (
                      <p><span className="font-medium text-ink">Позитив:</span> {item.positivePoints.slice(0, 2).join("; ")}</p>
                    )}
                    {item.negativePoints.length > 0 && (
                      <p><span className="font-medium text-ink">Ризики:</span> {item.negativePoints.slice(0, 2).join("; ")}</p>
                    )}
                    {item.neutralFacts.length > 0 && (
                      <p><span className="font-medium text-ink">Факти:</span> {item.neutralFacts.slice(0, 2).join("; ")}</p>
                    )}
                    <p className="rounded-lg bg-ink/[0.03] px-2.5 py-1.5">
                      Доступні verified + public записи показуються на сайті окремо від відгуків.
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <AdminBulkActionDialog
        open={Boolean(pendingBulkAction)}
        title={pendingBulkAction?.title ?? ""}
        count={pendingBulkAction?.ids.length ?? 0}
        fieldLabel={pendingBulkAction?.fieldLabel ?? ""}
        changeLabel={pendingBulkAction?.changeLabel ?? ""}
        warning={pendingBulkAction?.warning}
        confirmLabel={pendingBulkAction?.confirmLabel ?? "Підтвердити"}
        busy={bulkBusy}
        onCancel={() => setPendingBulkAction(null)}
        onConfirm={() => void runBulkAction()}
      />
    </Card>
  );
}
