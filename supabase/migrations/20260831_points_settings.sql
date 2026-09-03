-- Boss loyalty points settings (global single row).
-- Independent from companion popularity rules and wallets.
-- Safe to re-run. Does not alter user_points_accounts / user_points_ledger.

create table if not exists public.points_settings (
  id integer primary key default 1,
  order_completion_points integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint points_settings_singleton check (id = 1),
  constraint points_settings_order_completion_points_nonneg check (order_completion_points >= 0)
);

comment on table public.points_settings is
  'Boss loyalty points global config. Independent from popularity / wallets.';
comment on column public.points_settings.order_completion_points is
  'Points awarded to Boss when an order reaches completed (idempotent per order).';

insert into public.points_settings (id, order_completion_points)
values (1, 100)
on conflict (id) do nothing;

create or replace function public.tg_points_settings_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_points_settings_updated_at on public.points_settings;
create trigger trg_points_settings_updated_at
  before update on public.points_settings
  for each row
  execute function public.tg_points_settings_set_updated_at();

grant select, insert, update, delete on public.points_settings to service_role;
grant select on public.points_settings to authenticated;

notify pgrst, 'reload schema';
