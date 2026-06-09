import type { RiskLevel } from "@/lib/types";

export type AiAnalysisType = "vacancy" | "company";
export type AiConfidenceLevel = "low" | "medium" | "high";
export type AiDataLevel = "insufficient" | "partial" | "enough";
export type AiFetchStatus = "not_requested" | "success" | "blocked" | "unsupported" | "failed" | "timeout";

export type ExternalSourceSignalType =
  | "review"
  | "rating"
  | "vacancy"
  | "company_page"
  | "discussion"
  | "unknown";

export interface ExternalSourceCandidate {
  source_name: string;
  source_url: string;
  title: string;
  snippet: string;
  signal_type: ExternalSourceSignalType;
  confidence: AiConfidenceLevel;
  source_language?: "uk" | "ru" | "en" | "unknown";
  match_hint?: string;
}

export interface AiSourceBreakdown {
  internal_reviews: number;
  open_facts: number;
  external_ratings: number;
  external_signals: number;
  external_company_sources: number;
  external_company_sources_total: number;
  external_review_sources: number;
  external_rating_sources: number;
  external_vacancy_sources: number;
  external_company_page_sources: number;
  reputation_sources_total: number;
  specific_reputation_sources_total: number;
  open_fact_sources_total: number;
  found_external_sources: number;
  vacancy_text: boolean;
}

export interface SourceEvidence {
  source_name: string;
  source_type: string;
  what_found: string;
  topics: string[];
  limitation: string | null;
}

export interface ExtractedFact {
  category: "salary" | "schedule" | "management" | "culture" | "benefits" | "reviews" | "growth" | "other";
  fact: string;
  evidence_strength: "confirmed" | "partial" | "inferred";
}

export interface AiAnalysisResult {
  summary: string;
  risk_level: RiskLevel;
  risk_score: number | null;
  confidence_level: AiConfidenceLevel;
  data_level: AiDataLevel;
  analysis_mode: "ai" | "fallback";
  provider: string | null;
  fallback_reason?: string | null;
  known_facts: string[];
  external_findings: string[];
  risks: string[];
  missing_data: string[];
  interview_questions: string[];
  recommendations: string[];
  source_breakdown: AiSourceBreakdown;
  disclaimer: string;
  // Candidate-focused report fields
  final_verdict: string | null;
  bottom_line: string | null;
  positive_signals: string[];
  risk_signals: string[];
  candidate_action_plan: string[];
  source_evidence: SourceEvidence[];
  extracted_facts: ExtractedFact[];
  repeated_topics: string[];
  practical_score: number | null;
}

export interface SafeVacancyReadResult {
  status: AiFetchStatus;
  sourceName?: string;
  title?: string;
  companyName?: string;
  city?: string;
  salaryText?: string;
  text?: string;
  reason?: string;
}
