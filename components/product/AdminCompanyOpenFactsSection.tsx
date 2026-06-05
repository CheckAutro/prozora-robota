"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  EyeOff,
  FileText,
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
import type { CompanyOpenFact, CompanyOpenFactStatus } from "@/lib/types";

function getAdminHeaders(accessToken: string): Record<string, string> {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${accessToken}`,
  };
}

const STATUS_META: Record<CompanyOpenFactStatus, { label: string; color: string }> = {
  needs_verification: { label: "На перевірці", color: "text-amber-700 bg-amber-50 border-amber-200" },
  verified:           { label: "Підтверджено",  color: "text-brand-700 bg-brand-50 border-brand-200" },
  rejected:           { label: "Відхилено",     color: "text-red-700 bg-red-50 border-red-200" },
};

type OpenFactsBulkAction =
  | "mark_verified"
  | "mark_needs_verification"
  | "make_public"
  | "make_private"
  | "reject";

interface BulkSummary {
  updated_count: number;
  skipped_count: number;
  errors: Array<{ id: string; error: string }>;
}

interface PendingBulkAction {
  action: OpenFactsBulkAction;
  ids: string[];
  title: string;
  fieldLabel: string;
  changeLabel: string;
  warning?: string;
  confirmLabel: string;
}

function arrayToText(values: string[]): string {
  return values.join("\n");
}

function toDateInput(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function toEditableForm(fact: CompanyOpenFact) {
  return {
    company_slug: fact.companySlug,
    company_name: fact.companyName,
    source_name: fact.sourceName,
    source_url: fact.sourceUrl ?? "",
    vacancy_title: fact.vacancyTitle ?? "",
    city: fact.city ?? "",
    salary_text: fact.salaryText ?? "",
    employment_type: fact.employmentType ?? "",
    schedule: fact.schedule ?? "",
    experience: fact.experience ?? "",
    education: fact.education ?? "",
    company_description: fact.companyDescription ?? "",
    vacancy_description: fact.vacancyDescription ?? "",
    requirements: arrayToText(fact.requirements),
    responsibilities: arrayToText(fact.responsibilities),
    conditions: arrayToText(fact.conditions),
    benefits: arrayToText(fact.benefits),
    skills: arrayToText(fact.skills),
    mentions_official_employment: fact.mentionsOfficialEmployment,
    mentions_booking: fact.mentionsBooking,
    mentions_probation: fact.mentionsProbation,
    mentions_bonus: fact.mentionsBonus,
    raw_excerpt: fact.rawExcerpt ?? "",
    collected_at: toDateInput(fact.collectedAt),
    status: fact.status,
    is_public: fact.isPublic,
  };
}

function formatDate(value: string | null): string {
  if (!value) return "Без дати";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Без дати";
  return date.toLocaleDateString("uk-UA");
}

function splitTextarea(value: string): string[] {
  return value.split(/\r?\n|;/).map((item) => item.trim()).filter(Boolean);
}

function formToPatch(form: ReturnType<typeof toEditableForm>) {
  return {
    ...form,
    requirements: splitTextarea(form.requirements),
    responsibilities: splitTextarea(form.responsibilities),
    conditions: splitTextarea(form.conditions),
    benefits: splitTextarea(form.benefits),
    skills: splitTextarea(form.skills),
  };
}

function SmallText({ children }: { children: React.ReactNode }) {
  return <p className="text-xs leading-relaxed text-ink-muted">{children}</p>;
}

function FactEditForm({
  fact,
  busy,
  onCancel,
  onSave,
}: {
  fact: CompanyOpenFact;
  busy: boolean;
  onCancel: () => void;
  onSave: (patch: Record<string, unknown>) => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => toEditableForm(fact));
  const inputCls = "w-full rounded-xl border border-ink/12 bg-white px-3 py-2 text-sm focus-ring";

  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-ink">Редагувати дані з відкритої вакансії</h3>
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
          ["vacancy_title", "Назва вакансії"],
          ["city", "Місто"],
          ["salary_text", "Зарплата"],
          ["schedule", "Графік"],
          ["employment_type", "Оформлення"],
          ["experience", "Досвід"],
          ["education", "Освіта"],
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
          <label className="mb-1 block text-xs font-medium text-ink">Статус</label>
          <select
            className={inputCls}
            value={draft.status}
            onChange={(e) => setDraft({ ...draft, status: e.target.value as CompanyOpenFactStatus })}
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

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex items-center gap-2 rounded-xl border border-ink/12 bg-white px-3 py-2 text-sm text-ink-soft">
          <input
            type="checkbox"
            checked={draft.is_public}
            onChange={(e) => setDraft({ ...draft, is_public: e.target.checked })}
          />
          Показувати публічно
        </label>
        <label className="flex items-center gap-2 rounded-xl border border-ink/12 bg-white px-3 py-2 text-sm text-ink-soft">
          <input
            type="checkbox"
            checked={draft.mentions_official_employment}
            onChange={(e) => setDraft({ ...draft, mentions_official_employment: e.target.checked })}
          />
          Згадується офіційне оформлення
        </label>
        <label className="flex items-center gap-2 rounded-xl border border-ink/12 bg-white px-3 py-2 text-sm text-ink-soft">
          <input
            type="checkbox"
            checked={draft.mentions_booking}
            onChange={(e) => setDraft({ ...draft, mentions_booking: e.target.checked })}
          />
          Згадується бронювання
        </label>
        <label className="flex items-center gap-2 rounded-xl border border-ink/12 bg-white px-3 py-2 text-sm text-ink-soft">
          <input
            type="checkbox"
            checked={draft.mentions_bonus}
            onChange={(e) => setDraft({ ...draft, mentions_bonus: e.target.checked })}
          />
          Згадується бонус / KPI
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {[
          ["requirements", "Вимоги"],
          ["responsibilities", "Обовʼязки"],
          ["conditions", "Умови"],
          ["benefits", "Переваги"],
          ["skills", "Навички"],
          ["company_description", "Опис компанії"],
          ["vacancy_description", "Опис вакансії"],
          ["raw_excerpt", "Raw excerpt"],
        ].map(([key, label]) => (
          <div key={key}>
            <label className="mb-1 block text-xs font-medium text-ink">{label}</label>
            <textarea
              className={inputCls}
              rows={key.includes("description") || key === "raw_excerpt" ? 4 : 3}
              value={String(draft[key as keyof typeof draft])}
              onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
            />
          </div>
        ))}
      </div>

      <Button size="sm" disabled={busy} onClick={() => void onSave(formToPatch(draft))}>
        {busy ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Збереження…</> : "Зберегти зміни"}
      </Button>
    </Card>
  );
}

function FactCard({
  fact,
  selected,
  onSelect,
  onUpdate,
  onDelete,
}: {
  fact: CompanyOpenFact;
  selected: boolean;
  onSelect: (checked: boolean) => void;
  onUpdate: (id: string, patch: Record<string, unknown>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const statusMeta = STATUS_META[fact.status];

  async function act(patch: Record<string, unknown>) {
    setBusy(true);
    await onUpdate(fact.id, patch);
    setBusy(false);
  }

  async function save(patch: Record<string, unknown>) {
    setBusy(true);
    await onUpdate(fact.id, patch);
    setEditing(false);
    setBusy(false);
  }

  if (editing) {
    return (
      <FactEditForm
        fact={fact}
        busy={busy}
        onCancel={() => setEditing(false)}
        onSave={save}
      />
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-ink/[0.06] bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => onSelect(!selected)}
            className="mt-1 text-ink-muted hover:text-brand-700"
            aria-label={selected ? "Зняти вибір" : "Вибрати факт"}
          >
            {selected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
          </button>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-ink">{fact.companyName}</span>
              <span className="text-xs text-ink-muted">{fact.companySlug}</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
              <FileText className="h-3.5 w-3.5" />
              <span>{fact.sourceName}</span>
              {fact.sourceUrl && (
                <a href={fact.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-brand-700">
                  Джерело
                </a>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("rounded-md border px-2 py-0.5 text-xs font-medium", statusMeta.color)}>
            {statusMeta.label}
          </span>
          {fact.isPublic && (
            <span className="rounded-md border border-brand-200 bg-brand-50 px-2 py-0.5 text-xs text-brand-700">
              Публічно
            </span>
          )}
        </div>
      </div>

      <div className="grid gap-2 text-sm text-ink-soft sm:grid-cols-3">
        <span><strong className="text-ink">Вакансія:</strong> {fact.vacancyTitle ?? "Не вказана"}</span>
        <span><strong className="text-ink">Місто:</strong> {fact.city ?? "Не вказано"}</span>
        <span><strong className="text-ink">Зарплата:</strong> {fact.salaryText ?? "Не вказана"}</span>
        <span><strong className="text-ink">Графік:</strong> {fact.schedule ?? "Не вказано"}</span>
        <span><strong className="text-ink">Оформлення:</strong> {fact.employmentType ?? "Не вказано"}</span>
        <span><strong className="text-ink">Зібрано:</strong> {formatDate(fact.collectedAt)}</span>
      </div>

      {(fact.conditions.length > 0 || fact.benefits.length > 0 || fact.requirements.length > 0) && (
        <SmallText>
          {[
            fact.conditions.length ? `Умови: ${fact.conditions.slice(0, 2).join("; ")}` : null,
            fact.benefits.length ? `Переваги: ${fact.benefits.slice(0, 2).join("; ")}` : null,
            fact.requirements.length ? `Вимоги: ${fact.requirements.slice(0, 2).join("; ")}` : null,
          ].filter(Boolean).join(" · ")}
        </SmallText>
      )}

      <div className="flex flex-wrap gap-2 border-t border-ink/[0.06] pt-3">
        <Button size="sm" variant="primary" disabled={busy} onClick={() => void act({ status: "verified" })}>
          <CheckCircle2 className="h-3.5 w-3.5" /> Підтвердити
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void act({ status: "needs_verification" })}>
          <RefreshCw className="h-3.5 w-3.5" /> На перевірку
        </Button>
        <Button size="sm" variant="outline" disabled={busy || fact.isPublic || fact.status !== "verified"} onClick={() => void act({ is_public: true })}>
          <Eye className="h-3.5 w-3.5" /> Зробити публічним
        </Button>
        <Button size="sm" variant="outline" disabled={busy || !fact.isPublic} onClick={() => void act({ is_public: false })}>
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
          onClick={() => { if (confirm("Видалити дані з відкритої вакансії?")) void onDelete(fact.id); }}
        >
          <Trash2 className="h-3.5 w-3.5" /> Видалити
        </Button>
        {busy && <Loader2 className="h-4 w-4 animate-spin text-ink-muted" />}
      </div>
    </div>
  );
}

export function AdminCompanyOpenFactsSection({ accessToken }: { accessToken: string }) {
  const [facts, setFacts] = useState<CompanyOpenFact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [pendingBulk, setPendingBulk] = useState<PendingBulkAction | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | CompanyOpenFactStatus>("needs_verification");
  const [publicFilter, setPublicFilter] = useState<"all" | "public" | "private">("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [companyFilter, setCompanyFilter] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/company-open-facts", {
        headers: getAdminHeaders(accessToken),
      });
      if (res.status === 401) { setError("Сесія завершилась — перезавантажте сторінку."); return; }
      if (res.status === 403) { setError("Доступ заборонено."); return; }
      const data = await res.json() as { facts?: CompanyOpenFact[]; error?: string };
      if (data.error) {
        setError(data.error);
        setFacts([]);
      } else {
        setFacts(data.facts ?? []);
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
    return facts.filter((fact) => {
      if (statusFilter !== "all" && fact.status !== statusFilter) return false;
      if (publicFilter === "public" && !fact.isPublic) return false;
      if (publicFilter === "private" && fact.isPublic) return false;
      if (sourceFilter !== "all" && fact.sourceName !== sourceFilter) return false;
      if (
        company &&
        !`${fact.companyName} ${fact.companySlug} ${fact.vacancyTitle ?? ""} ${fact.sourceName}`.toLowerCase().includes(company)
      ) return false;
      return true;
    });
  }, [companyFilter, facts, publicFilter, sourceFilter, statusFilter]);

  const sourceOptions = useMemo(() => {
    return Array.from(new Set(facts.map((fact) => fact.sourceName).filter(Boolean))).sort((a, b) => a.localeCompare(b, "uk"));
  }, [facts]);

  const selectedFacts = useMemo(() => filtered.filter((fact) => selectedIds.has(fact.id)), [filtered, selectedIds]);
  const allVisibleSelected = filtered.length > 0 && filtered.every((fact) => selectedIds.has(fact.id));

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
      for (const fact of filtered) {
        if (allVisibleSelected) next.delete(fact.id);
        else next.add(fact.id);
      }
      return next;
    });
  }

  function selectCurrentFilter() {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const fact of filtered) next.add(fact.id);
      return next;
    });
  }

  async function handleUpdate(id: string, patch: Record<string, unknown>) {
    const res = await fetch(`/api/admin/company-open-facts/${id}`, {
      method: "PATCH",
      headers: getAdminHeaders(accessToken),
      body: JSON.stringify(patch),
    });
    if (res.ok) await load();
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/admin/company-open-facts/${id}`, {
      method: "DELETE",
      headers: getAdminHeaders(accessToken),
    });
    if (res.ok) await load();
  }

  function requestBulkAction(action: OpenFactsBulkAction) {
    setError(null);
    setBulkMessage(null);

    const selected = selectedFacts;
    if (selected.length === 0) {
      setError("Спочатку виберіть записи для bulk-дії.");
      return;
    }

    const publicTargets = action === "make_public"
      ? selected.filter((fact) => fact.status === "verified" && !fact.isPublic)
      : selected;
    const ids = publicTargets.map((fact) => fact.id);

    if (ids.length === 0) {
      setError("Для публікації потрібно вибрати verified записи, які ще не public.");
      return;
    }

    const meta: Record<OpenFactsBulkAction, Omit<PendingBulkAction, "action" | "ids">> = {
      mark_verified: {
        title: "Bulk: Mark as verified",
        fieldLabel: "status",
        changeLabel: "verified",
        confirmLabel: "Mark as verified",
      },
      mark_needs_verification: {
        title: "Bulk: Mark as needs_verification",
        fieldLabel: "status / is_public",
        changeLabel: "needs_verification; is_public=false",
        confirmLabel: "Mark as needs_verification",
      },
      make_public: {
        title: "Bulk: Make public",
        fieldLabel: "is_public",
        changeLabel: "true",
        warning: "Ця дія опублікує вибрані verified факти на публічних сторінках компаній. Це не змінить відгуки або рейтинги.",
        confirmLabel: "Make public",
      },
      make_private: {
        title: "Bulk: Make private",
        fieldLabel: "is_public",
        changeLabel: "false",
        confirmLabel: "Make private",
      },
      reject: {
        title: "Bulk: Archive / reject",
        fieldLabel: "status / is_public",
        changeLabel: "rejected; is_public=false",
        confirmLabel: "Archive / reject",
      },
    };

    setPendingBulk({ action, ids, ...meta[action] });
  }

  async function executeBulkAction() {
    if (!pendingBulk) return;
    setBulkBusy(true);
    setError(null);
    setBulkMessage(null);
    try {
      const res = await fetch("/api/admin/company-open-facts/bulk", {
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display font-bold text-ink">Дані з відкритих вакансій</h2>
          <p className="mt-0.5 text-xs text-ink-muted">
            Окремі факти з Work.ua / Robota.ua. Не додаються до відгуків,
            зовнішніх оцінок або внутрішнього рейтингу.
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            Імпортовані дані залишаються private за замовчуванням. Публікація
            можлива тільки після явної дії адміністратора.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => void load()}>
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <select
          className="rounded-xl border border-ink/12 bg-white px-3 py-2 text-sm focus-ring"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as "all" | CompanyOpenFactStatus)}
        >
          <option value="all">Усі статуси</option>
          <option value="needs_verification">На перевірці</option>
          <option value="verified">Підтверджено</option>
          <option value="rejected">Відхилено</option>
        </select>
        <select
          className="rounded-xl border border-ink/12 bg-white px-3 py-2 text-sm focus-ring"
          value={publicFilter}
          onChange={(e) => setPublicFilter(e.target.value as typeof publicFilter)}
        >
          <option value="all">Публічність: усі</option>
          <option value="public">Тільки public</option>
          <option value="private">Тільки private</option>
        </select>
        <select
          className="rounded-xl border border-ink/12 bg-white px-3 py-2 text-sm focus-ring"
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
        >
          <option value="all">Усі джерела</option>
          {sourceOptions.map((source) => (
            <option key={source} value={source}>{source}</option>
          ))}
        </select>
        <div className="flex items-center gap-2 rounded-xl border border-ink/12 bg-white px-3 py-2">
          <Search className="h-4 w-4 text-ink-muted" />
          <input
            value={companyFilter}
            onChange={(e) => setCompanyFilter(e.target.value)}
            placeholder="Компанія, slug, джерело або вакансія"
            className="bg-transparent text-sm focus:outline-none"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-ink/[0.06] bg-white p-3 shadow-card">
        <label className="flex items-center gap-2 rounded-xl border border-ink/12 bg-white px-3 py-2 text-sm text-ink-soft">
          <input
            type="checkbox"
            checked={allVisibleSelected}
            onChange={toggleAllFiltered}
            disabled={filtered.length === 0}
          />
          Вибрати всі на сторінці
        </label>
        <Button size="sm" variant="outline" onClick={selectCurrentFilter} disabled={filtered.length === 0}>
          {allVisibleSelected ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
          Вибрати всі за фільтром ({filtered.length})
        </Button>
        <span className="rounded-lg bg-ink/[0.04] px-2.5 py-1 text-xs font-medium text-ink-soft">
          Вибрано: {selectedFacts.length}
        </span>
        <Button size="sm" variant="outline" disabled={selectedFacts.length === 0 || bulkBusy} onClick={() => requestBulkAction("mark_verified")}>
          <CheckCircle2 className="h-3.5 w-3.5" /> Bulk verified
        </Button>
        <Button size="sm" variant="outline" disabled={selectedFacts.length === 0 || bulkBusy} onClick={() => requestBulkAction("mark_needs_verification")}>
          <RefreshCw className="h-3.5 w-3.5" /> Bulk needs verification
        </Button>
        <Button size="sm" variant="outline" disabled={selectedFacts.length === 0 || bulkBusy} className="border-amber-300 text-amber-800 hover:bg-amber-50" onClick={() => requestBulkAction("make_public")}>
          <Eye className="h-3.5 w-3.5" /> Bulk public
        </Button>
        <Button size="sm" variant="outline" disabled={selectedFacts.length === 0 || bulkBusy} onClick={() => requestBulkAction("make_private")}>
          <EyeOff className="h-3.5 w-3.5" /> Bulk private
        </Button>
        <Button size="sm" variant="secondary" disabled={selectedFacts.length === 0 || bulkBusy} onClick={() => requestBulkAction("reject")}>
          <XCircle className="h-3.5 w-3.5" /> Bulk reject
        </Button>
        <span className="text-xs text-ink-muted">
          Bulk-дії застосовуються тільки до вибраних записів.
        </span>
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
      {bulkMessage && (
        <div className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-700">
          {bulkMessage}
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <p className="text-sm text-ink-muted">Даних з відкритих вакансій ще немає.</p>
      )}
      {!loading && filtered.map((fact) => (
        <FactCard
          key={fact.id}
          fact={fact}
          selected={selectedIds.has(fact.id)}
          onSelect={(checked) => toggleSelected(fact.id, checked)}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
        />
      ))}

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
