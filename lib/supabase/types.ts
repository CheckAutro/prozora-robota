// Auto-generated Supabase database types (simplified hand-written version).
// Replace with the output of `npx supabase gen types typescript` once you
// have a live project connected.

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export interface Database {
  public: {
    Tables: {
      reviews: {
        Row: ReviewRow;
        Insert: ReviewInsert;
        Update: ReviewUpdate;
      };
      companies: {
        Row: CompanyRow;
        Insert: Partial<CompanyRow>;
        Update: Partial<CompanyRow>;
      };
      jobs: {
        Row: JobRow;
        Insert: Partial<JobRow>;
        Update: Partial<JobRow>;
      };
      review_moderation_logs: {
        Row: ModerationLogRow;
        Insert: Partial<ModerationLogRow>;
        Update: Partial<ModerationLogRow>;
      };
      company_claims: {
        Row: CompanyClaimRow;
        Insert: Partial<CompanyClaimRow>;
        Update: Partial<CompanyClaimRow>;
      };
    };
  };
}

// ── reviews ──────────────────────────────────────────────────────────────────

export interface ReviewRow {
  id: string;
  company_slug: string;
  company_name: string;
  type: "employee" | "interview" | "internship" | "applicant";
  city: string;
  role_category: string;
  year: number;
  verified: boolean;
  text: string;
  salary_match: "yes" | "no" | "partial" | "unknown";
  official_employment: "official_day_one" | "after_internship" | "unofficial" | "unknown";
  booking_promised: "yes" | "no" | "not_applicable";
  booking_received: "yes" | "no" | "promised_later" | "unknown" | "not_applicable";
  booking_timing:
    | "immediately"
    | "after_probation"
    | "after_internship"
    | "not_specified"
    | null;
  internship_paid: "yes" | "no" | "partial" | "no_internship";
  payment_delay: "yes" | "no" | "unknown";
  ratings: Json; // { salary, schedule, management, conditions, honesty }
  badges: string[];
  status: "pending" | "published" | "rejected" | "needs_edit";
  created_at: string;
  updated_at: string;
}

export type ReviewInsert = Omit<ReviewRow, "updated_at"> & { updated_at?: string };
export type ReviewUpdate = Partial<ReviewRow>;

// ── companies (future) ───────────────────────────────────────────────────────

export interface CompanyRow {
  id: string;
  slug: string;
  name: string;
  city: string | null;
  industry: string | null;
  verified: boolean;
  created_at: string;
}

// ── jobs (future) ─────────────────────────────────────────────────────────────

export interface JobRow {
  id: string;
  company_slug: string;
  title: string;
  city: string | null;
  salary: string | null;
  source: string | null;
  source_url: string | null;
  risk_level: "low" | "medium" | "high" | "unknown" | null;
  booking_claimed: boolean;
  short_description: string | null;
  created_at: string;
}

// ── review_moderation_logs (future) ──────────────────────────────────────────

export interface ModerationLogRow {
  id: string;
  review_id: string;
  action: "publish" | "reject" | "needs_edit" | "flag";
  moderator_id: string | null; // null = anon admin (demo only)
  reason: string | null;
  created_at: string;
}

// ── company_claims (future) ───────────────────────────────────────────────────

export interface CompanyClaimRow {
  id: string;
  company_slug: string;
  contact_email: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
}
