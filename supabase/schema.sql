-- ============================================================
-- Прозора робота — Supabase schema
--
-- Безпечно запускати повторно в SQL Editor:
--   • CREATE TABLE / INDEX / FUNCTION використовують IF NOT EXISTS
--   • кожен DROP POLICY IF EXISTS виконується перед CREATE POLICY
--   • тригер скидається через DROP TRIGGER IF EXISTS перед CREATE
-- ============================================================

-- ── Extensions ───────────────────────────────────────────────────────────────
create extension if not exists "pgcrypto";

-- ============================================================
-- reviews
-- ============================================================
create table if not exists public.reviews (
  id               text        primary key,
  company_slug     text        not null,
  company_name     text        not null,
  type             text        not null
                     check (type in ('employee','interview','internship','applicant')),
  city             text        not null,
  role_category    text        not null,
  year             int         not null check (year >= 2015 and year <= 2100),
  verified         boolean     not null default false,
  text             text        not null check (char_length(text) >= 30),
  salary_match     text        not null
                     check (salary_match in ('yes','no','partial','unknown')),
  official_employment text     not null
                     check (official_employment in
                       ('official_day_one','after_internship','unofficial','unknown')),
  booking_promised text        not null
                     check (booking_promised in ('yes','no','not_applicable')),
  booking_received text        not null
                     check (booking_received in
                       ('yes','no','promised_later','unknown','not_applicable')),
  booking_timing   text        check (booking_timing in
                       ('immediately','after_probation','after_internship','not_specified')),
  internship_paid  text        not null
                     check (internship_paid in ('yes','no','partial','no_internship')),
  payment_delay    text        not null
                     check (payment_delay in ('yes','no','unknown')),
  ratings          jsonb       not null default '{}',
  badges           text[]      not null default '{}',
  status           text        not null default 'pending'
                     check (status in ('pending','published','rejected','needs_edit')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.reviews is
  'Anonymous employee / candidate reviews. All rows pass through moderation before publishing.';
comment on column public.reviews.status is
  'pending → moderation queue | published → visible on company page | rejected → hidden | needs_edit → returned to submitter';
comment on column public.reviews.verified is
  'Set to true only after a separate document-verification step (future feature). Never set on insert or when changing moderation status.';

-- Indexes
create index if not exists reviews_company_slug_status_idx
  on public.reviews (company_slug, status);

create index if not exists reviews_status_created_idx
  on public.reviews (status, created_at desc);

-- Auto-update updated_at
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists reviews_set_updated_at on public.reviews;
create trigger reviews_set_updated_at
  before update on public.reviews
  for each row execute function public.set_updated_at();

-- ── RLS for reviews ───────────────────────────────────────────────────────────
alter table public.reviews enable row level security;

-- 1. Anyone (anon + authenticated) can read only published reviews.
drop policy if exists "public read published reviews" on public.reviews;
create policy "public read published reviews"
  on public.reviews for select
  using (status = 'published');

-- 2. Anonymous insert is allowed only when ALL of the following are true:
--    • status   = 'pending'  — cannot bypass moderation queue
--    • verified = false      — cannot claim a verified badge on insert
--    • badges   = '{}'       — cannot inject pre-set badges
--    created_at / updated_at are not sent by the client — DB uses DEFAULT now().
drop policy if exists "public insert pending reviews" on public.reviews;
create policy "public insert pending reviews"
  on public.reviews for insert
  with check (
    status   = 'pending'
    and verified = false
    and badges   = '{}'::text[]
  );

-- The old unsafe demo policy — dropped for safety on every run.
drop policy if exists "TEMPORARY anon update for demo moderation" on public.reviews;

-- UPDATE / DELETE for anon: no policy → denied by RLS.
-- Admin moderation runs through /api/admin/reviews Route Handlers
-- that use the Supabase service-role key (bypasses RLS server-side).


-- ============================================================
-- companies  (future — currently served from mock-data.ts)
-- ============================================================
create table if not exists public.companies (
  id          text        primary key default gen_random_uuid()::text,
  slug        text        not null unique,
  name        text        not null,
  city        text,
  industry    text,
  verified    boolean     not null default false,
  created_at  timestamptz not null default now()
);

comment on table public.companies is
  'Company registry. Currently served from mock-data.ts; this table is for the future.';

alter table public.companies enable row level security;

drop policy if exists "public read companies" on public.companies;
create policy "public read companies"
  on public.companies for select using (true);


-- ============================================================
-- jobs  (future — currently mock data in companies)
-- ============================================================
create table if not exists public.jobs (
  id               text        primary key default gen_random_uuid()::text,
  company_slug     text        not null references public.companies(slug) on delete cascade,
  title            text        not null,
  city             text,
  salary           text,
  source           text,
  source_url       text,
  risk_level       text        check (risk_level in ('low','medium','high','unknown')),
  booking_claimed  boolean     not null default false,
  short_description text,
  created_at       timestamptz not null default now()
);

alter table public.jobs enable row level security;

drop policy if exists "public read jobs" on public.jobs;
create policy "public read jobs"
  on public.jobs for select using (true);


-- ============================================================
-- review_moderation_logs
-- ============================================================
create table if not exists public.review_moderation_logs (
  id           text        primary key default gen_random_uuid()::text,
  review_id    text        not null references public.reviews(id) on delete cascade,
  action       text        not null
                 check (action in ('publish','reject','needs_edit','flag')),
  moderator_id text,       -- null = demo admin (key-only); replace with auth.uid() later
  reason       text,
  created_at   timestamptz not null default now()
);

comment on column public.review_moderation_logs.moderator_id is
  'NULL = demo admin identified only by ADMIN_ACCESS_KEY. Replace with auth.uid() when Supabase Auth is connected.';

alter table public.review_moderation_logs enable row level security;
-- No anon policy: only service_role (Route Handlers) can read/write logs.


-- ============================================================
-- company_claims  (future — verified employer profiles)
-- ============================================================
create table if not exists public.company_claims (
  id            text        primary key default gen_random_uuid()::text,
  company_slug  text        not null,
  contact_email text        not null,
  status        text        not null default 'pending'
                  check (status in ('pending','approved','rejected')),
  created_at    timestamptz not null default now()
);

comment on table public.company_claims is
  'Employer claim requests. Used for the /for-employers flow (future).';

alter table public.company_claims enable row level security;

-- Anyone can submit a claim (status must be pending).
drop policy if exists "public insert claims" on public.company_claims;
create policy "public insert claims"
  on public.company_claims for insert
  with check (status = 'pending');


-- ============================================================
-- external_ratings
-- ============================================================
create table if not exists public.external_ratings (
  id            uuid        primary key default gen_random_uuid(),
  company_slug  text        not null,
  company_name  text        not null,
  source_name   text        not null,
  source_url    text,
  rating_value  numeric,
  rating_scale  numeric     default 5,
  reviews_count integer     default 0,
  fetched_at    timestamptz,
  status        text        default 'needs_verification'
                              check (status in (
                                'needs_verification', 'verified', 'rejected'
                              )),
  is_public     boolean     default false,
  note          text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

comment on table public.external_ratings is
  'External source ratings for reference only. Never copied into public.reviews and never included in internal review counts or ratings.';

create index if not exists external_ratings_company_slug_idx
  on public.external_ratings (company_slug);

create index if not exists external_ratings_is_public_idx
  on public.external_ratings (is_public);

create index if not exists external_ratings_status_idx
  on public.external_ratings (status);

create or replace function public.set_external_ratings_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_external_ratings_updated_at
  on public.external_ratings;

create trigger trg_external_ratings_updated_at
  before update on public.external_ratings
  for each row execute function public.set_external_ratings_updated_at();

alter table public.external_ratings enable row level security;

drop policy if exists "public read verified external ratings" on public.external_ratings;
create policy "public read verified external ratings"
  on public.external_ratings for select
  using (status = 'verified' and is_public = true);

drop policy if exists "public insert external ratings denied" on public.external_ratings;
create policy "public insert external ratings denied"
  on public.external_ratings for insert
  with check (false);
