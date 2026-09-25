-- Unlimited companion apply media: allow achievement rows + keep video appendable.
-- Safe to re-run. Does not change file size / MIME safety limits.

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
  check (media_type in ('avatar','cover','gallery','voice','video','achievement'));

comment on column public.companion_media.media_type is
  'avatar|cover|gallery|voice|video|achievement — gallery/video/achievement are multi-row (no count cap).';
