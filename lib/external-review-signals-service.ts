// Server helpers for public.external_review_signals.
// These are admin-verified summaries of external reviews, not internal reviews
// and not numeric external ratings.

import { getServerClient, getServiceClient } from "./supabase/server";
import type {
  ExternalReviewSignal,
  ExternalReviewSignalConfidence,
  ExternalReviewSignalSentiment,
  ExternalReviewSignalStatus,
  ExternalReviewSignalTopic,
} from "./types";

type ExternalReviewSignalRow = Record<string, unknown>;

export const EXTERNAL_REVIEW_SIGNAL_TOPICS: ExternalReviewSignalTopic[] = [
  "salary",
  "schedule",
  "employment",
  "management",
  "workload",
  "payment_delay",
  "interview",
  "booking",
  "benefits",
  "career",
  "culture",
  "other",
];

export const EXTERNAL_REVIEW_SIGNAL_SENTIMENTS: ExternalReviewSignalSentiment[] = [
  "positive",
  "mixed",
  "negative",
  "neutral",
];

export const EXTERNAL_REVIEW_SIGNAL_CONFIDENCES: ExternalReviewSignalConfidence[] = [
  "low",
  "medium",
  "high",
];

export const EXTERNAL_REVIEW_SIGNAL_STATUSES: ExternalReviewSignalStatus[] = [
  "needs_verification",
  "verified",
  "rejected",
];

export const TOPIC_LABELS: Record<ExternalReviewSignalTopic, string> = {
  salary: "Зарплата",
  schedule: "Графік",
  employment: "Оформлення",
  management: "Керівництво",
  workload: "Навантаження",
  payment_delay: "Затримки виплат",
  interview: "Співбесіда",
  booking: "Бронювання",
  benefits: "Бонуси / переваги",
  career: "Карʼєра",
  culture: "Культура",
  other: "Інше",
};

export const SENTIMENT_LABELS: Record<ExternalReviewSignalSentiment, string> = {
  positive: "позитивно",
  mixed: "змішано",
  negative: "негативно",
  neutral: "нейтрально",
};

export interface ExternalReviewTopSignal {
  topic: ExternalReviewSignalTopic;
  sentiment: ExternalReviewSignalSentiment;
  summary: string;
  sourceName: string;
  mentionsCount: number;
}

export interface ExternalReviewSignalSummary {
  companySlug: string;
  signalCount: number;
  sourceCount: number;
  sources: string[];
  topics: ExternalReviewSignalTopic[];
  positiveCount: number;
  mixedCount: number;
  negativeCount: number;
  neutralCount: number;
  topSignals: ExternalReviewTopSignal[];
}

export type ExternalReviewSignalSummaryBySlug = Record<string, ExternalReviewSignalSummary>;

const SELECT_COLUMNS = [
  "id",
  "company_slug",
  "company_name",
  "source_name",
  "source_url",
  "topic",
  "sentiment",
  "summary",
  "mentions_count",
  "sample_size",
  "confidence",
  "collected_at",
  "status",
  "is_public",
  "admin_note",
  "created_at",
  "updated_at",
].join(", ");

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toTopic(value: unknown): ExternalReviewSignalTopic {
  return EXTERNAL_REVIEW_SIGNAL_TOPICS.includes(value as ExternalReviewSignalTopic)
    ? value as ExternalReviewSignalTopic
    : "other";
}

function toSentiment(value: unknown): ExternalReviewSignalSentiment {
  return EXTERNAL_REVIEW_SIGNAL_SENTIMENTS.includes(value as ExternalReviewSignalSentiment)
    ? value as ExternalReviewSignalSentiment
    : "neutral";
}

function toConfidence(value: unknown): ExternalReviewSignalConfidence {
  return EXTERNAL_REVIEW_SIGNAL_CONFIDENCES.includes(value as ExternalReviewSignalConfidence)
    ? value as ExternalReviewSignalConfidence
    : "medium";
}

function toStatus(value: unknown): ExternalReviewSignalStatus {
  return EXTERNAL_REVIEW_SIGNAL_STATUSES.includes(value as ExternalReviewSignalStatus)
    ? value as ExternalReviewSignalStatus
    : "needs_verification";
}

function uniqueLimited<T extends string>(items: Array<T | null | undefined>, limit: number): T[] {
  const result: T[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const value = item?.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value as T);
    if (result.length >= limit) break;
  }
  return result;
}

function isMissingTableError(error: { code?: string; message?: string } | null): boolean {
  return error?.code === "42P01" || /external_review_signals/i.test(error?.message ?? "");
}

