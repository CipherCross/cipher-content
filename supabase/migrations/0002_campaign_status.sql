-- Campaign status is derived from its posts (it was previously a static
-- 'draft' that nothing ever updated, so campaigns stayed 'draft' even when
-- their posts were approved/posted).
--
-- Rules:
--   no posts, or all posts still `pending`  -> draft     (setup phase)
--   at least one post generated/approved/posted, not all posted -> active
--   at least one post and ALL posts posted   -> completed
--
-- Maintained by a trigger on the posts table so the stored campaign.status
-- (read by the UI badges) is always correct.

create or replace function public.recompute_campaign_status(p_campaign_id uuid)
returns void
language plpgsql
as $$
declare
  total      int;
  posted_cnt int;
  active_cnt int;  -- generated, approved or posted
  new_status campaign_status;
begin
  select
    count(*),
    count(*) filter (where status = 'posted'),
    count(*) filter (where status in ('generated', 'approved', 'posted'))
  into total, posted_cnt, active_cnt
  from public.posts
  where campaign_id = p_campaign_id;

  if total = 0 or active_cnt = 0 then
    new_status := 'draft';
  elsif posted_cnt = total then
    new_status := 'completed';
  else
    new_status := 'active';
  end if;

  update public.campaigns
  set status = new_status
  where id = p_campaign_id and status is distinct from new_status;
end;
$$;

create or replace function public.posts_sync_campaign_status()
returns trigger
language plpgsql
as $$
begin
  if (tg_op = 'DELETE') then
    perform public.recompute_campaign_status(old.campaign_id);
    return old;
  end if;

  perform public.recompute_campaign_status(new.campaign_id);
  -- handle a post moving between campaigns
  if (tg_op = 'UPDATE' and new.campaign_id is distinct from old.campaign_id) then
    perform public.recompute_campaign_status(old.campaign_id);
  end if;
  return new;
end;
$$;

create trigger posts_sync_campaign_status
  after insert or update or delete on public.posts
  for each row execute function public.posts_sync_campaign_status();

-- Backfill existing campaigns so current data is corrected immediately.
do $$
declare c record;
begin
  for c in select id from public.campaigns loop
    perform public.recompute_campaign_status(c.id);
  end loop;
end $$;
