-- Boss ↔ Companion 直属关系（运营关系，独立于 invitation / referral / orders）
-- Staging only for this rollout. Production must not be touched by this agent run.
-- Invariant confirmed on Staging: auth.uid() === profiles.id (profiles.id FK → auth.users).

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

-- updated_at trigger (reuse pattern if function exists; create if missing)
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

-- RLS
alter table public.boss_companion_relations enable row level security;
alter table public.boss_companion_relation_events enable row level security;

-- Drop old policies if re-run
drop policy if exists bcr_admin_all on public.boss_companion_relations;
drop policy if exists bcr_boss_select_own_active on public.boss_companion_relations;
drop policy if exists bcr_companion_select_own_active on public.boss_companion_relations;
drop policy if exists bcre_admin_all on public.boss_companion_relation_events;
drop policy if exists bcre_boss_select_own on public.boss_companion_relation_events;
drop policy if exists bcre_companion_select_own on public.boss_companion_relation_events;

-- Admin: full access (role = admin)
create policy bcr_admin_all on public.boss_companion_relations
  for all
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and lower(coalesce(p.role, '')) = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and lower(coalesce(p.role, '')) = 'admin'
    )
  );

-- Boss: read own active relations only (auth.uid() = profiles.id = boss_id)
create policy bcr_boss_select_own_active on public.boss_companion_relations
  for select
  using (
    boss_id = auth.uid()
    and status = 'active'
  );

-- Companion: read own active relation only
create policy bcr_companion_select_own_active on public.boss_companion_relations
  for select
  using (
    companion_id = auth.uid()
    and status = 'active'
  );

-- Events: admin all; boss/companion read rows involving themselves
create policy bcre_admin_all on public.boss_companion_relation_events
  for all
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and lower(coalesce(p.role, '')) = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and lower(coalesce(p.role, '')) = 'admin'
    )
  );

create policy bcre_boss_select_own on public.boss_companion_relation_events
  for select
  using (
    from_boss_id = auth.uid() or to_boss_id = auth.uid()
  );

create policy bcre_companion_select_own on public.boss_companion_relation_events
  for select
  using (companion_id = auth.uid());

grant select on public.boss_companion_relations to authenticated;
grant select on public.boss_companion_relation_events to authenticated;
-- writes go through service_role API after admin assert (no direct client insert/update)

-- Refresh PostgREST schema cache so /rest/v1/boss_companion_* is visible immediately
notify pgrst, 'reload schema';
