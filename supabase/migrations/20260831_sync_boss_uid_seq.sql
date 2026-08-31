-- Sync public.boss_uid_seq to at least max(existing seq, max MCJ/B on profiles).
-- Idempotent: never rewrites existing boss_uid; never lowers the sequence.
-- Trigger only uses nextval + unique retry (no sync/setval inside trigger).

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

-- Never regress: target = greatest(current last_value, profiles max).
create or replace function public.mcj_sync_boss_uid_seq()
returns bigint
language plpgsql
as $$
declare
  max_n bigint;
  cur bigint := 0;
  target bigint;
begin
  max_n := public.mcj_max_boss_uid_number();
  begin
    select last_value into cur from public.boss_uid_seq;
  exception when others then
    cur := 0;
  end;
  if cur is null then
    cur := 0;
  end if;

  -- Keep sequence at least as high as profiles max AND current last_value.
  target := greatest(cur, max_n);

  if target < 1 then
    -- Empty world: ensure next nextval() yields 1 without forcing a regression path.
    perform setval('public.boss_uid_seq', 1, false);
    return 0;
  end if;

  -- Only bump when profiles max is ahead of sequence; never lower.
  if max_n > cur then
    perform setval('public.boss_uid_seq', max_n, true);
  end if;

  return target;
end;
$$;

-- Runtime trigger: nextval + unique retry ONLY. No MAX / setval / sync.
create or replace function public.mcj_assign_boss_uid()
returns trigger
language plpgsql
as $$
declare
  candidate text;
  guard int := 0;
begin
  if new.role = 'boss' and (new.boss_uid is null or btrim(new.boss_uid) = '') then
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

-- One-shot historical sync (also safe on re-run; never regresses).
select public.mcj_sync_boss_uid_seq();

comment on function public.mcj_sync_boss_uid_seq() is
  'Raise boss_uid_seq to max(last_value, max MCJ/B on profiles). Never lowers sequence. Never rewrites UIDs.';

comment on function public.mcj_assign_boss_uid() is
  'BEFORE INSERT/UPDATE: allocate MCJ via nextval + unique retry only (no setval/sync).';
