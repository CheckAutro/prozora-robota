import type { ExternalCompanySource } from "@/lib/types";
import type {
  ConcreteNumber,
  EvidenceFactCategory,
  EvidencePolarity,
  EvidenceSeverity,
  EvidenceFact,
  ExtractionStatus,
  SourceEvidenceData,
} from "./evidence-types";

// ── Generic phrase filter ────────────────────────────────────────────────────
// Must stay in sync with GENERIC_PHRASES in external-review-quality.ts
const GENERIC_PHRASES_SET: readonly string[] = [
  "є зовнішні відгуки працівників про компанію",
  "у джерелі згадується зовнішня оцінка компанії",
  "у джерелі згадуються вакансії або робота в компанії",
  "є зовнішнє джерело, яке потребує ручної перевірки модератором",
  "є зовнішнє джерело про компанію, яке потребує модерації",
  "є зовнішнє джерело про компанію, яке потребує модерації.",
  "у джерелі згадується зарплата або оплата",
  "у джерелі згадується управління або керівництво",
  "у джерелі згадуються умови або графік роботи",
  "є згадка про оформлення або договірні умови",
  "є позитивна згадка про умови, команду або переваги",
  "є негативна згадка або скарга",
  "є зовнішні відгуки про компанію",
  "company reviews are available",
  "there are reviews about the company",
  "джерело містить сторінку з відгуками або згадками про роботу в компанії",
];

function normalizeForMatch(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim().replace(/[.!?;]$/, "");
}

function isGenericPhrase(text: string): boolean {
  const n = normalizeForMatch(text);
  return GENERIC_PHRASES_SET.some((phrase) => n === phrase || n.includes(phrase));
}

// ── Category detection ───────────────────────────────────────────────────────
interface CategoryRule {
  category: EvidenceFactCategory;
  pattern: RegExp;
  severity?: EvidenceSeverity;
}

const CATEGORY_RULES: CategoryRule[] = [
  // High-severity negative signals (check before general categories)
  { category: "delays", pattern: /затримк[аи]|не платять|борг.{0,12}зарплат|невиплат|заборгованість/i, severity: "high" },
  { category: "fines", pattern: /штраф|депремі[юя]|вирахуван|кешбеки з зарплат/i, severity: "high" },
  { category: "legal", pattern: /суд[уові]|кримінальн|санкці[яї]|обшук|реєстр підприємств/i, severity: "high" },

  // Specific category matches
  { category: "salary", pattern: /зарплат[аи]|оплат[аи]|виплат[аи]|оклад|\d[\d\s]{2,5}\s*(?:грн|₴)/i },
  { category: "schedule", pattern: /5\/2|2\/2|позмін|нічн.{0,8}зміна|денна зміна|графік\s|розклад\s/i },
  { category: "employment", pattern: /офіційн.{0,12}оформл|трудов.{0,8}договір|по.чорному|неофіційн/i },
  { category: "bonus_kpi", pattern: /бонус[аи]?|kpi\b|ккі\b|преміал|преміюван/i },
  { category: "management", pattern: /керівниц|начальств|директор|менеджмент|management/i },
  { category: "team", pattern: /команда|колектив|атмосфера|team/i },
  { category: "workload", pattern: /понаднормов|переробки|навантаженн|overload/i },
  { category: "overtime", pattern: /понаднормові|переробки без оплати|overtim/i },
  { category: "booking", pattern: /брон[юь]ванн|відстрочк|бронь/i },
  { category: "career", pattern: /кар.єр|підвищенн|career|ріст/i },
  { category: "interview", pattern: /співбесід|interview|відбір|конкурс/i },
  { category: "probation", pattern: /випробувальн|стажуванн|probat/i },
  { category: "rating", pattern: /рейтинг|оцінка компанії|rating|stars/i },
  { category: "review_count", pattern: /відгуків|reviews|оцінок|коментарів/i },
  { category: "vacancy_count", pattern: /вакансій|вакансій відкрито|active jobs/i },
];

function detectCategory(text: string): { category: EvidenceFactCategory; severity?: EvidenceSeverity } {
  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(text)) {
      return { category: rule.category, severity: rule.severity };
    }
  }
  return { category: "unknown" };
}

function resolveSeverity(category: EvidenceFactCategory, polarity: EvidencePolarity, hintSeverity?: EvidenceSeverity): EvidenceSeverity {
  if (hintSeverity) return hintSeverity;
  if (polarity === "negative") {
    if (category === "delays" || category === "fines" || category === "legal") return "high";
    if (category === "management" || category === "workload" || category === "overtime") return "medium";
    return "medium";
  }
  if (polarity === "positive") return "low";
  return "unknown";
}

// ── Concrete number extraction ───────────────────────────────────────────────
interface NumberPattern {
  label: string;
  re: RegExp;
  extract: (m: RegExpMatchArray) => { value: string; context: string };
}

