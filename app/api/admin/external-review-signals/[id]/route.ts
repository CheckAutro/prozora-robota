// app/api/admin/external-review-signals/[id]/route.ts
// PATCH /api/admin/external-review-signals/[id]
// DELETE /api/admin/external-review-signals/[id]

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth-server";
import {
  EXTERNAL_REVIEW_SIGNAL_CONFIDENCES,
  EXTERNAL_REVIEW_SIGNAL_SENTIMENTS,
  EXTERNAL_REVIEW_SIGNAL_STATUSES,
  EXTERNAL_REVIEW_SIGNAL_TOPICS,
} from "@/lib/external-review-signals-service";
import type {
  ExternalReviewSignalConfidence,
  ExternalReviewSignalSentiment,
  ExternalReviewSignalStatus,
  ExternalReviewSignalTopic,
} from "@/lib/types";

async function checkAdminAuth(
  req: NextRequest
): Promise<{ ok: true } | { ok: false; status: 401 | 403; error: string }> {
  const result = await requireAdmin(req);
  if (result.ok) return { ok: true };
  if (result.status === 403) return result;

  const adminKey = process.env.ADMIN_ACCESS_KEY;
  if (adminKey && req.headers.get("x-admin-key") === adminKey) {
    return { ok: true };
  }

  return result;
}

function isValidUrl(value: string): boolean {
  try { new URL(value); return true; } catch { return false; }
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return String(value).trim() || null;
}

function nullableDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function nullableInteger(value: unknown, fallback: number | null): number | null {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.trunc(parsed));
}

function validateSummary(summary: string): NextResponse | null {
  if (summary.length < 20 || summary.length > 300) {
    return NextResponse.json(
      { error: "summary must be 20-300 characters and must be a short summary, not a copied review" },
      { status: 422 }
    );
  }
  return null;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await checkAdminAuth(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const update: Record<string, unknown> = {};

  for (const field of ["company_slug", "company_name", "source_name", "summary"]) {
    if (field in body) {
      const value = String(body[field] ?? "").trim();
      if (!value) return NextResponse.json({ error: `${field} is required` }, { status: 422 });
      if (field === "summary") {
        const summaryError = validateSummary(value);
        if (summaryError) return summaryError;
      }
      update[field] = value;
    }
  }

  if ("source_url" in body) {
    const sourceUrl = nullableString(body.source_url);
    if (sourceUrl && !isValidUrl(sourceUrl)) {
      return NextResponse.json({ error: "source_url must be a valid URL" }, { status: 422 });
    }
    update.source_url = sourceUrl;
  }

  if ("topic" in body) {
    if (!EXTERNAL_REVIEW_SIGNAL_TOPICS.includes(body.topic as ExternalReviewSignalTopic)) {
      return NextResponse.json({ error: "Invalid topic" }, { status: 422 });
    }
    update.topic = body.topic;
  }

  if ("sentiment" in body) {
    if (!EXTERNAL_REVIEW_SIGNAL_SENTIMENTS.includes(body.sentiment as ExternalReviewSignalSentiment)) {
      return NextResponse.json({ error: "Invalid sentiment" }, { status: 422 });
    }
    update.sentiment = body.sentiment;
  }

  if ("confidence" in body) {
    if (!EXTERNAL_REVIEW_SIGNAL_CONFIDENCES.includes(body.confidence as ExternalReviewSignalConfidence)) {
      return NextResponse.json({ error: "Invalid confidence" }, { status: 422 });
    }
    update.confidence = body.confidence;
  }

  if ("mentions_count" in body) {
    update.mentions_count = nullableInteger(body.mentions_count, 1) ?? 1;
  }
  if ("sample_size" in body) {
    update.sample_size = nullableInteger(body.sample_size, null);
  }
  if ("collected_at" in body) {
    update.collected_at = nullableDate(body.collected_at);
  }
  if ("admin_note" in body) {
    update.admin_note = nullableString(body.admin_note);
  }

  if ("status" in body) {
    if (!EXTERNAL_REVIEW_SIGNAL_STATUSES.includes(body.status as ExternalReviewSignalStatus)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 422 });
    }
    update.status = body.status;
    if (body.status !== "verified") update.is_public = false;
  }

  if ("is_public" in body) update.is_public = Boolean(body.is_public);

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  try {
    const client = getServiceClient();

    if (update.is_public === true && "status" in update && update.status !== "verified") {
      return NextResponse.json(
        { error: "is_public=true is allowed only for verified external review signals" },
        { status: 422 }
      );
    }

    if (update.is_public === true) {
      const { data: current, error: currentError } = await client
        .from("external_review_signals")
        .select("status, source_url")
        .eq("id", id)
        .single();

      if (currentError || !current) {
        return NextResponse.json({ error: "External review signal not found" }, { status: 404 });
      }

      const currentRow = current as { status?: string; source_url?: string | null };
      const effectiveStatus = String(update.status ?? currentRow.status ?? "");
      const effectiveUrl = String(update.source_url ?? currentRow.source_url ?? "").trim();
      if (effectiveStatus !== "verified") {
        return NextResponse.json(
          { error: "is_public=true is allowed only for verified external review signals" },
          { status: 422 }
        );
      }
      if (!effectiveUrl) {
        return NextResponse.json(
          { error: "source_url is required before publishing external review signals" },
          { status: 422 }
        );
      }
    }

    const { error } = await client
      .from("external_review_signals")
      .update(update)
      .eq("id", id);

    if (error) {
      console.error("[external-review-signals PATCH]", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, id });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await checkAdminAuth(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  try {
    const client = getServiceClient();
    const { error } = await client
      .from("external_review_signals")
      .delete()
      .eq("id", id);

    if (error) {
      console.error("[external-review-signals DELETE]", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, deleted: id });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
