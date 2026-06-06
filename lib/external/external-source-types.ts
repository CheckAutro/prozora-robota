import type {
  ExternalCompanySource,
  ExternalCompanySourceConfidence,
  ExternalCompanySourceStatus,
  ExternalCompanySourceType,
} from "@/lib/types";

export type {
  ExternalCompanySource,
  ExternalCompanySourceConfidence,
  ExternalCompanySourceStatus,
  ExternalCompanySourceType,
};

export interface ExternalSourceCollectInput {
  companySlug?: string | null;
  companyName?: string | null;
  sourceUrl: string;
  sourceName?: string | null;
  sourceType?: ExternalCompanySourceType | null;
  title?: string | null;
  shortSummary?: string | null;
  positivePoints?: string[];
  negativePoints?: string[];
  neutralFacts?: string[];
  ratingValue?: number | null;
  ratingScale?: number | null;
  reviewsCount?: number | null;
  confidence?: ExternalCompanySourceConfidence | null;
  status?: ExternalCompanySourceStatus | null;
  isPublic?: boolean | null;
  sourceExcerpt?: string | null;
  collectedAt?: string | null;
  adminNote?: string | null;
}

export interface ExternalSourceCollectResult {
  ok: boolean;
  created: boolean;
  updated: boolean;
  id?: string;
  warning?: string;
}
