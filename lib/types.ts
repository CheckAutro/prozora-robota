// Domain types for "Прозора робота"
// All persisted/review structures live here so a future Supabase migration is trivial.

export type RiskLevel = "low" | "medium" | "high" | "unknown";

export type ReviewType = "employee" | "interview" | "internship" | "applicant";

export type TriState = "yes" | "no" | "partial" | "unknown";

export type EmploymentType =
  | "official_day_one"
  | "after_internship"
  | "unofficial"
  | "unknown";

export type BookingReceived =
  | "yes"
  | "no"
  | "promised_later"
  | "unknown"
  | "not_applicable";

export type BookingTiming =
  | "immediately"
  | "after_probation"
  | "after_internship"
  | "not_specified";

export type ReviewStatus = "pending" | "published" | "rejected" | "needs_edit";

export interface ReviewRatings {
  salary: number; // 1..5
  schedule: number;
  management: number;
  conditions: number;
  honesty: number;
}

export interface Review {
  id: string;
  companySlug: string;
  companyName: string;
  type: ReviewType;
  city: string;
  roleCategory: string;
  year: number;
  verified: boolean;
  text: string;
  salaryMatch: TriState;
  officialEmployment: EmploymentType;
  bookingPromised: "yes" | "no" | "not_applicable";
  bookingReceived: BookingReceived;
  internshipPaid: "yes" | "no" | "partial" | "no_internship";
  paymentDelay: "yes" | "no" | "unknown";
  bookingTiming?: BookingTiming;
  ratings: ReviewRatings;
  badges: string[];
  status?: ReviewStatus;
  createdAt?: string;
  riskFlags?: string[];
}

export interface Job {
  id: string;
  title: string;
  city: string;
  salary: string;
  source: string;
  sourceUrl: string;
  riskLevel: RiskLevel;
  bookingClaimed: boolean;
  shortDescription: string;
}

export interface Company {
  id: string;
  slug: string;
  name: string;
  city: string;
  industry: string;
  trustScore: number; // 0..100
  bookingScore: number; // 0..100
  reviewsCount: number;
  verifiedReviewsCount: number;
  salaryMatchPercent: number;
  officialEmploymentPercent: number;
  bookingConfirmedPercent: number;
  internshipPaidPercent: number;
  paymentDelayRisk: RiskLevel;
  riskLevel: RiskLevel;
  shortSummary: string;
  pros: string[];
  cons: string[];
  bookingSummary: string;
  salarySummary: string;
  employmentSummary: string;
  internshipSummary: string;
  interviewQuestions: string[];
  jobs: Job[];
  reviews: Review[];
}

// Result of the mock AI job analysis
export interface JobAnalysisSection {
  status: string;
  detail: string;
  toClarify: string;
}

export interface JobAnalysis {
  riskLevel: RiskLevel;
  summary: string;
  booking: JobAnalysisSection;
  salary: JobAnalysisSection;
  employment: JobAnalysisSection;
  internship: JobAnalysisSection;
  redFlags: string[];
  interviewQuestions: string[];
}

// ── External signals ─────────────────────────────────────────────────────────
// Short admin-curated notes about a company from external sources.
// NEVER mixed with public.reviews — different table, different purpose.

export type ExternalSignalStatus =
  | "needs_verification"
  | "verified"
  | "rejected";

export type ExternalSignalType =
  | "salary_delay"
  | "unclear_salary"
  | "schedule_risk"
  | "overload"
  | "official_employment_issue"
  | "interview_issue"
  | "management_issue"
  | "booking_info"
  | "internship_info"
  | "positive_team"
  | "positive_salary"
  | "positive_conditions"
  | "other";

export interface ExternalSignal {
  id: string;
  companySlug: string;
  companyName: string;
  shortSummary: string;
  signalType: ExternalSignalType;
  sourceName: string | null;
  sourceUrl: string | null;
  status: ExternalSignalStatus;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
}

// ── External ratings ─────────────────────────────────────────────────────────
// Reference ratings from external sources.
// NEVER mixed with public.reviews or internal Прозора робота ratings.

export type ExternalRatingStatus =
  | "needs_verification"
  | "verified"
  | "rejected";

