-- Sync public.boss_uid_seq to >= max MCJ##### / legacy B##### on profiles.
-- Idempotent: never rewrites existing boss_uid values; safe to re-run.
-- Also harden mcj_assign_boss_uid() to sync + loop until unique (prevents orphan from unique collisions).

create sequence if not exists public.boss_uid_seq
  as bigint
  start with 1
  increment by 1
  minvalue 1
  no maxvalue
  cache 1;

create or replace function public.mcj_max_boss_uid_number()
returns bigint
language sql
stable
as $$
  select coalesce(max(n), 0)::bigint
  from (
    select case
      when boss_uid ~* '^MCJ[0-9]+$' then nullif(regexp_replace(boss_uid, '^MCJ0*', '', 'i'), '')::bigint
      when boss_uid ~* '^B[0-9]+$' then
        case
          when nullif(regexp_replace(boss_uid, '^B', '', 'i'), '')::bigint >= 100001
            then nullif(regexp_replace(boss_uid, '^B', '', 'i'), '')::bigint - 100000
          else nullif(regexp_replace(boss_uid, '^B', '', 'i'), '')::bigint
        end
      else null
    end as n
    from public.profiles
    where boss_uid is not null
      and btrim(boss_uid) <> ''
  ) s
  where n is not null and n > 0;
$$;

create or replace function public.mcj_sync_boss_uid_seq()
returns bigint
language plpgsql
as $$
declare
  max_n bigint;
  cur bigint;
begin
  max_n := public.mcj_max_boss_uid_number();
  if max_n < 1 then
    -- next nextval() should yield 1
    perform setval('public.boss_uid_seq', 1, false);
    return 0;
  end if;
  -- Prefer reading current last_value when sequence already used.
  begin
    select last_value into cur from public.boss_uid_seq;
  exception when others then
    cur := 0;
  end;
  if cur is null or cur < max_n then
    perform setval('public.boss_uid_seq', max_n, true);
  end if;
  return max_n;
end;
$$;

create or replace function public.mcj_assign_boss_uid()
returns trigger
language plpgsql
as $$
declare
  candidate text;
  guard int := 0;
begin
  if new.role = 'boss' and (new.boss_uid is null or btrim(new.boss_uid) = '') then
    perform public.mcj_sync_boss_uid_seq();
    loop
      guard := guard + 1;
      if guard > 64 then
        raise exception 'mcj_assign_boss_uid: unable to allocate unique boss_uid';
      end if;
      candidate := 'MCJ' || lpad(nextval('public.boss_uid_seq')::text, 5, '0');
      exit when not exists (
        select 1 from public.profiles p
        where p.boss_uid = candidate
          and (tg_op = 'INSERT' or p.id is distinct from new.id)
      );
    end loop;
    new.boss_uid := candidate;
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

-- One-shot sync now (also safe on re-run).
select public.mcj_sync_boss_uid_seq();

comment on function public.mcj_sync_boss_uid_seq() is
  'Raise boss_uid_seq last_value to max existing MCJ/B numeric on profiles; never rewrites UIDs.';
