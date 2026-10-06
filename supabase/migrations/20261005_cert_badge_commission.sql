-- Certification badges as a commission group + statistics attribution.
-- Additive / idempotent. Never deletes badge rows, assignment rows or order rows.
--
--   companion_cert_tags              + unified companion share %, commission priority, audit
--   companion_cert_tag_assignments   ledger: active → pending_removal → removed (who/when/why)
--   companion_cert_tag_commission_log  every unified-commission change
--   orders.cert_badge_snapshot       badges + commission badge frozen when the companion is bound
--
-- Apply on STAGING only (cfccwysniduwkjskiqgy). Production goes through pending-prod review.

create extension if not exists pgcrypto;

-- 1) Badge catalog ---------------------------------------------------------
create table if not exists public.companion_cert_tags (
  id text primary key,
  name text not null,
  icon text not null default '🏷️',
  color text not null default '#ff6b9d',
  sort_order integer not null default 100,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.companion_cert_tags add column if not exists companion_share_rate numeric(5,2);
alter table public.companion_cert_tags add column if not exists commission_priority integer not null default 100;
alter table public.companion_cert_tags add column if not exists commission_updated_at timestamptz;
alter table public.companion_cert_tags add column if not exists commission_updated_by uuid;

do $$ begin
  alter table public.companion_cert_tags
    add constraint companion_cert_tags_share_rate_range
    check (companion_share_rate is null or (companion_share_rate >= 0 and companion_share_rate <= 100));
exception when duplicate_object then null; end $$;

-- 2) Assignment ledger -----------------------------------------------------
create table if not exists public.companion_cert_tag_assignments (
  companion_profile_id uuid not null,
  tag_id text not null,
  created_at timestamptz not null default now()
);

alter table public.companion_cert_tag_assignments add column if not exists id uuid default gen_random_uuid();
update public.companion_cert_tag_assignments set id = gen_random_uuid() where id is null;
alter table public.companion_cert_tag_assignments alter column id set not null;

alter table public.companion_cert_tag_assignments add column if not exists status text not null default 'active';
alter table public.companion_cert_tag_assignments add column if not exists is_commission_primary boolean not null default false;
alter table public.companion_cert_tag_assignments add column if not exists granted_at timestamptz;
alter table public.companion_cert_tag_assignments add column if not exists granted_by uuid;
alter table public.companion_cert_tag_assignments add column if not exists granted_by_name text not null default '';
alter table public.companion_cert_tag_assignments add column if not exists removal_requested_at timestamptz;
alter table public.companion_cert_tag_assignments add column if not exists removal_requested_by uuid;
alter table public.companion_cert_tag_assignments add column if not exists removal_requested_by_name text not null default '';
alter table public.companion_cert_tag_assignments add column if not exists removal_reason text not null default '';
alter table public.companion_cert_tag_assignments add column if not exists removal_approved_at timestamptz;
alter table public.companion_cert_tag_assignments add column if not exists removal_approved_by uuid;
alter table public.companion_cert_tag_assignments add column if not exists removal_approved_by_name text not null default '';
alter table public.companion_cert_tag_assignments add column if not exists removed_at timestamptz;
alter table public.companion_cert_tag_assignments add column if not exists updated_at timestamptz not null default now();

update public.companion_cert_tag_assignments set granted_at = coalesce(granted_at, created_at) where granted_at is null;

do $$ begin
  alter table public.companion_cert_tag_assignments
    add constraint companion_cert_tag_assignments_status_chk
    check (status in ('active', 'pending_removal', 'removed'));
exception when duplicate_object then null; end $$;

-- History rows (removed → re-granted) need their own identity: move the PK to id.
do $$
declare pk_name text;
begin
  select conname into pk_name
    from pg_constraint
   where conrelid = 'public.companion_cert_tag_assignments'::regclass and contype = 'p';
  if pk_name is not null then
    if not exists (
      select 1 from pg_constraint c
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
       where c.conname = pk_name and c.conrelid = 'public.companion_cert_tag_assignments'::regclass
       group by c.conname having count(*) = 1 and bool_and(a.attname = 'id')
    ) then
      execute format('alter table public.companion_cert_tag_assignments drop constraint %I', pk_name);
      alter table public.companion_cert_tag_assignments add primary key (id);
    end if;
  else
    alter table public.companion_cert_tag_assignments add primary key (id);
  end if;
end $$;

-- Plain unique constraints on (profile, tag) would block history rows.
do $$
declare r record;
begin
  for r in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.companion_cert_tag_assignments'::regclass and c.contype = 'u'
  loop
    execute format('alter table public.companion_cert_tag_assignments drop constraint %I', r.conname);
  end loop;
end $$;

create unique index if not exists idx_cert_assign_one_open
  on public.companion_cert_tag_assignments (companion_profile_id, tag_id)
  where status in ('active', 'pending_removal');
