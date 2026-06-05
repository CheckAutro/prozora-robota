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
}

export interface AiSourceBreakdown {
  internal_reviews: number;
  open_facts: number;
  external_ratings: number;
  external_signals: number;
  found_external_sources: number;
  vacancy_text: boolean;
}

export interface AiAnalysisResult {
  summary: string;
  risk_level: RiskLevel;
  risk_score: number | null;
  confidence_level: AiConfidenceLevel;
  data_level: AiDataLevel;
  known_facts: string[];
  external_findings: string[];
  risks: string[];
  missing_data: string[];
  interview_questions: string[];
  recommendations: string[];
  source_breakdown: AiSourceBreakdown;
  disclaimer: string;
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
