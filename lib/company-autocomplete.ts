// lib/company-autocomplete.ts
// Browser-side company search for the ReviewForm autocomplete.
// Searches by company name (Cyrillic/mixed) AND by slug (via transliteration).
// Falls back to COMPANIES mock data when Supabase is not configured.

import { getBrowserClient, isSupabaseConfigured } from "./supabase/client";
import { COMPANIES } from "./mock-data";
import { slugifyCompanyName } from "./slugify";

export interface CompanySuggestion {
  name: string;
  slug: string;
  city: string | null;
  industry: string | null;
}

/**
 * Searches public.companies by name (ilike) OR slug (ilike transliterated query).
 *
 * Examples of what gets matched:
 *   "нова"    → name ilike "%нова%"         → Нова Пошта
 *   "nova"    → slug ilike "%nova%"          → Нова Пошта
 *   "poshta"  → slug ilike "%poshta%"        → Нова Пошта
 *   "пошта"   → name ilike "%пошта%"         → Нова Пошта
 *   "банк"    → name ilike "%банк%"          → A-Банк, ПриватБанк
 *   "bank"    → slug ilike "%bank%"          → A-Банк, ПриватБанк
 *   "a-bank"  → slug ilike "%a-bank%"        → A-Банк
 *   "нова кава" → no matching rows            → [] (correct — not in base)
 *
 * Returns [] on any error so the form degrades gracefully.
 */
export async function searchCompanySuggestions(
  query: string
): Promise<CompanySuggestion[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  // Transliterate the query to build a slug-search term.
  // e.g. "нова" → "nova", "poshta" stays "poshta", "банк" → "bank"
  const slugQuery = slugifyCompanyName(q);

  // ── Supabase path ──────────────────────────────────────────────────────────
  if (isSupabaseConfigured()) {
    try {
      const client = getBrowserClient();

      // Run name-search and slug-search in parallel, then merge + deduplicate.
      const [byName, bySlug] = await Promise.all([
        client
          .from("companies")
          .select("name, slug, city, industry")
          .ilike("name", `%${q}%`)
          .order("name")
          .limit(10),
        client
          .from("companies")
          .select("name, slug, city, industry")
          .ilike("slug", `%${slugQuery}%`)
          .order("name")
          .limit(10),
      ]);

      const rows: CompanySuggestion[] = [];
      const seen = new Set<string>();

      for (const r of [...(byName.data ?? []), ...(bySlug.data ?? [])]) {
        const item = r as CompanySuggestion;
        if (!seen.has(item.slug)) {
          seen.add(item.slug);
          rows.push(item);
        }
      }

      if (rows.length > 0) {
        return rows.slice(0, 10);
      }
      // Fall through to mock on empty/error
    } catch {
      // Network error — fall through to mock
    }
  }

  // ── Mock fallback (used when Supabase is not configured) ───────────────────
  const qLower = q.toLowerCase();
  const seen = new Set<string>();
  const results: CompanySuggestion[] = [];

  for (const c of COMPANIES) {
    if (results.length >= 10) break;
    if (seen.has(c.slug)) continue;

    const nameMatch = c.name.toLowerCase().includes(qLower);
    const slugMatch =
      c.slug.toLowerCase().includes(slugQuery) ||
      slugifyCompanyName(c.name).includes(slugQuery);

    if (nameMatch || slugMatch) {
      seen.add(c.slug);
      results.push({ name: c.name, slug: c.slug, city: c.city, industry: c.industry });
    }
  }

  return results;
}
