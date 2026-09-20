-- =============================================================================
-- Boss invite links v1 (open shareable codes → auto-bind companion)
-- DRAFT FOR REVIEW / pending-prod — do not apply to Production in this PR.
-- =============================================================================
-- Depends on: public.boss_companion_relations (01_...)
-- Does NOT use / modify: public.boss_companion_invitations
-- Does NOT add: profiles.invited_by as SoT
-- Does NOT add: invite commission_rate (settlement uses existing relation rate logic)
-- =============================================================================

create table if not exists public.boss_invite_links (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  boss_id uuid not null references public.profiles (id) on delete restrict,
  status text not null default 'active'
    check (status in ('active', 'revoked', 'exhausted')),
  max_uses integer null check (max_uses is null or max_uses > 0),
  use_count integer not null default 0 check (use_count >= 0),
  expires_at timestamptz null,
  label text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz null,
  constraint boss_invite_links_code_nonempty check (length(trim(code)) >= 8)
);

create unique index if not exists uq_boss_invite_links_code
  on public.boss_invite_links (code);

create index if not exists idx_boss_invite_links_boss_status
  on public.boss_invite_links (boss_id, status, created_at desc);

create index if not exists idx_boss_invite_links_status_expires
  on public.boss_invite_links (status, expires_at);

create table if not exists public.boss_invite_redemptions (
  id uuid primary key default gen_random_uuid(),
  invite_link_id uuid not null references public.boss_invite_links (id) on delete restrict,
  code text not null,
  boss_id uuid not null references public.profiles (id) on delete restrict,
  invitee_id uuid not null references public.profiles (id) on delete restrict,
  relation_id uuid null references public.boss_companion_relations (id) on delete set null,
  outcome text not null
    check (outcome in (
      'bound',
      'skipped_already_bound',
      'skipped_invalid',
      'skipped_not_companion',
      'error'
    )),
  detail text null,
  created_at timestamptz not null default now()
);

create unique index if not exists uq_boss_invite_redemptions_link_invitee
  on public.boss_invite_redemptions (invite_link_id, invitee_id);

create index if not exists idx_boss_invite_redemptions_boss_created
  on public.boss_invite_redemptions (boss_id, created_at desc);

create index if not exists idx_boss_invite_redemptions_invitee_created
  on public.boss_invite_redemptions (invitee_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_boss_invite_links_updated_at on public.boss_invite_links;
create trigger trg_boss_invite_links_updated_at
before update on public.boss_invite_links
for each row execute function public.set_updated_at();

-- Append-only redemptions
create or replace function public.forbid_boss_invite_redemptions_mutate()
returns trigger
language plpgsql
as $$
begin
  raise exception 'boss_invite_redemptions is append-only';
end;
$$;

drop trigger if exists trg_bir_no_update on public.boss_invite_redemptions;
create trigger trg_bir_no_update
before update on public.boss_invite_redemptions
for each row execute function public.forbid_boss_invite_redemptions_mutate();

drop trigger if exists trg_bir_no_delete on public.boss_invite_redemptions;
create trigger trg_bir_no_delete
before delete on public.boss_invite_redemptions
for each row execute function public.forbid_boss_invite_redemptions_mutate();

alter table public.boss_invite_links enable row level security;
alter table public.boss_invite_redemptions enable row level security;

drop policy if exists bil_admin_all on public.boss_invite_links;
drop policy if exists bil_boss_select_own on public.boss_invite_links;
drop policy if exists bir_admin_select on public.boss_invite_redemptions;
drop policy if exists bir_boss_select_own on public.boss_invite_redemptions;
drop policy if exists bir_invitee_select_own on public.boss_invite_redemptions;

create policy bil_admin_all on public.boss_invite_links
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

create policy bil_boss_select_own on public.boss_invite_links
  for select
  using (boss_id = auth.uid());

create policy bir_admin_select on public.boss_invite_redemptions
  for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and lower(coalesce(p.role::text, '')) in ('admin', 'super_admin')
    )
  );

create policy bir_boss_select_own on public.boss_invite_redemptions
  for select
  using (boss_id = auth.uid());

create policy bir_invitee_select_own on public.boss_invite_redemptions
  for select
  using (invitee_id = auth.uid());

grant select on public.boss_invite_links to authenticated;
grant select on public.boss_invite_redemptions to authenticated;
