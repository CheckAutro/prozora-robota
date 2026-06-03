// Heuristic risk detector for review text.
// Flags personal data, contact handles and disallowed wording so the form can
// block submission and the moderator can review. Returns UA-language labels.

export interface DetectedRisk {
  code: string;
  label: string;
}

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
// UA-style and generic phone numbers: +380..., 0XX XXX XX XX, etc.
const PHONE_RE = /(\+?3?8?0\d{8,9})|(\b0\d{2}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}\b)|(\+\d{10,13})/;
const TELEGRAM_RE = /(@[a-zA-Z0-9_]{4,})|(t\.me\/)|(телеграм|telegram)/i;
const INSTAGRAM_RE = /(instagram|інстаграм|инстаграм|insta\b|ig:|instagram\.com\/)/i;
const VIBER_RE = /(viber|вайбер)/i;
const WHATSAPP_RE = /(whatsapp|whats app|ватсап|вотсап|wa\.me\/)/i;
// Generic URLs / links
const URL_RE = /https?:\/\/[^\s]{4,}|www\.[a-zA-Z0-9-]+\.[a-zA-Z]{2,}/i;

// Disallowed accusatory wording (RU/UA). Using neutral phrasing is required.
const ABUSE_WORDS = [
  "мошенник",
  "мошенники",
  "шахрай",
  "шахраї",
  "вор",
  "воры",
  "злодій",
  "злодії",
  "кидалы",
  "кидала",
  "кидают",
  "кидають",
  "преступник",
  "злочинець",
  "обман",
  "лохотрон",
];

// A crude "Full name" heuristic: two capitalised Cyrillic words in a row.
const FULLNAME_RE = /\b[А-ЯЇІЄҐ][а-яїієґ']+\s+[А-ЯЇІЄҐ][а-яїієґ']+(?:\s+[А-ЯЇІЄҐ][а-яїієґ']+)?\b/g;

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

// Returns the set of distinct word tokens of the company name, so we can avoid
// flagging the company name itself as a person's full name.
function companyTokens(companyName?: string): Set<string> {
  if (!companyName) return new Set();
  return new Set(
    normalize(companyName)
      .split(/[^a-zа-яіїєґ0-9]+/i)
      .filter(Boolean)
  );
}

// Detects messenger/contact handles in free text.
function detectContacts(text: string): DetectedRisk[] {
  const risks: DetectedRisk[] = [];
  const cleaned = text.replace(/[()]/g, "");
  if (EMAIL_RE.test(text)) {
    risks.push({ code: "email", label: "Можливий email у тексті" });
  }
  if (PHONE_RE.test(cleaned)) {
    risks.push({ code: "phone", label: "Можливий номер телефону" });
  }
  if (TELEGRAM_RE.test(text)) {
    risks.push({ code: "telegram", label: "Можливе посилання на Telegram / нік" });
  }
  if (INSTAGRAM_RE.test(text)) {
    risks.push({ code: "instagram", label: "Можливе посилання на Instagram" });
  }
  if (VIBER_RE.test(text)) {
    risks.push({ code: "viber", label: "Можливе посилання на Viber" });
  }
  if (WHATSAPP_RE.test(text)) {
    risks.push({ code: "whatsapp", label: "Можливе посилання на WhatsApp" });
  }
  if (URL_RE.test(text)) {
    risks.push({ code: "url", label: "Посилання у тексті — не вказуйте зовнішні URL" });
  }
  return risks;
}

export function detectReviewRisks(text: string, companyName?: string): DetectedRisk[] {
  const risks: DetectedRisk[] = [];
  if (!text) return risks;

  const lower = normalize(text);

  // Personal contacts / messengers
  risks.push(...detectContacts(text));

  // Accusatory wording
  const foundAbuse = ABUSE_WORDS.find((w) => lower.includes(w));
  if (foundAbuse) {
    risks.push({
      code: "abuse",
      label: "Звинувачувальні формулювання — потребує переформулювання",
    });
  }

  // Full-name heuristic, but skip matches that are just the company name.
  const tokens = companyTokens(companyName);
  const matches = text.match(FULLNAME_RE) ?? [];
  const hasRealName = matches.some((m) => {
    const words = normalize(m).split(/\s+/).filter(Boolean);
    // If every word of the match belongs to the company name, it's not a person.
    return !words.every((w) => tokens.has(w));
  });
  if (hasRealName) {
    risks.push({
      code: "fullname",
      label: "Можливе ім'я / прізвище конкретної людини",
    });
  }

  return risks;
}

// Strict check used to BLOCK submission: any personal contact / messenger.
export function containsPersonalContacts(text: string): boolean {
  if (!text) return false;
  return detectContacts(text).length > 0;
}

/**
 * Returns true when the text looks like spam / test input rather than
 * a genuine review. Checks:
 *  - Single character repeated: "aaaaaaaaa", "!!!!!!"
 *  - One word/token repeated many times: "тест тест тест тест"
 *  - Ratio of unique chars to total is too low
 */
export function isLowQualityText(text: string): boolean {
  const t = text.trim();
  if (!t) return false;

  // 1. Almost all the same character (including punctuation/symbols)
  const chars = t.replace(/\s/g, "");
  if (chars.length >= 6) {
    const freq = new Map<string, number>();
    for (const c of chars.toLowerCase()) freq.set(c, (freq.get(c) ?? 0) + 1);
    const maxFreq = Math.max(...freq.values());
    // If one character makes up > 75% of non-space chars → low quality
    if (maxFreq / chars.length > 0.75) return true;
  }

  // 2. Single word/token repeated >= 4 times
  const words = t.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length >= 4) {
    const wordFreq = new Map<string, number>();
    for (const w of words) wordFreq.set(w, (wordFreq.get(w) ?? 0) + 1);
    const maxWordFreq = Math.max(...wordFreq.values());
    // If one word covers > 60% of all words → low quality
    if (maxWordFreq / words.length > 0.6) return true;
  }

  return false;
}

// Alias kept for existing callers (live form warning). Same meaning now:
// presence of any personal contact in the open text.
export function hasPersonalDataInText(text: string): boolean {
  return containsPersonalContacts(text);
}
