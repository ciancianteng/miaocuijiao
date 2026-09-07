-- Admin-controlled companion verification badges (public card + detail).
-- Linked 1:1 to companion_profiles. Public list/order logic unchanged.

create table if not exists public.companion_badges (
  id uuid primary key default gen_random_uuid(),
  companion_profile_id uuid not null unique
    references public.companion_profiles (id) on delete cascade,
  real_verified boolean not null default false,
  game_verified boolean not null default false,
  voice_verified boolean not null default false,
  official_verified boolean not null default false,
  recommended boolean not null default false,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_companion_badges_profile
  on public.companion_badges (companion_profile_id);

comment on table public.companion_badges is
  'Admin toggles for companion marketplace verification badges.';
comment on column public.companion_badges.real_verified is '真人认证';
comment on column public.companion_badges.game_verified is '游戏认证';
comment on column public.companion_badges.voice_verified is '声线认证';
comment on column public.companion_badges.official_verified is '官方认证';
comment on column public.companion_badges.recommended is '官方推荐';

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_companion_badges_updated_at on public.companion_badges;
create trigger trg_companion_badges_updated_at
before update on public.companion_badges
for each row execute function public.set_updated_at();

alter table public.companion_badges enable row level security;

drop policy if exists companion_badges_admin_all on public.companion_badges;
drop policy if exists companion_badges_public_select on public.companion_badges;

-- Service role / admin backend uses service key; allow authenticated admin-like reads.
create policy companion_badges_public_select
  on public.companion_badges
  for select
  to anon, authenticated
  using (true);

create policy companion_badges_admin_all
  on public.companion_badges
  for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'super_admin', 'finance_admin')
        and p.status = 'active'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'super_admin', 'finance_admin')
        and p.status = 'active'
    )
  );
