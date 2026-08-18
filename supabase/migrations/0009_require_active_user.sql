-- A deleted auth user can retain an already-issued JWT until that token
-- expires. Require a corresponding live profile for every shared-workspace
-- read/write so deleting public.users revokes access immediately.

create or replace function public.is_active_user()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.users where id = auth.uid()
  );
$$;

revoke all on function public.is_active_user() from public;
grant execute on function public.is_active_user() to authenticated;

alter policy "users_select_all" on public.users
  using (public.is_active_user());

alter policy "accounts_shared" on public.accounts
  using (public.is_active_user())
  with check (public.is_active_user());

alter policy "campaigns_shared" on public.campaigns
  using (public.is_active_user())
  with check (public.is_active_user());

alter policy "posts_shared" on public.posts
  using (public.is_active_user())
  with check (public.is_active_user());

alter policy "post_stats_shared" on public.post_stats
  using (public.is_active_user())
  with check (public.is_active_user());

alter policy "articles_shared" on public.articles
  using (public.is_active_user())
  with check (public.is_active_user());

alter policy "post_images_auth_insert" on storage.objects
  with check (
    bucket_id = 'post-images' and public.is_active_user()
  );

alter policy "post_images_auth_update" on storage.objects
  using (
    bucket_id = 'post-images' and public.is_active_user()
  )
  with check (
    bucket_id = 'post-images' and public.is_active_user()
  );

alter policy "post_images_auth_delete" on storage.objects
  using (
    bucket_id = 'post-images' and public.is_active_user()
  );
