-- ============================================================
-- Migration: create company_open_facts table
-- Run once in Supabase SQL Editor.
-- Safe to re-run where possible.
--
-- Company open facts are extracted from public vacancy pages.
-- They are separate from:
--   - public.reviews
--   - public.external_ratings
--   - public.external_signals
--
-- They never affect internal review counts or ratings.
-- ============================================================

create table if not exists public.company_open_facts (
  id                           uuid        primary key default gen_random_uuid(),
  company_slug                 text        not null,
  company_name                 text        not null,
  source_name                  text        not null,
  source_url                   text,
  vacancy_title                text,
  city                         text,
  salary_text                  text,
  employment_type              text,
  schedule                     text,
  experience                   text,
  education                    text,
  company_description          text,
  vacancy_description          text,
  requirements                 text[]      default '{}',
  responsibilities             text[]      default '{}',
  conditions                   text[]      default '{}',
  benefits                     text[]      default '{}',
  skills                       text[]      default '{}',
  mentions_official_employment boolean     default false,
  mentions_booking             boolean     default false,
  mentions_probation           boolean     default false,
  mentions_bonus               boolean     default false,
  raw_excerpt                  text,
  collected_at                 timestamptz default now(),
  status                       text        default 'needs_verification'
                                        check (status in (
                                          'needs_verification', 'verified', 'rejected'
                                        )),
  is_public                    boolean     default false,
  created_at                   timestamptz default now(),
  updated_at                   timestamptz default now()
);

comment on table public.company_open_facts is
  'Facts extracted from open vacancy pages. Separate from reviews and external ratings; never affects internal review counts or ratings.';

create index if not exists company_open_facts_company_slug_idx
  on public.company_open_facts (company_slug);

create index if not exists company_open_facts_status_idx
  on public.company_open_facts (status);

create index if not exists company_open_facts_is_public_idx
  on public.company_open_facts (is_public);

create index if not exists company_open_facts_source_name_idx
  on public.company_open_facts (source_name);

create unique index if not exists company_open_facts_company_source_url_idx
  on public.company_open_facts (company_slug, source_url)
  where source_url is not null;

create or replace function public.set_company_open_facts_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  if new.status <> 'verified' then
    new.is_public = false;
  end if;
  if new.is_public = true and new.status <> 'verified' then
    raise exception 'is_public=true is allowed only for verified company_open_facts';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_company_open_facts_updated_at
  on public.company_open_facts;

create trigger trg_company_open_facts_updated_at
  before update on public.company_open_facts
  for each row execute function public.set_company_open_facts_updated_at();

alter table public.company_open_facts enable row level security;

drop policy if exists "public read verified company open facts" on public.company_open_facts;
create policy "public read verified company open facts"
  on public.company_open_facts for select
  using (status = 'verified' and is_public = true);

drop policy if exists "public insert company open facts denied" on public.company_open_facts;
create policy "public insert company open facts denied"
  on public.company_open_facts for insert
  with check (false);
