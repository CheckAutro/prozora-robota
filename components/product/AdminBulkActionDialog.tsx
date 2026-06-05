"use client";

import { AlertTriangle, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";

export interface AdminBulkActionDialogProps {
  open: boolean;
  title: string;
  count: number;
  fieldLabel: string;
  changeLabel: string;
  warning?: string;
  confirmLabel?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function AdminBulkActionDialog({
  open,
  title,
  count,
  fieldLabel,
  changeLabel,
  warning,
  confirmLabel = "Підтвердити",
  busy = false,
  onCancel,
  onConfirm,
}: AdminBulkActionDialogProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/45 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-ink/[0.08] bg-white p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-display text-lg font-bold text-ink">{title}</h3>
            <p className="mt-1 text-sm text-ink-soft">
              Буде змінено / оброблено записів: <strong className="text-ink">{count}</strong>
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg p-1 text-ink-muted hover:bg-ink/[0.04] hover:text-ink"
            aria-label="Закрити"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 rounded-xl bg-ink/[0.03] px-4 py-3 text-sm text-ink-soft">
          <p><strong className="text-ink">Поле:</strong> {fieldLabel}</p>
          <p className="mt-1"><strong className="text-ink">Зміна:</strong> {changeLabel}</p>
        </div>

        {warning && (
          <div className="mt-3 flex gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{warning}</p>
          </div>
        )}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
            Скасувати
          </Button>
          <Button type="button" variant={warning ? "secondary" : "primary"} onClick={onConfirm} disabled={busy}>
            {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Виконання…</> : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