export function rowToExternalReviewSignal(row: ExternalReviewSignalRow): ExternalReviewSignal {
  return {
    id: String(row.id),
    companySlug: String(row.company_slug),
    companyName: String(row.company_name),
    sourceName: String(row.source_name),
    sourceUrl: textOrNull(row.source_url),
    topic: toTopic(row.topic),
    sentiment: toSentiment(row.sentiment),
    summary: String(row.summary ?? "").trim(),
    mentionsCount: Math.max(0, Math.trunc(toNumber(row.mentions_count) ?? 1)),
    sampleSize: toNumber(row.sample_size),
    confidence: toConfidence(row.confidence),
    collectedAt: textOrNull(row.collected_at),
    status: toStatus(row.status),
    isPublic: Boolean(row.is_public),
    adminNote: textOrNull(row.admin_note),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function emptySummary(companySlug: string): ExternalReviewSignalSummary {
  return {
    companySlug,
    signalCount: 0,
    sourceCount: 0,
    sources: [],
    topics: [],
    positiveCount: 0,
    mixedCount: 0,
    negativeCount: 0,
    neutralCount: 0,
    topSignals: [],
  };
}

function confidenceRank(value: ExternalReviewSignalConfidence): number {
  if (value === "high") return 3;
  if (value === "medium") return 2;
  return 1;
}

function sentimentRank(value: ExternalReviewSignalSentiment): number {
  if (value === "negative") return 4;
  if (value === "mixed") return 3;
  if (value === "positive") return 2;
  return 1;
}

export function buildExternalReviewSignalSummary(
  companySlug: string,
  signals: ExternalReviewSignal[]
): ExternalReviewSignalSummary {
  if (signals.length === 0) return emptySummary(companySlug);

  const bestByTopic = new Map<ExternalReviewSignalTopic, ExternalReviewSignal>();
  for (const signal of signals) {
    const current = bestByTopic.get(signal.topic);
    if (!current) {
      bestByTopic.set(signal.topic, signal);
      continue;
    }
    const currentScore =
      current.mentionsCount * 100 +
      confidenceRank(current.confidence) * 10 +
      sentimentRank(current.sentiment);
    const nextScore =
      signal.mentionsCount * 100 +
      confidenceRank(signal.confidence) * 10 +
      sentimentRank(signal.sentiment);
    if (nextScore > currentScore) bestByTopic.set(signal.topic, signal);
  }

  const topSignals = Array.from(bestByTopic.values())
    .sort((a, b) => {
      if (b.mentionsCount !== a.mentionsCount) return b.mentionsCount - a.mentionsCount;
      return confidenceRank(b.confidence) - confidenceRank(a.confidence);
    })
    .slice(0, 5)
    .map((signal) => ({
      topic: signal.topic,
      sentiment: signal.sentiment,
      summary: signal.summary,
      sourceName: signal.sourceName,
      mentionsCount: signal.mentionsCount,
    }));

  return {
    companySlug,
    signalCount: signals.length,
    sourceCount: new Set(signals.map((signal) => signal.sourceName)).size,
    sources: uniqueLimited(signals.map((signal) => signal.sourceName), 5),
    topics: uniqueLimited(signals.map((signal) => signal.topic), 5),
    positiveCount: signals.filter((signal) => signal.sentiment === "positive").length,
    mixedCount: signals.filter((signal) => signal.sentiment === "mixed").length,
    negativeCount: signals.filter((signal) => signal.sentiment === "negative").length,
    neutralCount: signals.filter((signal) => signal.sentiment === "neutral").length,
    topSignals,
  };
}

export async function getPublicExternalReviewSignals(
  companySlug: string
): Promise<ExternalReviewSignal[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!url || !key) return [];

  try {
    const client = getServerClient();
    const { data, error } = await client
      .from("external_review_signals")
      .select(SELECT_COLUMNS)
      .eq("company_slug", companySlug)
      .eq("status", "verified")
      .eq("is_public", true)
      .order("mentions_count", { ascending: false, nullsFirst: false })
      .order("collected_at", { ascending: false, nullsFirst: false });

    if (error || !data) return [];
    return data.map((row) => rowToExternalReviewSignal(row as unknown as ExternalReviewSignalRow));
  } catch {
    return [];
  }
}

export async function getPublicExternalReviewSignalSummary(
  companySlug: string
): Promise<ExternalReviewSignalSummary> {
  const signals = await getPublicExternalReviewSignals(companySlug);
  return buildExternalReviewSignalSummary(companySlug, signals);
}

export async function getPublicExternalReviewSignalSummariesForCompanies(): Promise<ExternalReviewSignalSummaryBySlug> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!url || !key) return {};

  try {
    const client = getServerClient();
    const { data, error } = await client
      .from("external_review_signals")
      .select(SELECT_COLUMNS)
      .eq("status", "verified")
      .eq("is_public", true);

    if (error || !data) return {};

    const grouped: Record<string, ExternalReviewSignal[]> = {};
    for (const row of data as unknown as ExternalReviewSignalRow[]) {
      const signal = rowToExternalReviewSignal(row);
      if (!grouped[signal.companySlug]) grouped[signal.companySlug] = [];
      grouped[signal.companySlug].push(signal);
    }

    const result: ExternalReviewSignalSummaryBySlug = {};
    for (const [companySlug, signals] of Object.entries(grouped)) {
      result[companySlug] = buildExternalReviewSignalSummary(companySlug, signals);
    }
    return result;
  } catch {
    return {};
  }
}

export async function getAdminExternalReviewSignals(): Promise<ExternalReviewSignal[]> {
  try {
    const client = getServiceClient();
    const { data, error } = await client
      .from("external_review_signals")
      .select(SELECT_COLUMNS)
      .order("created_at", { ascending: false })
      .limit(300);

    if (error || !data) return [];
    return data.map((row) => rowToExternalReviewSignal(row as unknown as ExternalReviewSignalRow));
  } catch {
    return [];
  }
}

export function externalReviewSignalsTableMissing(error: { code?: string; message?: string } | null): boolean {
  return isMissingTableError(error);
}
