-- Public Storage bucket for boss review screenshots.
-- Idempotent: safe to run more than once, and safe if the API already created the bucket at runtime.
-- Uploads go through /api/orders with the service role and reads use public URLs,
-- so no storage.objects policies are needed.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('review-images', 'review-images', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
