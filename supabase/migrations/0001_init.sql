-- Cipher Content — initial schema
-- Entities: users -> accounts -> campaigns -> posts
-- All data is scoped to the owning user via RLS.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type platform as enum ('linkedin');
create type campaign_status as enum ('draft', 'active', 'completed');
-- Content readiness is a linear chain: pending -> generated -> approved -> posted.
-- scheduled_at is an independent field, NOT part of this enum.
create type post_status as enum ('pending', 'generated', 'approved', 'posted');

-- ---------------------------------------------------------------------------
-- users (profile row mirroring auth.users)
-- ---------------------------------------------------------------------------
create table public.users (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  -- IANA tz; defaults to CET. The UI prefers the browser tz when present.
  timezone    text not null default 'Europe/Paris',
  created_at  timestamptz not null default now()
);

-- Auto-create a profile row when an auth user signs up.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- accounts
-- ---------------------------------------------------------------------------
create table public.accounts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users (id) on delete cascade,
  platform      platform not null default 'linkedin',
  display_name  text not null,
  -- Optional convenience link to the profile; not used for any automation.
  linkedin_url  text,
  created_at    timestamptz not null default now()
);
create index accounts_user_id_idx on public.accounts (user_id);

-- ---------------------------------------------------------------------------
-- campaigns
-- ---------------------------------------------------------------------------
create table public.campaigns (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts (id) on delete cascade,
  title       text not null,
  description text not null default '',
  status      campaign_status not null default 'draft',
  created_at  timestamptz not null default now()
);
create index campaigns_account_id_idx on public.campaigns (account_id);

-- ---------------------------------------------------------------------------
-- posts (a `pending` post with no body = a planned-but-ungenerated slot)
-- ---------------------------------------------------------------------------
create table public.posts (
  id            uuid primary key default gen_random_uuid(),
  campaign_id   uuid not null references public.campaigns (id) on delete cascade,
  theme         text not null,
  position      integer not null default 0,
  body          text not null default '',
  image_url     text,                       -- optional Google Drive URL
  status        post_status not null default 'pending',
  scheduled_at  timestamptz,                -- UTC; independent of status
  posted_at     timestamptz,
  created_at    timestamptz not null default now()
);
create index posts_campaign_id_idx on public.posts (campaign_id);
create index posts_scheduled_at_idx on public.posts (scheduled_at);

-- ---------------------------------------------------------------------------
-- Row-Level Security — every table is scoped to the owning user.
-- ---------------------------------------------------------------------------
alter table public.users     enable row level security;
alter table public.accounts  enable row level security;
alter table public.campaigns enable row level security;
alter table public.posts     enable row level security;

-- users: a user can only read/update their own profile row.
create policy "users_select_own" on public.users
  for select using (id = auth.uid());
create policy "users_update_own" on public.users
  for update using (id = auth.uid());

-- accounts: owned directly via user_id.
create policy "accounts_all_own" on public.accounts
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- campaigns: owned transitively through the parent account.
create policy "campaigns_all_own" on public.campaigns
  for all using (
    exists (
      select 1 from public.accounts a
      where a.id = campaigns.account_id and a.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.accounts a
      where a.id = campaigns.account_id and a.user_id = auth.uid()
    )
  );

-- posts: owned transitively through campaign -> account.
create policy "posts_all_own" on public.posts
  for all using (
    exists (
      select 1 from public.campaigns c
      join public.accounts a on a.id = c.account_id
      where c.id = posts.campaign_id and a.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.campaigns c
      join public.accounts a on a.id = c.account_id
      where c.id = posts.campaign_id and a.user_id = auth.uid()
    )
  );
