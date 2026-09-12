-- Formal account codes: boss MCJ00001+, companion PW00001+ (after approve).
-- Safe to re-run. Compatible with DBs missing legacy companion_uid.

-- 0) Ensure boss_uid column exists
alter table public.profiles
  add column if not exists boss_uid text;

create sequence if not exists public.boss_uid_seq
  as bigint
  start with 1
  increment by 1
  minvalue 1
  no maxvalue
  cache 1;

alter sequence public.boss_uid_seq minvalue 1;

create or replace function public.mcj_assign_boss_uid()
returns trigger
language plpgsql
as $$
begin
  if new.role = 'boss' and (new.boss_uid is null or btrim(new.boss_uid) = '') then
    new.boss_uid := 'MCJ' || lpad(nextval('public.boss_uid_seq')::text, 5, '0');
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

-- Migrate legacy B100001 → MCJ00001
do $$
declare
  r record;
  n bigint;
  next_code text;
  max_n bigint := 0;
begin
  for r in
    select id, boss_uid
    from public.profiles
    where role = 'boss'
      and boss_uid is not null
      and btrim(boss_uid) <> ''
      and boss_uid ~* '^B[0-9]+$'
    order by created_at asc nulls last, id asc
  loop
    n := regexp_replace(r.boss_uid, '^B', '', 'i')::bigint;
    if n >= 100001 then
      n := n - 100000;
    end if;
    if n < 1 then n := 1; end if;
    next_code := 'MCJ' || lpad(n::text, 5, '0');
    while exists (
      select 1 from public.profiles p
      where p.boss_uid = next_code and p.id <> r.id
    ) loop
      n := n + 1;
      next_code := 'MCJ' || lpad(n::text, 5, '0');
    end loop;
    update public.profiles set boss_uid = next_code where id = r.id;
    if n > max_n then max_n := n; end if;
  end loop;

  for r in
    select id
    from public.profiles
    where role = 'boss'
      and (boss_uid is null or btrim(boss_uid) = '')
    order by created_at asc nulls last, id asc
  loop
    update public.profiles
      set boss_uid = 'MCJ' || lpad(nextval('public.boss_uid_seq')::text, 5, '0')
      where id = r.id
        and (boss_uid is null or btrim(boss_uid) = '');
  end loop;

  select coalesce(max(
    case
      when boss_uid ~* '^MCJ[0-9]+$' then nullif(regexp_replace(boss_uid, '^MCJ0*', '', 'i'), '')::bigint
      else 0
    end
  ), 0) into max_n
  from public.profiles
  where role = 'boss' and boss_uid is not null;

  if max_n < 1 then
    perform setval('public.boss_uid_seq', 1, false);
  else
    perform setval('public.boss_uid_seq', max_n, true);
  end if;
end $$;

create unique index if not exists profiles_boss_uid_unique_idx
  on public.profiles (boss_uid)
  where boss_uid is not null and btrim(boss_uid) <> '';

create index if not exists profiles_boss_uid_idx
  on public.profiles (boss_uid);

-- 2) Companion formal code
create sequence if not exists public.companion_code_seq
  as bigint
  start with 1
  increment by 1
  minvalue 1
  no maxvalue
  cache 1;

alter table public.companion_profiles
  add column if not exists companion_code text;

-- Optional legacy numeric uid (do not fail if marketplace SQL not applied)
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'companion_profiles' and column_name = 'companion_uid'
  ) then
    alter table public.companion_profiles add column companion_uid bigint;
  end if;
end $$;

create or replace function public.mcj_allocate_companion_code()
returns text
language plpgsql
as $$
declare
  code text;
  n bigint;
begin
  loop
    n := nextval('public.companion_code_seq');
    code := 'PW' || lpad(n::text, 5, '0');
    exit when not exists (
      select 1 from public.companion_profiles where companion_code = code
    );
  end loop;
  return code;
end;
$$;

-- Backfill codes for approved / existing companions (no hard dependency on companion_uid values)
do $$
declare
  r record;
  code text;
  max_n bigint := 0;
  n bigint;
  has_uid boolean;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'companion_profiles' and column_name = 'companion_uid'
  ) into has_uid;

  for r in
    select id, companion_code, created_at
    from public.companion_profiles
    where companion_code is null or btrim(companion_code) = ''
    order by created_at asc nulls last, id asc
  loop
    n := nextval('public.companion_code_seq');
    code := 'PW' || lpad(n::text, 5, '0');
    while exists (
      select 1 from public.companion_profiles p
      where p.companion_code = code and p.id <> r.id
    ) loop
      n := nextval('public.companion_code_seq');
      code := 'PW' || lpad(n::text, 5, '0');
    end loop;
    update public.companion_profiles set companion_code = code where id = r.id;
    if n > max_n then max_n := n; end if;
  end loop;

  -- Prefer remapping from companion_uid when present and code still blank (already handled above)
  if has_uid then
    null; -- reserved: uid-based remaps already optional
  end if;

  select coalesce(max(
    case
      when companion_code ~* '^PW[0-9]+$' then nullif(regexp_replace(companion_code, '^PW0*', '', 'i'), '')::bigint
      else 0
    end
  ), 0) into max_n
  from public.companion_profiles
  where companion_code is not null;

  if max_n < 1 then
    perform setval('public.companion_code_seq', 1, false);
  else
    perform setval('public.companion_code_seq', max_n, true);
  end if;
end $$;

create unique index if not exists companion_profiles_companion_code_uidx
  on public.companion_profiles (companion_code)
  where companion_code is not null and btrim(companion_code) <> '';

notify pgrst, 'reload schema';
