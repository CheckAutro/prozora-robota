-- ============================================================
-- Migration: create external_signals table
-- Run once in Supabase SQL Editor.
-- Safe to re-run: all statements use IF NOT EXISTS / OR REPLACE.
-- ============================================================

-- ── Table ─────────────────────────────────────────────────────────────────────

create table if not exists public.external_signals (
  id            uuid        primary key default gen_random_uuid(),
  company_slug  text        not null,
  company_name  text        not null check (char_length(company_name) >= 1),
  short_summary text        not null
                              check (char_length(short_summary) >= 10
                                 and char_length(short_summary) <= 500),
  signal_type   text        not null
                              check (signal_type in (
                                'salary_delay', 'unclear_salary', 'schedule_risk',
                                'overload', 'official_employment_issue', 'interview_issue',
                                'management_issue', 'booking_info', 'internship_info',
                                'positive_team', 'positive_salary', 'positive_conditions',
                                'other'
                              )),
  source_name   text,
  source_url    text,
  status        text        not null default 'needs_verification'
                              check (status in (
                                'needs_verification', 'verified', 'rejected'
                              )),
  is_public     boolean     not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ── Index ─────────────────────────────────────────────────────────────────────

create index if not exists external_signals_company_slug_idx
  on public.external_signals (company_slug);

create index if not exists external_signals_status_idx
  on public.external_signals (status);

-- ── Updated-at trigger ───────────────────────────────────────────────────────

create or replace function public.set_external_signals_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_external_signals_updated_at
  on public.external_signals;

create trigger trg_external_signals_updated_at
  before update on public.external_signals
  for each row execute function public.set_external_signals_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────────────────
-- External signals are NOT publicly readable at this stage.
-- All admin operations go through service-role (bypasses RLS).
-- Public anon key gets NO access at all.

alter table public.external_signals enable row level security;

-- Drop any stale policies before recreating
drop policy if exists "external_signals_no_public_read"   on public.external_signals;
drop policy if exists "external_signals_no_public_insert" on public.external_signals;

-- Explicit deny for anon/authenticated roles (belt-and-suspenders)
create policy "external_signals_no_public_read"
  on public.external_signals for select
  using (false);

create policy "external_signals_no_public_insert"
  on public.external_signals for insert
  with check (false);
