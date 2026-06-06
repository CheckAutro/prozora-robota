-- ============================================================
-- Migration: create external_company_sources table
-- Separate from public.reviews, external_ratings, external_review_signals,
-- company_open_facts, and company_discovery_queue.
-- ============================================================

create table if not exists public.external_company_sources (
  id              uuid        primary key default gen_random_uuid(),
  company_slug    text        not null,
  company_name    text        not null check (char_length(company_name) >= 1),
  source_name     text        not null check (char_length(source_name) >= 1),
  source_url      text,
  source_type     text        not null
                              check (source_type in (
                                'reviews',
                                'rating',
                                'vacancy',
                                'company_page',
                                'article',
                                'other'
                              )),
  title           text,
  short_summary   text        not null
                              check (char_length(short_summary) >= 20
                                 and char_length(short_summary) <= 800),
  positive_points  text[]      not null default '{}',
  negative_points  text[]      not null default '{}',
  neutral_facts    text[]      not null default '{}',
  rating_value     numeric,
  rating_scale     numeric     not null default 5,
  reviews_count    integer     not null default 0,
  confidence       text        not null default 'medium'
                              check (confidence in ('low', 'medium', 'high')),
  status           text        not null default 'needs_verification'
                              check (status in ('needs_verification', 'verified', 'rejected')),
  is_public        boolean     not null default false,
  source_excerpt   text,
  collected_at     timestamptz not null default now(),
  admin_note       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists external_company_sources_company_slug_idx
  on public.external_company_sources (company_slug);

create index if not exists external_company_sources_status_idx
  on public.external_company_sources (status);

create index if not exists external_company_sources_is_public_idx
  on public.external_company_sources (is_public);

create index if not exists external_company_sources_source_name_idx
  on public.external_company_sources (source_name);

create index if not exists external_company_sources_source_type_idx
  on public.external_company_sources (source_type);

create unique index if not exists external_company_sources_dedupe_idx
  on public.external_company_sources (
    company_slug,
    source_name,
    source_type,
    (coalesce(source_url, '')),
    (coalesce(title, ''))
  );

create or replace function public.set_external_company_sources_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_external_company_sources_updated_at
  on public.external_company_sources;

create trigger trg_external_company_sources_updated_at
  before update on public.external_company_sources
  for each row execute function public.set_external_company_sources_updated_at();

alter table public.external_company_sources enable row level security;

drop policy if exists "public read verified external company sources" on public.external_company_sources;
create policy "public read verified external company sources"
  on public.external_company_sources for select
  using (status = 'verified' and is_public = true);

drop policy if exists "public insert external company sources denied" on public.external_company_sources;
create policy "public insert external company sources denied"
  on public.external_company_sources for insert
  with check (false);

drop policy if exists "public update external company sources denied" on public.external_company_sources;
create policy "public update external company sources denied"
  on public.external_company_sources for update
  using (false)
  with check (false);

drop policy if exists "public delete external company sources denied" on public.external_company_sources;
create policy "public delete external company sources denied"
  on public.external_company_sources for delete
  using (false);
