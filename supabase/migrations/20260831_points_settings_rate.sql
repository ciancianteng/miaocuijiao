-- Boss order points: switch from fixed award to amount × rate.
-- Idempotent / safe on Staging that already ran 20260831_points_settings.sql.
-- Does not drop points_settings; does not alter accounts / ledger / popularity / wallet / orders.

alter table public.points_settings
  add column if not exists enabled boolean not null default true;

alter table public.points_settings
  add column if not exists points_per_rm numeric(12, 4) not null default 10;

alter table public.points_settings
  add column if not exists min_order_amount numeric(12, 2) not null default 0;

alter table public.points_settings
  add column if not exists max_reward_points integer not null default 0;

alter table public.points_settings
  add column if not exists rounding_mode text not null default 'floor';

-- Backfill defaults for any pre-existing row (Staging already has id=1).
update public.points_settings
set
  enabled = coalesce(enabled, true),
  points_per_rm = coalesce(points_per_rm, 10),
  min_order_amount = coalesce(min_order_amount, 0),
  max_reward_points = coalesce(max_reward_points, 0),
  rounding_mode = coalesce(nullif(trim(rounding_mode), ''), 'floor'),
  updated_at = now()
where id = 1;

-- Ensure singleton row still exists.
insert into public.points_settings (
  id,
  order_completion_points,
  enabled,
  points_per_rm,
  min_order_amount,
  max_reward_points,
  rounding_mode
)
values (1, 100, true, 10, 0, 0, 'floor')
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'points_settings_points_per_rm_nonneg'
  ) then
    alter table public.points_settings
      add constraint points_settings_points_per_rm_nonneg
      check (points_per_rm >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'points_settings_min_order_amount_nonneg'
  ) then
    alter table public.points_settings
      add constraint points_settings_min_order_amount_nonneg
      check (min_order_amount >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'points_settings_max_reward_points_nonneg'
  ) then
    alter table public.points_settings
      add constraint points_settings_max_reward_points_nonneg
      check (max_reward_points >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'points_settings_rounding_mode_valid'
  ) then
    alter table public.points_settings
      add constraint points_settings_rounding_mode_valid
      check (rounding_mode in ('floor', 'ceil', 'round'));
  end if;
end $$;

comment on column public.points_settings.enabled is
  'When false, new completed orders get 0 Boss points but still reserve idempotency key.';
comment on column public.points_settings.points_per_rm is
  'Boss loyalty: points per 1 unit of effective order spend (paid_cat_food||total_amount, RM-equivalent).';
comment on column public.points_settings.min_order_amount is
  'Minimum effective order amount required to earn points. Default 0.';
comment on column public.points_settings.max_reward_points is
  'Cap per order. 0 = unlimited.';
comment on column public.points_settings.rounding_mode is
  'How to round amount * points_per_rm: floor (default) | ceil | round.';
comment on column public.points_settings.order_completion_points is
  'Deprecated fixed award (PR126). Kept for backward compatibility; award path uses rate formula.';

notify pgrst, 'reload schema';
