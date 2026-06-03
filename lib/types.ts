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