export interface ExternalRating {
  id: string;
  companySlug: string;
  companyName: string;
  sourceName: string;
  sourceUrl: string | null;
  ratingValue: number | null;
  ratingScale: number | null;
  reviewsCount: number;
  fetchedAt: string | null;
  status: ExternalRatingStatus;
  isPublic: boolean;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Company open facts ───────────────────────────────────────────────────────
// Structured facts extracted from open vacancy pages.
// NEVER mixed with public.reviews, external_ratings, or internal ratings.

export type CompanyOpenFactStatus =
  | "needs_verification"
  | "verified"
  | "rejected";

export interface CompanyOpenFact {
  id: string;
  companySlug: string;
  companyName: string;
  sourceName: string;
  sourceUrl: string | null;
  vacancyTitle: string | null;
  city: string | null;
  salaryText: string | null;
  employmentType: string | null;
  schedule: string | null;
  experience: string | null;
  education: string | null;
  companyDescription: string | null;
  vacancyDescription: string | null;
  requirements: string[];
  responsibilities: string[];
  conditions: string[];
  benefits: string[];
  skills: string[];
  mentionsOfficialEmployment: boolean;
  mentionsBooking: boolean;
  mentionsProbation: boolean;
  mentionsBonus: boolean;
  rawExcerpt: string | null;
  collectedAt: string | null;
  status: CompanyOpenFactStatus;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
}

// ── Company discovery queue ──────────────────────────────────────────────────
// Candidate companies discovered from open sources.
// NEVER mixed with public.reviews and never affects ratings or review counts.

export type CompanyDiscoveryMatchConfidence = "low" | "medium" | "high";

export type CompanyDiscoveryStatus =
  | "needs_review"
  | "auto_imported"
  | "matched_existing"
  | "rejected";

export interface CompanyDiscoveryQueueItem {
  id: string;
  discoveredName: string;
  suggestedSlug: string;
  sourceName: string;
  sourceUrl: string | null;
  city: string | null;
  industry: string | null;
  description: string | null;
  companySize: string | null;
  matchedExistingSlug: string | null;
  matchConfidence: CompanyDiscoveryMatchConfidence;
  status: CompanyDiscoveryStatus;
  isImported: boolean;
  importedCompanySlug: string | null;
  rawExcerpt: string | null;
  collectedAt: string | null;
  adminNote: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── External review signals ─────────────────────────────────────────────────
// Admin-verified short summaries of what external reviews are saying.
// NEVER mixed with public.reviews, external_ratings, company_open_facts, or
// internal Прозора робота ratings.

export type ExternalReviewSignalStatus =
  | "needs_verification"
  | "verified"
  | "rejected";

export type ExternalReviewSignalTopic =
  | "salary"
  | "schedule"
  | "employment"
  | "management"
  | "workload"
  | "payment_delay"
  | "interview"
  | "booking"
  | "benefits"
  | "career"
  | "culture"
  | "other";

export type ExternalReviewSignalSentiment =
  | "positive"
  | "mixed"
  | "negative"
  | "neutral";

export type ExternalReviewSignalConfidence =
  | "low"
  | "medium"
  | "high";

export interface ExternalReviewSignal {
  id: string;
  companySlug: string;
  companyName: string;
  sourceName: string;
  sourceUrl: string | null;
  topic: ExternalReviewSignalTopic;
  sentiment: ExternalReviewSignalSentiment;
  summary: string;
  mentionsCount: number;
  sampleSize: number | null;
  confidence: ExternalReviewSignalConfidence;
  collectedAt: string | null;
  status: ExternalReviewSignalStatus;
  isPublic: boolean;
  adminNote: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── External company sources ────────────────────────────────────────────────
// Unified external sources collected from public company pages, review sites,
// vacancy pages, and articles. Separate from public.reviews and ratings.

export type ExternalCompanySourceStatus =
  | "needs_verification"
  | "verified"
  | "rejected";

export type ExternalCompanySourceType =
  | "reviews"
  | "rating"
  | "vacancy"
  | "company_page"
  | "article"
  | "other";

export type ExternalCompanySourceConfidence =
  | "low"
  | "medium"
  | "high";

export interface ExternalCompanySource {
  id: string;
  companySlug: string;
  companyName: string;
  sourceName: string;
  sourceUrl: string | null;
  sourceType: ExternalCompanySourceType;
  title: string | null;
  shortSummary: string;
  positivePoints: string[];
  negativePoints: string[];
  neutralFacts: string[];
  ratingValue: number | null;
  ratingScale: number | null;
  reviewsCount: number;
  confidence: ExternalCompanySourceConfidence;
  status: ExternalCompanySourceStatus;
  isPublic: boolean;
  sourceExcerpt: string | null;
  collectedAt: string | null;
  adminNote: string | null;
  createdAt: string;
  updatedAt: string;
}