const NUMBER_PATTERNS: NumberPattern[] = [
  {
    label: "Зарплата",
    re: /(\d{4,6})\s*(?:грн|₴)(?:\s*\/\s*(?:міс|мес|місяць|мо))?/gi,
    extract: (m) => ({ value: `${m[1]} грн`, context: m[0] }),
  },
  {
    label: "Рейтинг",
    re: /(\d+[.,]\d+)\s*(?:\/|з|out\s*of)\s*(\d+)/gi,
    extract: (m) => ({ value: `${m[1]}/${m[2]}`, context: m[0] }),
  },
  {
    label: "Відгуків",
    re: /(\d[\d\s]{0,5})\s+(?:відгуків?|reviews?|оцінок)/gi,
    extract: (m) => ({ value: m[1].replace(/\s/g, ""), context: m[0] }),
  },
];

function extractConcreteNumbers(text: string, existingLabels: Set<string>): ConcreteNumber[] {
  const results: ConcreteNumber[] = [];
  for (const pat of NUMBER_PATTERNS) {
    if (existingLabels.has(pat.label)) continue;
    const matches = [...text.matchAll(pat.re)];
    if (matches.length > 0) {
      const { value, context } = pat.extract(matches[0]);
      results.push({ label: pat.label, value, context: context.trim() });
      existingLabels.add(pat.label);
    }
  }
  return results;
}

// ── Topic detection (same signal set as external-review-quality.ts) ──────────
const TOPIC_PATTERNS: Array<{ topic: string; pattern: RegExp }> = [
  { topic: "зарплата", pattern: /зарплат|salary|оплат|виплат|грн|₴|\d+\s*(тис|k\b)/i },
  { topic: "оформлення", pattern: /офіційне оформлення|трудова угода|трудовий договір/i },
  { topic: "графік", pattern: /5\/2|2\/2|позмін|графік\s/i },
  { topic: "затримки виплат", pattern: /затримк|не платять|борг зарплат|невиплат/i },
  { topic: "керівництво", pattern: /керівниц|начальств|management/i },
  { topic: "колектив", pattern: /команда|колектив|team/i },
  { topic: "навантаження", pattern: /понаднормов|навантаженн|overload|overtime/i },
  { topic: "штрафи", pattern: /штраф/i },
  { topic: "бронювання", pattern: /брон[юь]ванн|відстрочк/i },
  { topic: "кар'єра", pattern: /кар.єр|career|підвищенн/i },
  { topic: "співбесіда", pattern: /співбесід|interview/i },
];

function detectTopics(text: string): string[] {
  return TOPIC_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(({ topic }) => topic);
}

// ── Fact assembly ────────────────────────────────────────────────────────────
function makeFact(
  text: string,
  polarity: EvidencePolarity,
  evidenceText: string,
  confidence: EvidenceFact["confidence"]
): EvidenceFact {
  const { category, severity: hintSeverity } = detectCategory(text);
  const severity = resolveSeverity(category, polarity, hintSeverity);
  return {
    category,
    polarity,
    severity,
    text_uk: text.slice(0, 180),
    evidence_text: evidenceText.split(/\s+/).slice(0, 25).join(" "),
    confidence,
  };
}

function bulletFacts(
  bullets: string[],
  polarity: EvidencePolarity,
  confidence: EvidenceFact["confidence"]
): EvidenceFact[] {
  return bullets
    .filter((b) => b && !isGenericPhrase(b))
    .map((b) => makeFact(b, polarity, b, confidence));
}

// ── Usefulness scoring ───────────────────────────────────────────────────────
function computeUsefulnessScore(
  reviewsCount: number,
  ratingValue: number | null,
  nonGenericNegatives: number,
  nonGenericPositives: number,
  concreteNumbers: number,
  topics: number
): number {
  let score = 0;
  if (reviewsCount > 0) score += 30;
  if (ratingValue !== null) score += 25;
  score += Math.min(nonGenericNegatives * 15, 30);
  score += Math.min(nonGenericPositives * 8, 16);
  score += Math.min(concreteNumbers * 5, 15);
  score += Math.min(topics * 4, 16);
  return Math.min(score, 100);
}

