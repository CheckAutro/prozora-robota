// app/api/admin/external-review-signals/route.ts
// GET  /api/admin/external-review-signals
// POST /api/admin/external-review-signals
// External review signals are NEVER inserted into public.reviews or external_ratings.

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth-server";
import {
  EXTERNAL_REVIEW_SIGNAL_CONFIDENCES,
  EXTERNAL_REVIEW_SIGNAL_SENTIMENTS,
  EXTERNAL_REVIEW_SIGNAL_STATUSES,
  EXTERNAL_REVIEW_SIGNAL_TOPICS,
  getAdminExternalReviewSignals,
  rowToExternalReviewSignal,
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

function optionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function requiredString(value: unknown, field: string): string | NextResponse {
  if (typeof value !== "string" || !value.trim()) {
    return NextResponse.json({ error: `${field} is required` }, { status: 422 });
  }
  return value.trim();
}

function optionalDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function optionalInteger(value: unknown, fallback: number | null): number | null {
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

export async function GET(req: NextRequest) {
  const auth = await checkAdminAuth(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const signals = await getAdminExternalReviewSignals();
  return NextResponse.json({ signals });
}

export async function POST(req: NextRequest) {
  const auth = await checkAdminAuth(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const companySlug = requiredString(body.company_slug, "company_slug");
  if (companySlug instanceof NextResponse) return companySlug;
  const companyName = requiredString(body.company_name, "company_name");
  if (companyName instanceof NextResponse) return companyName;
  const sourceName = requiredString(body.source_name, "source_name");
  if (sourceName instanceof NextResponse) return sourceName;
  const summary = requiredString(body.summary, "summary");
  if (summary instanceof NextResponse) return summary;

  const summaryError = validateSummary(summary);
  if (summaryError) return summaryError;

  const sourceUrl = optionalString(body.source_url);
  if (sourceUrl && !isValidUrl(sourceUrl)) {
    return NextResponse.json({ error: "source_url must be a valid URL" }, { status: 422 });
  }

  const topic = EXTERNAL_REVIEW_SIGNAL_TOPICS.includes(body.topic as ExternalReviewSignalTopic)
    ? body.topic as ExternalReviewSignalTopic
    : "other";
  const sentiment = EXTERNAL_REVIEW_SIGNAL_SENTIMENTS.includes(body.sentiment as ExternalReviewSignalSentiment)
    ? body.sentiment as ExternalReviewSignalSentiment
    : "neutral";
  const confidence = EXTERNAL_REVIEW_SIGNAL_CONFIDENCES.includes(body.confidence as ExternalReviewSignalConfidence)
    ? body.confidence as ExternalReviewSignalConfidence
    : "medium";
  const status = EXTERNAL_REVIEW_SIGNAL_STATUSES.includes(body.status as ExternalReviewSignalStatus)
    ? body.status as ExternalReviewSignalStatus
    : "needs_verification";
  const isPublic = Boolean(body.is_public);

  if (isPublic && status !== "verified") {
    return NextResponse.json(
      { error: "is_public=true is allowed only for verified external review signals" },
      { status: 422 }
    );
  }
  if (isPublic && !sourceUrl) {
    return NextResponse.json(
      { error: "source_url is required before publishing external review signals" },
      { status: 422 }
    );
  }

  try {
    const client = getServiceClient();
    const { data, error } = await client
      .from("external_review_signals")
      .insert({
        company_slug: companySlug,
        company_name: companyName,
        source_name: sourceName,
        source_url: sourceUrl,
        topic,
        sentiment,
        summary,
        mentions_count: optionalInteger(body.mentions_count, 1) ?? 1,
        sample_size: optionalInteger(body.sample_size, null),
        confidence,
        collected_at: optionalDate(body.collected_at),
        status,
        is_public: isPublic,
        admin_note: optionalString(body.admin_note),
      })
      .select("*")
      .single();

    if (error) {
      console.error("[external-review-signals POST]", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, signal: rowToExternalReviewSignal(data) });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
