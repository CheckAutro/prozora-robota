// lib/industry.ts
// Canonical industry names and normalization logic.
// Used when importing companies and when displaying/filtering by industry.

export const CANONICAL_INDUSTRIES = [
  "Логістика",
  "Банки і фінанси",
  "Ритейл",
  "IT",
  "Telecom",
  "Виробництво",
  "Металургія",
  "Агро",
  "FMCG",
  "Фармацевтика",
  "Медицина",
  "Освіта",
  "HoReCa",
  "Будівництво",
  "Енергетика",
  "Державний сектор",
  "Нерухомість",
  "Авто",
  "Страхування",
  "Media",
  "E-commerce",
  "Безпека",
  "Побутові послуги",
  "Консалтинг",
  "Юридичні послуги",
] as const;

const NORMALIZATION_MAP: Record<string, string> = {
  // Logistics
  "логістика і доставка": "Логістика",
  "логістика та доставка": "Логістика",
  "поштові послуги": "Логістика",
  "кур'єрська служба": "Логістика",
  // Retail
  "роздрібна торгівля": "Ритейл",
  "роздрібна торгівля (краса і здоров'я)": "Фармацевтика",
  "аптека": "Фармацевтика",
  "аптеки": "Фармацевтика",
  "азс і авто": "Авто",
  "ресторани і фастфуд": "HoReCa",
  "охорона": "Безпека",
  "послуги": "Побутові послуги",
  "будівництво і нерухомість": "Нерухомість",
  // E-commerce
  "e-commerce та роздріб": "E-commerce",
  "роздріб електроніки": "E-commerce",
  "інтернет-торгівля": "E-commerce",
  // Telecom
  "телеком": "Telecom",
  // Finance
  "банк": "Банки і фінанси",
  "банки": "Банки і фінанси",
  "фінанси": "Банки і фінанси",
  "банківська сфера": "Банки і фінанси",
};

/**
 * Returns the canonical industry name for a given raw value.
 * If no mapping exists, returns the original value trimmed.
 */
export function normalizeIndustry(raw: string | null | undefined): string {
  if (!raw) return "";
  const key = raw.trim().toLowerCase();
  return NORMALIZATION_MAP[key] ?? raw.trim();
}
