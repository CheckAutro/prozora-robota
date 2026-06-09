export type EvidenceFactCategory =
  | "salary"
  | "schedule"
  | "employment"
  | "bonus_kpi"
  | "management"
  | "team"
  | "workload"
  | "delays"
  | "fines"
  | "interview"
  | "career"
  | "probation"
  | "overtime"
  | "booking"
  | "vacancy_count"
  | "rating"
  | "review_count"
  | "legal"
  | "unknown";

export type EvidencePolarity = "positive" | "negative" | "neutral" | "unknown";
export type EvidenceSeverity = "low" | "medium" | "high" | "unknown";

export type ExtractionStatus =
  | "extracted"
  | "partial"
  | "blocked"
  | "not_enough_text"
  | "generic_only"
  | "failed";

export interface EvidenceFact {
  category: EvidenceFactCategory;
  polarity: EvidencePolarity;
  severity: EvidenceSeverity;
  text_uk: string;        // human-readable Ukrainian description, max 180 chars
  evidence_text: string;  // up to 25 words from source
  confidence: "low" | "medium" | "high";
}

export interface ConcreteNumber {
  label: string;
  value: string;
  context: string;
}

export interface SourceEvidenceData {
  extraction_status: ExtractionStatus;
  useful_for_analysis: boolean;
  usefulness_score: number;      // 0–100
  extracted_facts: EvidenceFact[];
  detected_topics: string[];
  concrete_numbers: ConcreteNumber[];
  source_limitations: string[];
  raw_excerpt_used: string;      // max 800 chars, sanitized
}

export const EVIDENCE_CATEGORY_LABELS: Record<EvidenceFactCategory, string> = {
  salary: "Зарплата",
  schedule: "Графік",
  employment: "Оформлення",
  bonus_kpi: "Бонуси / KPI",
  management: "Керівництво",
  team: "Колектив",
  workload: "Навантаження",
  delays: "Затримки виплат",
  fines: "Штрафи",
  interview: "Співбесіда",
  career: "Кар'єра",
  probation: "Випробувальний термін",
  overtime: "Понаднормові",
  booking: "Бронювання",
  vacancy_count: "Кількість вакансій",
  rating: "Оцінка",
  review_count: "Кількість відгуків",
  legal: "Юридичне",
  unknown: "Інше",
};
