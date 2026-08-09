-- Allow companion showcase video in companion_media + dedicated private video bucket.
-- Safe to re-run.

do $$
declare
  conname text;
begin
  select c.conname into conname
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public'
    and t.relname = 'companion_media'
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) ilike '%media_type%';
  if conname is not null then
    execute format('alter table public.companion_media drop constraint %I', conname);
  end if;
exception when others then
  null;
end $$;

alter table public.companion_media
  drop constraint if exists companion_media_media_type_check;

alter table public.companion_media
  add constraint companion_media_media_type_check
  check (media_type in ('avatar','cover','gallery','voice','video'));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'companion-video',
  'companion-video',
  false,
  41943040,
  array['video/mp4','video/quicktime','video/webm','video/x-m4v','application/octet-stream']
)
on conflict (id) do update
set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
