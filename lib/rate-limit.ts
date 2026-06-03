// lib/rate-limit.ts
// Simple in-memory rate limiter for the review submit endpoint.
// Resets between server restarts (fine for MVP/dev).
// For production, replace with Redis or Upstash.

interface RateLimitEntry {
  count: number;
  resetAt: number; // epoch ms
}

const store = new Map<string, RateLimitEntry>();

const WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const MAX_REQUESTS = 5;            // max reviews per window

/** Cleans up expired entries to prevent unbounded growth. */
function cleanup() {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.resetAt < now) store.delete(key);
  }
}

/**
 * Checks the rate limit for a given key (typically the client IP).
 * Returns `{ allowed: true }` or `{ allowed: false, retryAfterSeconds }`.
 */
export function checkRateLimit(key: string): { allowed: boolean; retryAfterSeconds?: number } {
  cleanup();
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || entry.resetAt < now) {
    store.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true };
  }

  if (entry.count >= MAX_REQUESTS) {
    const retryAfterSeconds = Math.ceil((entry.resetAt - now) / 1000);
    return { allowed: false, retryAfterSeconds };
  }

  entry.count += 1;
  return { allowed: true };
}

/**
 * Extracts the best available client IP from a Next.js request.
 * Falls back to a fixed key in environments without real IP headers.
 */
export function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}
