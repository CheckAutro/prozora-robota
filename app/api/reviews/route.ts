// app/api/reviews/route.ts
// POST /api/reviews — public review submission endpoint.
//
// Server-side checks (in order):
//   1. Honeypot field: if "website" is filled, silently succeed (don't save).
//   2. Rate limit: max 5 submissions per 10 min per IP.
//   3. PII / contact data check in the text field.
//   4. Field length limits (mirrors review-schema.ts).
//   5. Insert into public.reviews with status = 'pending' via anon key (RLS enforced).

import { NextRequest, NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase/server";
import { containsPersonalContacts, isLowQualityText } from "@/lib/detect-risks";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import type { Review } from "@/lib/types";
import { toRow } from "@/lib/storage";

// ── Field limits (keep in sync with review-schema.ts) ────────────────────────
const LIMITS = {
  company:      120,
  city:         80,
  roleCategory: 120,
  text_min:     20,
  text_max:     3000,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fieldTooLong(value: unknown, max: number): boolean {
  return typeof value === "string" && value.length > max;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // 1. Honeypot: if the hidden "website" field is filled, this is likely a bot.
  //    Return 200 so bots think they succeeded.
  const honeypot = body["website"];
  if (typeof honeypot === "string" && honeypot.trim().length > 0) {
    console.info("[reviews POST] honeypot triggered");
    return NextResponse.json({ ok: true });
  }

  // 2. Rate limit by client IP
  const ip = getClientIp(req);
  const rl = checkRateLimit(`review:${ip}`);
  if (!rl.allowed) {
    return NextResponse.json(
      {
        error: `Занадто багато відгуків. Спробуйте через ${rl.retryAfterSeconds} секунд.`,
      },
      { status: 429 }
    );
  }

  // 3. PII check in text
  const rawText = typeof body.text === "string" ? body.text : "";
  if (containsPersonalContacts(rawText)) {
    return NextResponse.json(
      {
        error:
          "Не вказуйте у відгуку телефони, email, Telegram, Instagram або інші персональні дані. " +
          "Ми не публікуємо персональні дані.",
      },
      { status: 422 }
    );
  }

  // 3b. Quality check — block spam / test submissions
  if (isLowQualityText(rawText)) {
    return NextResponse.json(
      { error: "Напишіть змістовний відгук про досвід роботи або співбесіди." },
      { status: 422 }
    );
  }

  // 4. Length limits
  if (fieldTooLong(body.company, LIMITS.company)) {
    return NextResponse.json({ error: "Назва компанії занадто довга." }, { status: 422 });
  }
  if (fieldTooLong(body.city, LIMITS.city)) {
    return NextResponse.json({ error: "Назва міста занадто довга." }, { status: 422 });
  }
  if (fieldTooLong(body.roleCategory, LIMITS.roleCategory)) {
    return NextResponse.json({ error: "Назва посади занадто довга." }, { status: 422 });
  }
  if (rawText.length < LIMITS.text_min) {
    return NextResponse.json(
      { error: `Коментар занадто короткий (мінімум ${LIMITS.text_min} символів).` },
      { status: 422 }
    );
  }
  if (rawText.length > LIMITS.text_max) {
    return NextResponse.json(
      { error: `Коментар занадто довгий (максимум ${LIMITS.text_max} символів).` },
      { status: 422 }
    );
  }

  // 5. Insert via anon client (RLS enforces status='pending', verified=false, badges={})
  try {
    const review = body as unknown as Review;
    const row = toRow({ ...review, status: "pending" });

    const client = getServerClient();
    const { error } = await client.from("reviews").insert(row as never);

    if (error) {
      console.error("[reviews POST] insert error:", error.message);
      // Return a generic message; don't expose DB details
      return NextResponse.json(
        { error: "Не вдалося зберегти відгук. Спробуйте ще раз." },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[reviews POST] exception:", msg);
    return NextResponse.json({ error: "Помилка сервера." }, { status: 500 });
  }
}
