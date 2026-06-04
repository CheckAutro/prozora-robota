-- ============================================================
-- Migration: create company_discovery_queue table
-- New companies discovered from open sources are reviewed here
-- before being added to public.companies.
-- ============================================================

create table if not exists public.company_discovery_queue (
  id                    uuid        primary key default gen_random_uuid(),
  discovered_name       text        not null,
  suggested_slug        text        not null,
  source_name           text        not null,
  source_url            text,
  city                  text,
  industry              text,
  description           text,
  company_size          text,
  matched_existing_slug text,
  match_confidence      text        default 'low'
                                      check (match_confidence in ('low', 'medium', 'high')),
  status                text        default 'needs_review'
                                      check (status in (
                                        'needs_review', 'auto_imported',
                                        'matched_existing', 'rejected'
                                      )),
  is_imported           boolean     default false,
  imported_company_slug text,
  raw_excerpt           text,
  collected_at          timestamptz default now(),
  admin_note            text,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);

comment on table public.company_discovery_queue is
  'Queue for companies discovered from open sources. Separate from public.reviews, external_ratings, external_review_signals, and company_open_facts.';

create index if not exists company_discovery_queue_suggested_slug_idx
  on public.company_discovery_queue (suggested_slug);

create index if not exists company_discovery_queue_status_idx
  on public.company_discovery_queue (status);

create index if not exists company_discovery_queue_source_name_idx
  on public.company_discovery_queue (source_name);

create index if not exists company_discovery_queue_matched_existing_slug_idx
  on public.company_discovery_queue (matched_existing_slug);

create unique index if not exists company_discovery_queue_source_url_slug_idx
  on public.company_discovery_queue (source_url, suggested_slug)
  where source_url is not null;

create or replace function public.set_company_discovery_queue_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  if new.status <> 'auto_imported' then
    new.is_imported = false;
  end if;
  if new.is_imported = true and new.status <> 'auto_imported' then
    raise exception 'is_imported=true is allowed only for auto_imported discovery rows';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_company_discovery_queue_updated_at
  on public.company_discovery_queue;

create trigger trg_company_discovery_queue_updated_at
  before update on public.company_discovery_queue
  for each row execute function public.set_company_discovery_queue_updated_at();

alter table public.company_discovery_queue enable row level security;

drop policy if exists "public read company discovery denied" on public.company_discovery_queue;
create policy "public read company discovery denied"
  on public.company_discovery_queue for select
  using (false);

drop policy if exists "public insert company discovery denied" on public.company_discovery_queue;
create policy "public insert company discovery denied"
  on public.company_discovery_queue for insert
  with check (false);
