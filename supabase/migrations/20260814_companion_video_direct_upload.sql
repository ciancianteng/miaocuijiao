-- Companion showcase video: 50MB bucket + authenticated direct/TUS upload to own folder.
-- Safe to re-run. Service role uploads remain unaffected.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'companion-video',
  'companion-video',
  false,
  52428800,
  array['video/mp4','video/quicktime','video/webm','video/x-m4v','application/octet-stream']
)
on conflict (id) do update
set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types,
  public = false;

-- Path layout: {auth.uid()}/video/...
drop policy if exists companion_video_insert_own on storage.objects;
create policy companion_video_insert_own
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'companion-video'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists companion_video_update_own on storage.objects;
create policy companion_video_update_own
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'companion-video'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'companion-video'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists companion_video_select_own on storage.objects;
create policy companion_video_select_own
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'companion-video'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
