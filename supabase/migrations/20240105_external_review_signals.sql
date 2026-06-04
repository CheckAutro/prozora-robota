-- Migration: create external_review_signals table
--
-- This table stores short admin-verified summaries of the meaning of external
-- reviews. It is not public.reviews, external_ratings, external_signals, or
-- company_open_facts, and it must never affect internal ratings or review count.

create table if not exists public.external_review_signals (
  id uuid primary key default gen_random_uuid(),
  company_slug text not null,
  company_name text not null,
  source_name text not null,
  source_url text,
  topic text not null default 'other',
  sentiment text not null default 'neutral',
  summary text not null,
  mentions_count integer default 1,
  sample_size integer,
  confidence text default 'medium',
  collected_at timestamptz default now(),
  status text default 'needs_verification',
  is_public boolean default false,
  admin_note text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint external_review_signals_topic_check check (
    topic in (
      'salary',
      'schedule',
      'employment',
      'management',
      'workload',
      'payment_delay',
      'interview',
      'booking',
      'benefits',
      'career',
      'culture',
      'other'
    )
  ),
  constraint external_review_signals_sentiment_check check (
    sentiment in ('positive', 'mixed', 'negative', 'neutral')
  ),
  constraint external_review_signals_confidence_check check (
    confidence in ('low', 'medium', 'high')
  ),
  constraint external_review_signals_status_check check (
    status in ('needs_verification', 'verified', 'rejected')
  ),
  constraint external_review_signals_mentions_count_check check (
    mentions_count is null or mentions_count >= 0
  ),
  constraint external_review_signals_sample_size_check check (
    sample_size is null or sample_size >= 0
  ),
  constraint external_review_signals_summary_length_check check (
    char_length(trim(summary)) between 20 and 300
  )
);

comment on table public.external_review_signals is
  'Admin-verified short summaries of meaning from external reviews. Not internal reviews or ratings.';

create index if not exists external_review_signals_company_slug_idx
  on public.external_review_signals (company_slug);

create index if not exists external_review_signals_source_name_idx
  on public.external_review_signals (source_name);

create index if not exists external_review_signals_topic_idx
  on public.external_review_signals (topic);

create index if not exists external_review_signals_sentiment_idx
  on public.external_review_signals (sentiment);

create index if not exists external_review_signals_status_idx
  on public.external_review_signals (status);

create index if not exists external_review_signals_is_public_idx
  on public.external_review_signals (is_public);

create unique index if not exists external_review_signals_exact_summary_idx
  on public.external_review_signals (
    company_slug,
    lower(source_name),
    topic,
    lower(summary)
  );

create or replace function public.set_external_review_signals_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  if new.status <> 'verified' then
    new.is_public = false;
  end if;
  if new.is_public = true and new.status <> 'verified' then
    raise exception 'is_public=true is allowed only for verified external_review_signals';
  end if;
  if new.is_public = true and nullif(trim(coalesce(new.source_url, '')), '') is null then
    raise exception 'public external_review_signals require source_url';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_external_review_signals_updated_at
  on public.external_review_signals;

create trigger trg_external_review_signals_updated_at
  before insert or update on public.external_review_signals
  for each row execute function public.set_external_review_signals_updated_at();

alter table public.external_review_signals enable row level security;

drop policy if exists "public read verified external review signals" on public.external_review_signals;
create policy "public read verified external review signals"
  on public.external_review_signals for select
  using (status = 'verified' and is_public = true);

drop policy if exists "public insert external review signals denied" on public.external_review_signals;
create policy "public insert external review signals denied"
  on public.external_review_signals for insert
  with check (false);
