-- Post performance stats, reported manually by the SDR.
--
-- Every report is a NEW snapshot row (LinkedIn numbers grow over weeks, so
-- re-reports differ from earlier ones). The UI shows the latest snapshot per
-- post; history is kept for future trend views and so a typo never destroys
-- the previous value.

create table public.post_stats (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references public.posts (id) on delete cascade,
  views       integer not null check (views >= 0),
  likes       integer not null check (likes >= 0),
  comments    integer not null check (comments >= 0),
  recorded_at timestamptz not null default now(),
  recorded_by uuid references public.users (id) on delete set null
);

-- Latest-snapshot lookups: per post, newest first.
create index post_stats_post_id_idx on public.post_stats (post_id, recorded_at desc);

-- Shared-workspace access, same model as 0004: any authenticated user has
-- full read/write.
alter table public.post_stats enable row level security;

create policy "post_stats_shared" on public.post_stats
  for all to authenticated using (true) with check (true);
