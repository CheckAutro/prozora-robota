-- ============================================================
-- Migration: create external_ratings table
-- Run once in Supabase SQL Editor.
-- Safe to re-run: all statements use IF NOT EXISTS / OR REPLACE.
--
-- External ratings are separate reference data:
--   - never copied into public.reviews
--   - never counted as Прозора робота reviews
--   - never included in internal ratings
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
