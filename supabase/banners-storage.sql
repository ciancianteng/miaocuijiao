-- Homepage Banner Storage bucket
-- Run in Supabase SQL editor if auto-create fails from API.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'banners',
  'banners',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = true,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Public read for homepage <img> tags
do $$ begin
  create policy "banners_public_read"
    on storage.objects for select
    using (bucket_id = 'banners');
exception when duplicate_object then null; end $$;

-- Service role / admin writes are handled via service key; keep insert/update for authenticated admins if needed
do $$ begin
  create policy "banners_admin_write"
    on storage.objects for insert
    with check (
      bucket_id = 'banners'
      and public.mcj_current_role() in ('admin', 'super_admin')
    );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "banners_admin_update"
    on storage.objects for update
    using (
      bucket_id = 'banners'
      and public.mcj_current_role() in ('admin', 'super_admin')
    )
    with check (
      bucket_id = 'banners'
      and public.mcj_current_role() in ('admin', 'super_admin')
    );
exception when duplicate_object then null; end $$;
