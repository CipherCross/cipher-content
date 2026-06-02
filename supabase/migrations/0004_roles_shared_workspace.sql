-- Shift from per-user ownership to a SHARED workspace with roles.
--
-- Everyone who can log in sees the same accounts, campaigns and posts (full
-- visibility + edit). Only admins can manage users.
--
-- `accounts.user_id` is kept but is now just "created_by" (informational); it
-- no longer gates access.

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------
create type user_role as enum ('admin', 'member');
alter table public.users add column role user_role not null default 'member';

-- SECURITY DEFINER so it bypasses RLS — calling it inside a policy on `users`
-- would otherwise recurse. `stable` lets the planner cache it per statement.
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.users where id = auth.uid() and role = 'admin'
  );
$$;

-- ---------------------------------------------------------------------------
-- Drop the old per-owner policies
-- ---------------------------------------------------------------------------
drop policy if exists "accounts_all_own"  on public.accounts;
drop policy if exists "campaigns_all_own" on public.campaigns;
drop policy if exists "posts_all_own"     on public.posts;
drop policy if exists "users_select_own"  on public.users;
drop policy if exists "users_update_own"  on public.users;

-- ---------------------------------------------------------------------------
-- Shared content: any authenticated user has full read/write
-- ---------------------------------------------------------------------------
create policy "accounts_shared" on public.accounts
  for all to authenticated using (true) with check (true);

create policy "campaigns_shared" on public.campaigns
  for all to authenticated using (true) with check (true);

create policy "posts_shared" on public.posts
  for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------------
-- Users: everyone can read the roster; only admins can mutate.
-- (Creation/deletion of auth users goes through the admin-users Edge Function
-- using the service role, which bypasses RLS anyway. These policies guard
-- against members poking the profile table directly.)
-- ---------------------------------------------------------------------------
create policy "users_select_all" on public.users
  for select to authenticated using (true);

create policy "users_admin_update" on public.users
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "users_admin_delete" on public.users
  for delete to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------------
-- Bootstrap your admin account.
-- The first admin cannot be created from the UI (that requires being an admin),
-- so promote yourself ONCE here. Edit the email to match your login, then run.
-- ---------------------------------------------------------------------------
-- update public.users set role = 'admin' where email = 'you@example.com';