// ── Main extractor ───────────────────────────────────────────────────────────
export function extractEvidenceFromSource(source: ExternalCompanySource): SourceEvidenceData {
  const facts: EvidenceFact[] = [];
  const concreteNumbers: ConcreteNumber[] = [];
  const limitations: string[] = [];
  const usedNumberLabels = new Set<string>();

  // High-confidence facts from structured numeric fields
  if (source.ratingValue !== null) {
    const scale = source.ratingScale ?? 5;
    const label = `${source.ratingValue}/${scale}`;
    facts.push({
      category: "rating",
      polarity: source.ratingValue >= scale * 0.6 ? "positive" : source.ratingValue <= scale * 0.4 ? "negative" : "neutral",
      severity: "low",
      text_uk: `Рейтинг: ${label} (${source.sourceName})`,
      evidence_text: `Рейтинг ${label}`,
      confidence: "high",
    });
    concreteNumbers.push({ label: "Рейтинг", value: label, context: source.sourceName });
    usedNumberLabels.add("Рейтинг");
  }

  if (source.reviewsCount > 0) {
    facts.push({
      category: "review_count",
      polarity: "neutral",
      severity: "low",
      text_uk: `Кількість відгуків: ${source.reviewsCount} (${source.sourceName})`,
      evidence_text: `${source.reviewsCount} відгуків на ${source.sourceName}`,
      confidence: "high",
    });
    concreteNumbers.push({ label: "Відгуків", value: String(source.reviewsCount), context: source.sourceName });
    usedNumberLabels.add("Відгуків");
  }

  // Medium-confidence facts from bullet arrays
  const negFacts = bulletFacts(source.negativePoints, "negative", "medium");
  const posFacts = bulletFacts(source.positivePoints, "positive", "medium");
  const neuFacts = bulletFacts(source.neutralFacts, "neutral", "low");
  facts.push(...negFacts, ...posFacts, ...neuFacts);

  // All text for topic/number scanning
  const allText = [
    source.shortSummary,
    ...source.positivePoints,
    ...source.negativePoints,
    ...source.neutralFacts,
    source.sourceExcerpt ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  // Low-confidence concrete numbers from text
  const textNumbers = extractConcreteNumbers(allText, usedNumberLabels);
  concreteNumbers.push(...textNumbers);

  // Low-confidence facts from excerpt patterns (only if not already captured)
  if (source.sourceExcerpt) {
    const excerptFacts: EvidenceFact[] = [];
    for (const rule of CATEGORY_RULES) {
      if (rule.pattern.test(source.sourceExcerpt)) {
        const alreadyCovered = facts.some((f) => f.category === rule.category);
        if (!alreadyCovered) {
          const polarity: EvidencePolarity =
            rule.severity === "high" ? "negative" : "unknown";
          excerptFacts.push(
            makeFact(
              `Згадка: ${rule.category} (з уривку джерела)`,
              polarity,
              source.sourceExcerpt.split(/\s+/).slice(0, 15).join(" "),
              "low"
            )
          );
        }
      }
    }
    facts.push(...excerptFacts);
  }

  // Topics from all text
  const topics = detectTopics(allText);
  const uniqueTopics = [...new Set(topics)];

  // Build raw excerpt used (sanitized, max 800 chars)
  const rawExcerpt = (source.sourceExcerpt ?? allText).slice(0, 800);

  // Source limitations
  if (source.sourceType === "vacancy") {
    limitations.push("Джерело — вакансія, не відгуки працівників");
  }
  if (source.sourceType === "company_page") {
    limitations.push("Джерело — сторінка компанії, не незалежні відгуки");
  }
  if (!source.sourceExcerpt) {
    limitations.push("Немає уривку з джерела для глибшого аналізу");
  }

  // Scoring
  const nonGenericNeg = source.negativePoints.filter((p) => !isGenericPhrase(p)).length;
  const nonGenericPos = source.positivePoints.filter((p) => !isGenericPhrase(p)).length;
  const usefulnessScore = computeUsefulnessScore(
    source.reviewsCount,
    source.ratingValue,
    nonGenericNeg,
    nonGenericPos,
    concreteNumbers.length,
    uniqueTopics.length
  );

  // Extraction status
  const hasAnyText = allText.trim().length > 10;
  const allGeneric = isGenericPhrase(source.shortSummary) &&
    source.positivePoints.every(isGenericPhrase) &&
    source.negativePoints.every(isGenericPhrase) &&
    source.neutralFacts.every(isGenericPhrase);

  let extractionStatus: ExtractionStatus;
  if (!hasAnyText && source.ratingValue === null && source.reviewsCount === 0) {
    extractionStatus = "not_enough_text";
  } else if (allGeneric && source.ratingValue === null && source.reviewsCount === 0) {
    extractionStatus = "generic_only";
  } else if (facts.length >= 2 || source.ratingValue !== null || source.reviewsCount > 0) {
    extractionStatus = "extracted";
  } else if (facts.length >= 1 || uniqueTopics.length >= 1) {
    extractionStatus = "partial";
  } else {
    extractionStatus = "generic_only";
  }

  return {
    extraction_status: extractionStatus,
    useful_for_analysis: usefulnessScore >= 20,
    usefulness_score: usefulnessScore,
    extracted_facts: facts,
    detected_topics: uniqueTopics,
    concrete_numbers: concreteNumbers,
    source_limitations: limitations,
    raw_excerpt_used: rawExcerpt,
  };
}