create unique index if not exists idx_cert_assign_one_primary
  on public.companion_cert_tag_assignments (companion_profile_id)
  where is_commission_primary = true and status in ('active', 'pending_removal');
create index if not exists idx_cert_assign_tag_status
  on public.companion_cert_tag_assignments (tag_id, status);

-- 3) Commission change log -------------------------------------------------
create table if not exists public.companion_cert_tag_commission_log (
  id uuid primary key default gen_random_uuid(),
  tag_id text not null,
  old_rate numeric(5,2),
  new_rate numeric(5,2),
  changed_by uuid,
  changed_by_name text not null default '',
  changed_at timestamptz not null default now()
);
create index if not exists idx_cert_commission_log_tag on public.companion_cert_tag_commission_log (tag_id, changed_at desc);

-- 4) Order attribution snapshot -------------------------------------------
alter table public.orders add column if not exists cert_badge_snapshot jsonb;
alter table public.orders add column if not exists settlement_status text;
create index if not exists idx_orders_cert_badge_snapshot
  on public.orders using gin (cert_badge_snapshot jsonb_path_ops)
  where cert_badge_snapshot is not null;

-- 4b) Freeze the snapshot on every path that binds a companion (insert or companion_id change).
--     Same shape as server/api/_cert-badge-ledger.js badgeSnapshotFrom(). Never blocks the order write.
create or replace function public.mcj_cert_badge_snapshot_for(p_companion_user text, p_stage text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_profile text;
  v_badges jsonb;
  v_ids jsonb;
  v_pick record;
  v_commission jsonb := null;
begin
  if p_companion_user is null or p_companion_user = '' then return null; end if;
  select cp.id::text into v_profile from public.companion_profiles cp where cp.user_id::text = p_companion_user limit 1;
  if v_profile is null then return null; end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.sort_order, t.id), '[]'::jsonb),
         coalesce(jsonb_agg(to_jsonb(t.id) order by t.sort_order, t.id), '[]'::jsonb)
    into v_badges, v_ids
    from public.companion_cert_tag_assignments a
    join public.companion_cert_tags t on t.id = a.tag_id
   where a.companion_profile_id::text = v_profile
     and a.status in ('active', 'pending_removal');
  if jsonb_array_length(v_badges) = 0 then return null; end if;

  select t.id, t.name, t.companion_share_rate,
         case when a.is_commission_primary then 'primary' else 'priority' end as rule
    into v_pick
    from public.companion_cert_tag_assignments a
    join public.companion_cert_tags t on t.id = a.tag_id
   where a.companion_profile_id::text = v_profile
     and a.status in ('active', 'pending_removal')
     and t.is_enabled = true
     and t.companion_share_rate is not null
   order by a.is_commission_primary desc, t.commission_priority asc, t.sort_order asc, t.id asc
   limit 1;
  if found then
    v_commission := jsonb_build_object(
      'badgeId', v_pick.id,
      'badgeName', v_pick.name,
      'companionShareRate', round(v_pick.companion_share_rate, 2),
      'platformRate', round(100 - v_pick.companion_share_rate, 2),
      'rule', v_pick.rule
    );
  end if;

  return jsonb_build_object(
    'v', 1,
    'stage', coalesce(p_stage, ''),
    'capturedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'companionId', p_companion_user,
    'companionProfileId', v_profile,
    'badgeIds', v_ids,
    'badges', v_badges,
    'commission', v_commission
  );
end $$;

create or replace function public.mcj_orders_cert_badge_snapshot_trg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    if coalesce(new.order_type, '') = 'multi_group' then return new; end if;
    if tg_op = 'UPDATE' then
      if new.companion_id is not distinct from old.companion_id then return new; end if;
      if coalesce(old.settlement_status, '') = 'settled' then return new; end if;
    end if;
    if new.companion_id is null then
      if tg_op = 'UPDATE' then new.cert_badge_snapshot := null; end if;
      return new;
    end if;
    if tg_op = 'INSERT' and new.cert_badge_snapshot is not null then return new; end if;
    new.cert_badge_snapshot := public.mcj_cert_badge_snapshot_for(new.companion_id::text, 'bind');
  exception when others then
    -- attribution must never break order writes; settlement re-freezes via the API fallback
    null;
  end;
  return new;
end $$;

drop trigger if exists trg_orders_cert_badge_snapshot on public.orders;
create trigger trg_orders_cert_badge_snapshot
  before insert or update of companion_id on public.orders
  for each row execute function public.mcj_orders_cert_badge_snapshot_trg();

-- 5) Grants / RLS (service role only; public reads go through the API) ------
alter table public.companion_cert_tag_assignments enable row level security;
alter table public.companion_cert_tag_commission_log enable row level security;
grant select, insert, update, delete on public.companion_cert_tags to service_role;
grant select, insert, update, delete on public.companion_cert_tag_assignments to service_role;
grant select, insert, update, delete on public.companion_cert_tag_commission_log to service_role;

notify pgrst, 'reload schema';
