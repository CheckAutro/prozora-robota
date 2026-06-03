// lib/slugify.ts
// Transliterates Ukrainian and Russian company names to Latin slugs.
// Used when a company is not found in public.companies and we need to
// generate a fallback slug from a free-typed name.

const UA_MAP: Record<string, string> = {
  а: "a",  б: "b",  в: "v",  г: "h",  ґ: "g",
  д: "d",  е: "e",  є: "ie", ж: "zh", з: "z",
  и: "y",  і: "i",  ї: "i",  й: "i",  к: "k",
  л: "l",  м: "m",  н: "n",  о: "o",  п: "p",
  р: "r",  с: "s",  т: "t",  у: "u",  ф: "f",
  х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch",
  ь: "",   ю: "iu", я: "ia",
  // Russian-only letters (fallback, not in Ukrainian alphabet)
  ё: "io", э: "e",  ъ: "",   ы: "y",
};

/**
 * Converts a company name to a URL-safe Latin slug.
 *
 * Examples:
 *   "A-Банк"      → "a-bank"
 *   "Нова Пошта"  → "nova-poshta"
 *   "Сільпо"      → "silpo"
 *   "Київстар"    → "kyivstar"
 *   "Укрпошта"    → "ukrposhta"
 *   "Епіцентр"    → "epicentr"
 *   "Фора"        → "fora"
 */
export function slugifyCompanyName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    // Transliterate each Cyrillic character
    .split("")
    .map((ch) => UA_MAP[ch] ?? ch)
    .join("")
    // Remove apostrophes, quotes and dots instead of turning them into
    // separate slug tokens.
    .replace(/[ʼ'`’"“”«»]/g, "")
    .replace(/\./g, "")
    // Replace any non-alphanumeric run with a single dash
    .replace(/[^a-z0-9]+/g, "-")
    // Collapse repeated dashes
    .replace(/-+/g, "-")
    // Strip leading/trailing dashes
    .replace(/^-+|-+$/g, "");
}
