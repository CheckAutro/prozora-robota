-- ============================================================
-- Migration: create admin_users table
-- Run in Supabase SQL Editor (safe to re-run).
-- ============================================================

-- ── Table ─────────────────────────────────────────────────────────────────────
create table if not exists public.admin_users (
  id         uuid        primary key default gen_random_uuid(),
  email      text        unique not null,
  created_at timestamptz not null default now()
);

-- ── RLS ───────────────────────────────────────────────────────────────────────
-- Public access completely blocked.
-- Reads / writes only via service-role (bypasses RLS).

alter table public.admin_users enable row level security;

drop policy if exists "admin_users_no_public_read"   on public.admin_users;
drop policy if exists "admin_users_no_public_insert" on public.admin_users;

create policy "admin_users_no_public_read"
  on public.admin_users for select
  using (false);

create policy "admin_users_no_public_insert"
  on public.admin_users for insert
  with check (false);

-- ── How to add the first admin ────────────────────────────────────────────────
-- 1. Create a Supabase Auth user via Dashboard → Authentication → Users
--    (use the email + password you want to log in with).
-- 2. Run the INSERT below with that email:
--
--    insert into public.admin_users (email) values ('your@email.com');
--
-- 3. The user can now log in at /login and access /admin.
