-- Boss public UID: sequential B100001+
-- Run in Supabase SQL Editor.

create sequence if not exists public.boss_uid_seq
  as bigint
  start with 100001
  increment by 1
  minvalue 100001
  no maxvalue
  cache 1;

alter table public.profiles
  add column if not exists boss_uid text;

-- Assign boss_uid only for boss role when empty
create or replace function public.mcj_assign_boss_uid()
returns trigger
language plpgsql
as $$
begin
  if new.role = 'boss' and (new.boss_uid is null or btrim(new.boss_uid) = '') then
    new.boss_uid := 'B' || nextval('public.boss_uid_seq')::text;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_assign_boss_uid on public.profiles;
create trigger trg_profiles_assign_boss_uid
  before insert or update of role, boss_uid
  on public.profiles
  for each row
  execute function public.mcj_assign_boss_uid();

-- Backfill existing bosses by created_at (earliest first). Skip rows that already have boss_uid.
do $$
declare
  r record;
  next_n bigint;
begin
  -- Advance sequence past any existing numeric suffixes so new UIDs won't collide.
  select coalesce(max(nullif(regexp_replace(boss_uid, '^B', ''), '')::bigint), 100000)
    into next_n
  from public.profiles
  where role = 'boss'
    and boss_uid ~ '^B[0-9]+$';

  if next_n >= 100001 then
    perform setval('public.boss_uid_seq', next_n, true);
  end if;

  for r in
    select id
    from public.profiles
    where role = 'boss'
      and (boss_uid is null or btrim(boss_uid) = '')
    order by created_at asc nulls last, id asc
  loop
    update public.profiles
      set boss_uid = 'B' || nextval('public.boss_uid_seq')::text
      where id = r.id
        and (boss_uid is null or btrim(boss_uid) = '');
  end loop;
end $$;

-- Unique among non-null values
create unique index if not exists profiles_boss_uid_unique_idx
  on public.profiles (boss_uid)
  where boss_uid is not null and btrim(boss_uid) <> '';

create index if not exists profiles_boss_uid_idx
  on public.profiles (boss_uid);

notify pgrst, 'reload schema';
