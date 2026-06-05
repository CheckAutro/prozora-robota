-- Migration: create ai_analysis_requests table
--
-- Stores free AI/deterministic analysis history.
-- This table is separate from public.reviews, external_ratings,
-- external_review_signals, and company_open_facts.
-- It never affects internal ratings or published review counts.

create table if not exists public.ai_analysis_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  anonymous_id text,
  ip_hash text,
  analysis_type text not null
    check (analysis_type in ('vacancy', 'company')),
  company_slug text,
  company_name text,
  input_text text,
  input_url text,
  fetched_text text,
  fetch_status text
    check (fetch_status in ('not_requested', 'success', 'blocked', 'unsupported', 'failed', 'timeout')),
  result_json jsonb not null default '{}'::jsonb,
  sources_json jsonb not null default '[]'::jsonb,
  risk_level text
    check (risk_level in ('low', 'medium', 'high', 'unknown')),
  risk_score integer,
  confidence_level text
    check (confidence_level in ('low', 'medium', 'high')),
  created_at timestamptz not null default now()
);

comment on table public.ai_analysis_requests is
  'History of AI/deterministic analyses. Not reviews and not used for company ratings.';

create index if not exists ai_analysis_requests_created_at_idx
  on public.ai_analysis_requests (created_at desc);

create index if not exists ai_analysis_requests_user_created_idx
  on public.ai_analysis_requests (user_id, created_at desc);

create index if not exists ai_analysis_requests_anonymous_created_idx
  on public.ai_analysis_requests (anonymous_id, created_at desc);

create index if not exists ai_analysis_requests_ip_hash_created_idx
  on public.ai_analysis_requests (ip_hash, created_at desc);

create index if not exists ai_analysis_requests_company_slug_idx
  on public.ai_analysis_requests (company_slug);

create index if not exists ai_analysis_requests_input_url_idx
  on public.ai_analysis_requests (input_url);

alter table public.ai_analysis_requests enable row level security;

create or replace function public.is_admin_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

grant execute on function public.is_admin_user() to authenticated;

drop policy if exists "admins read all ai analysis requests" on public.ai_analysis_requests;
create policy "admins read all ai analysis requests"
  on public.ai_analysis_requests for select
  using (public.is_admin_user());

drop policy if exists "users read own ai analysis requests" on public.ai_analysis_requests;
create policy "users read own ai analysis requests"
  on public.ai_analysis_requests for select
  using (auth.uid() = user_id);

drop policy if exists "anonymous ai analysis history no public read" on public.ai_analysis_requests;
create policy "anonymous ai analysis history no public read"
  on public.ai_analysis_requests for select
  using (false);

drop policy if exists "public insert ai analysis requests denied" on public.ai_analysis_requests;
create policy "public insert ai analysis requests denied"
  on public.ai_analysis_requests for insert
  with check (false);
