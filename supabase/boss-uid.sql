-- Boss public UID: sequential MCJ00001+
-- Prefer: supabase/migrations/20260803_account_codes_mcj_pw.sql

create sequence if not exists public.boss_uid_seq
  as bigint
  start with 1
  increment by 1
  minvalue 1
  no maxvalue
  cache 1;

alter table public.profiles
  add column if not exists boss_uid text;

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

create unique index if not exists profiles_boss_uid_unique_idx
  on public.profiles (boss_uid)
  where boss_uid is not null and btrim(boss_uid) <> '';

create index if not exists profiles_boss_uid_idx
  on public.profiles (boss_uid);

notify pgrst, 'reload schema';
