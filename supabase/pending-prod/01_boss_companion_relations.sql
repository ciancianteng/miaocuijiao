-- =============================================================================
-- PENDING PROD MIGRATION 01 / 05
-- DO NOT EXECUTE on Production in this agent turn.
-- Source SoT: supabase/migrations/20260901_boss_companion_relations.sql
-- =============================================================================
-- 覆盖对象：
--   • public.boss_companion_relations
--   • public.boss_companion_relation_events
--
-- 用途：
--   Boss ↔ Companion 直属运营关系的 Source of Truth。
--   后续 Boss 佣金结算、等级计算（活跃直属陪玩数）、邀请接受后落库，都依赖本表。
--   events 表为 append-only 审计轨迹（bind / rebind / unbind）。
--
-- 风险：
--   P0-功能：缺表 → 直属绑定/解绑/Admin 关系管理不可用。
--   P0-数据：unique(active companion) 约束意味着一个陪玩同时只能有一个 active Boss；
--           若先用业务脚本人工灌脏关系，再跑本 migration，可能与历史数据冲突。
--   P1-安全：JWT 侧仅开放 select；写操作设计走 service_role API。
--           若前端误用 anon key 直写，会被 RLS 挡住（预期）。
--   P1-运维：notify pgrst reload schema；执行后需确认 PostgREST 可见新表。
-- =============================================================================

create table if not exists public.boss_companion_relations (
  id uuid primary key default gen_random_uuid(),
  boss_id uuid not null references public.profiles (id) on delete restrict,
  companion_id uuid not null references public.profiles (id) on delete restrict,
  status text not null default 'active'
    check (status in ('active', 'unbound', 'replaced')),
  bound_at timestamptz not null default now(),
  unbound_at timestamptz,
  bound_by uuid references public.profiles (id) on delete set null,
  remark text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint boss_companion_relations_not_self check (boss_id <> companion_id)
);

create unique index if not exists uq_boss_companion_relations_active_companion
  on public.boss_companion_relations (companion_id)
  where (status = 'active');

create index if not exists idx_bcr_boss_status
  on public.boss_companion_relations (boss_id, status);

create index if not exists idx_bcr_companion_status
  on public.boss_companion_relations (companion_id, status);

create index if not exists idx_bcr_bound_at
  on public.boss_companion_relations (bound_at desc);

create table if not exists public.boss_companion_relation_events (
  id uuid primary key default gen_random_uuid(),
  relation_id uuid references public.boss_companion_relations (id) on delete set null,
  companion_id uuid not null references public.profiles (id) on delete restrict,
  from_boss_id uuid references public.profiles (id) on delete set null,
  to_boss_id uuid references public.profiles (id) on delete set null,
  action text not null check (action in ('bind', 'rebind', 'unbind')),
  operator_id uuid references public.profiles (id) on delete set null,
  remark text,
  created_at timestamptz not null default now()
);

create index if not exists idx_bcre_companion_created
  on public.boss_companion_relation_events (companion_id, created_at desc);

create index if not exists idx_bcre_relation_created
  on public.boss_companion_relation_events (relation_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_bcr_updated_at on public.boss_companion_relations;
create trigger trg_bcr_updated_at
before update on public.boss_companion_relations
for each row execute function public.set_updated_at();

alter table public.boss_companion_relations enable row level security;
alter table public.boss_companion_relation_events enable row level security;

drop policy if exists bcr_admin_all on public.boss_companion_relations;
drop policy if exists bcr_boss_select_own_active on public.boss_companion_relations;
drop policy if exists bcr_companion_select_own_active on public.boss_companion_relations;
drop policy if exists bcre_admin_select on public.boss_companion_relation_events;
drop policy if exists bcre_admin_insert on public.boss_companion_relation_events;
drop policy if exists bcre_boss_select_own on public.boss_companion_relation_events;
drop policy if exists bcre_companion_select_own on public.boss_companion_relation_events;

create policy bcr_admin_all on public.boss_companion_relations
  for all
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and lower(coalesce(p.role::text, '')) in ('admin', 'super_admin')
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and lower(coalesce(p.role::text, '')) in ('admin', 'super_admin')
    )
  );

create policy bcr_boss_select_own_active on public.boss_companion_relations
  for select
  using (boss_id = auth.uid() and status = 'active');

create policy bcr_companion_select_own_active on public.boss_companion_relations
  for select
  using (companion_id = auth.uid() and status = 'active');

create policy bcre_admin_select on public.boss_companion_relation_events
  for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and lower(coalesce(p.role::text, '')) in ('admin', 'super_admin')
    )
  );

create policy bcre_admin_insert on public.boss_companion_relation_events
  for insert
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and lower(coalesce(p.role::text, '')) in ('admin', 'super_admin')
    )
  );

create policy bcre_boss_select_own on public.boss_companion_relation_events
  for select
  using (from_boss_id = auth.uid() or to_boss_id = auth.uid());

create policy bcre_companion_select_own on public.boss_companion_relation_events
  for select
  using (companion_id = auth.uid());

create or replace function public.bcr_forbid_event_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'boss_companion_relation_events is append-only';
end;
$$;

drop trigger if exists trg_bcre_no_update on public.boss_companion_relation_events;
create trigger trg_bcre_no_update
before update on public.boss_companion_relation_events
for each row execute function public.bcr_forbid_event_mutation();

drop trigger if exists trg_bcre_no_delete on public.boss_companion_relation_events;
create trigger trg_bcre_no_delete
before delete on public.boss_companion_relation_events
for each row execute function public.bcr_forbid_event_mutation();

grant select on public.boss_companion_relations to authenticated;
grant select on public.boss_companion_relation_events to authenticated;

notify pgrst, 'reload schema';
