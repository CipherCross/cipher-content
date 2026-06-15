-- Articles — long-form content authored in Markdown for the Framer website
-- builder. Framer's CMS rich-text field accepts pasted Markdown and converts
-- it to formatted content, so the body is stored as Markdown and the app
-- offers a "Copy as Markdown" action for pasting straight into Framer.
--
-- Lifecycle is simpler than posts (no AI/approval chain):
--   draft      -- created with just a title; edited freely (autosaved)
--   scheduled  -- writer picked a posting date/time (scheduled_at set)
--   posted     -- marked posted from the Today queue (posted_at set)
--
-- Articles are standalone (not tied to an account/campaign): they target the
-- shared Framer site, not a per-account LinkedIn profile.

create type article_status as enum ('draft', 'scheduled', 'posted');

create table public.articles (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  body          text not null default '',   -- Markdown (Framer-compatible)
  -- Optional cover image: a Google Drive link or an uploaded object in the
  -- shared `post-images` bucket (reused; see 0005).
  image_url     text,
  status        article_status not null default 'draft',
  scheduled_at  timestamptz,                -- UTC; set when scheduled
  posted_at     timestamptz,                -- set when marked posted
  created_by    uuid references public.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
-- Today/Calendar lookups walk by date; lists group by status.
create index articles_scheduled_at_idx on public.articles (scheduled_at);
create index articles_status_idx on public.articles (status);

-- Keep updated_at honest even if a client forgets to set it.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger articles_touch_updated_at
  before update on public.articles
  for each row execute function public.touch_updated_at();

-- Shared-workspace access, same model as 0004/0006: any authenticated user
-- has full read/write.
alter table public.articles enable row level security;

create policy "articles_shared" on public.articles
  for all to authenticated using (true) with check (true);
