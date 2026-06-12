-- Storage bucket for post images: public read (previews render without signed
-- URLs), authenticated write. The workspace is shared (see 0004), so any
-- logged-in user may manage any object in this bucket.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'post-images',
  'post-images',
  true,
  5242880, -- 5 MB
  array['image/png', 'image/jpeg', 'image/gif', 'image/webp']
)
on conflict (id) do nothing;

create policy "post_images_public_read" on storage.objects
  for select using (bucket_id = 'post-images');

create policy "post_images_auth_insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'post-images');

create policy "post_images_auth_update" on storage.objects
  for update to authenticated using (bucket_id = 'post-images');

create policy "post_images_auth_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'post-images');
