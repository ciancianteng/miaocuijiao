-- =============================================================================
-- PENDING PROD MIGRATION 05 / 05
-- DO NOT EXECUTE on Production in this agent turn.
-- Source SoT:
--   supabase/migrations/20260831_points_settings.sql
--   supabase/migrations/20260831_points_settings_rate.sql
-- =============================================================================
-- 覆盖对象：
--   • public.points_settings              ← 你清单中的 points_settings
--   • user_points_accounts 欠款列扩展
--   • user_points_ledger 欠款/回滚列扩展
--   • RPC mcj_award_user_points / mcj_clawback_user_points（欠款感知版）
--
-- 用途：
--   points_settings：Boss 积分全局规则（开关、猫粮倍率、下限、上限、取整）。
--   计分：points = round(effective_cat_food_spend * points_per_cat_food)
--   欠款：退款 clawback 余额不足时记 outstanding_debt，后续发放优先冲欠。
--
-- 依赖：
--   04_user_points_accounts_and_ledger.sql 必须先执行。
--
-- 风险：
--   P0-功能：缺 points_settings → Admin 积分设置页失败；发放走代码 fallback。
--   P0-资金：seed id=1 默认倍率 10；错误倍率会导致大面积错发积分。
--   P1：本文件含 INSERT seed + 替换 RPC（行为变更）；必须与 Staging 验收一致后再上。
--   P1：rounding_mode / max_reward_points=0(不限) 语义需产品确认。
--   P2：本文件不回填历史订单积分（只建结构）；历史补发需单独只读盘点 + 受控脚本。
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A) points_settings base + rate columns
-- ---------------------------------------------------------------------------
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
  'Deprecated fixed award. Kept for backward compatibility; award path uses rate formula.';

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

alter table public.points_settings
  add column if not exists enabled boolean not null default true;

alter table public.points_settings
  add column if not exists points_per_cat_food numeric(12, 4) not null default 10;

alter table public.points_settings
  add column if not exists min_order_cat_food numeric(12, 2) not null default 0;

alter table public.points_settings
  add column if not exists max_reward_points integer not null default 0;

alter table public.points_settings
  add column if not exists rounding_mode text not null default 'floor';

update public.points_settings
set
  enabled = coalesce(enabled, true),
  points_per_cat_food = coalesce(points_per_cat_food, 10),
  min_order_cat_food = coalesce(min_order_cat_food, 0),
  max_reward_points = coalesce(max_reward_points, 0),
  rounding_mode = coalesce(nullif(trim(rounding_mode), ''), 'floor'),
  updated_at = now()
where id = 1;

insert into public.points_settings (
  id,
  order_completion_points,
  enabled,
  points_per_cat_food,
  min_order_cat_food,
  max_reward_points,
  rounding_mode
)
values (1, 100, true, 10, 0, 0, 'floor')
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'points_settings_points_per_cat_food_nonneg'
  ) then
    alter table public.points_settings
      add constraint points_settings_points_per_cat_food_nonneg
      check (points_per_cat_food >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'points_settings_min_order_cat_food_nonneg'
  ) then
    alter table public.points_settings
      add constraint points_settings_min_order_cat_food_nonneg
      check (min_order_cat_food >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'points_settings_max_reward_points_nonneg'
  ) then
    alter table public.points_settings
      add constraint points_settings_max_reward_points_nonneg
      check (max_reward_points >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'points_settings_rounding_mode_valid'
  ) then
    alter table public.points_settings
      add constraint points_settings_rounding_mode_valid
      check (rounding_mode in ('floor', 'ceil', 'round'));
  end if;
end $$;

comment on column public.points_settings.enabled is
  'When false, new completed orders get 0 Boss points but still reserve idempotency key.';
comment on column public.points_settings.points_per_cat_food is
  'Boss loyalty: points per 1 猫粮 of order effective spend. Not bank MYR.';
comment on column public.points_settings.min_order_cat_food is
  'Minimum effective order cat-food amount required to earn points. Default 0.';
comment on column public.points_settings.max_reward_points is
  'Cap per order. 0 = unlimited.';
comment on column public.points_settings.rounding_mode is
  'How to round cat_food_spend * points_per_cat_food: floor | ceil | round.';

grant select, insert, update, delete on public.points_settings to service_role;
grant select on public.points_settings to authenticated;

-- ---------------------------------------------------------------------------
-- B) Debt columns on accounts / ledger
-- ---------------------------------------------------------------------------
alter table public.user_points_accounts
  add column if not exists outstanding_debt integer not null default 0;
alter table public.user_points_accounts
  add column if not exists lifetime_debt_opened integer not null default 0;
alter table public.user_points_accounts
  add column if not exists lifetime_debt_repaid integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'user_points_accounts_debt_nonneg'
  ) then
    alter table public.user_points_accounts
      add constraint user_points_accounts_debt_nonneg check (outstanding_debt >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'user_points_accounts_debt_opened_nonneg'
  ) then
    alter table public.user_points_accounts
      add constraint user_points_accounts_debt_opened_nonneg check (lifetime_debt_opened >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'user_points_accounts_debt_repaid_nonneg'
  ) then
    alter table public.user_points_accounts
      add constraint user_points_accounts_debt_repaid_nonneg check (lifetime_debt_repaid >= 0);
  end if;
end $$;

alter table public.user_points_ledger
  add column if not exists debt_delta integer not null default 0;
alter table public.user_points_ledger
  add column if not exists debt_after integer not null default 0;
alter table public.user_points_ledger
  add column if not exists clawback_target integer not null default 0;
alter table public.user_points_ledger
  add column if not exists gross_points integer not null default 0;

comment on column public.user_points_accounts.outstanding_debt is
  'Unrecovered points clawback after refunds when balance was insufficient.';
comment on column public.user_points_ledger.debt_delta is
  'Change to outstanding_debt (+ open on clawback, - repay on award).';
comment on column public.user_points_ledger.clawback_target is
  'Full clawback obligation for refund rows; 0 otherwise.';
comment on column public.user_points_ledger.gross_points is
  'Gross points for award rows before debt offset; used as refund clawback target.';

-- ---------------------------------------------------------------------------
-- C) Debt-aware RPCs (replace baseline from 04)
-- Column names aligned with server/api/_user-points.js
-- ---------------------------------------------------------------------------
create or replace function public.mcj_award_user_points(
  p_user_id uuid,
  p_points integer,
  p_reason text default '',
  p_source text default '',
  p_related_order_id uuid default null,
  p_idempotency_key text default null,
  p_operator_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.user_points_ledger%rowtype;
  v_account public.user_points_accounts%rowtype;
  v_new_balance integer;
  v_new_debt integer;
  v_repay integer;
  v_credit integer;
  v_ledger_id uuid;
  v_key text;
  v_reason text;
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'user_id_required');
  end if;
  if p_points is null or p_points <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_points');
  end if;
  v_key := nullif(trim(coalesce(p_idempotency_key, '')), '');
  if v_key is null then
    return jsonb_build_object('ok', false, 'error', 'idempotency_key_required');
  end if;

  select * into v_existing from public.user_points_ledger where idempotency_key = v_key;
  if found then
    return jsonb_build_object(
      'ok', true, 'duplicate', true,
      'ledger_id', v_existing.id, 'user_id', v_existing.user_id,
      'delta', v_existing.delta, 'balance_after', v_existing.balance_after,
      'debt_delta', coalesce(v_existing.debt_delta, 0),
      'debt_after', coalesce(v_existing.debt_after, 0),
      'idempotency_key', v_existing.idempotency_key
    );
  end if;

  insert into public.user_points_accounts (user_id, balance, lifetime_earned, lifetime_spent, outstanding_debt)
  values (p_user_id, 0, 0, 0, 0)
  on conflict (user_id) do nothing;

  select * into v_account from public.user_points_accounts where user_id = p_user_id for update;

  select * into v_existing from public.user_points_ledger where idempotency_key = v_key;
  if found then
    return jsonb_build_object(
      'ok', true, 'duplicate', true,
      'ledger_id', v_existing.id, 'user_id', v_existing.user_id,
      'delta', v_existing.delta, 'balance_after', v_existing.balance_after,
      'debt_delta', coalesce(v_existing.debt_delta, 0),
      'debt_after', coalesce(v_existing.debt_after, 0),
      'idempotency_key', v_existing.idempotency_key
    );
  end if;

  v_repay := least(p_points, greatest(coalesce(v_account.outstanding_debt, 0), 0));
  v_credit := p_points - v_repay;
  v_new_debt := greatest(coalesce(v_account.outstanding_debt, 0) - v_repay, 0);
  v_new_balance := coalesce(v_account.balance, 0) + v_credit;

  if v_repay > 0 then
    v_reason := coalesce(nullif(trim(p_reason), ''), '积分入账')
      || '（毛奖励 ' || p_points || '，抵扣欠款 ' || v_repay || '，入账 ' || v_credit || '）';
  else
    v_reason := coalesce(p_reason, '');
  end if;

  update public.user_points_accounts
  set
    balance = v_new_balance,
    lifetime_earned = coalesce(lifetime_earned, 0) + p_points,
    outstanding_debt = v_new_debt,
    lifetime_debt_repaid = coalesce(lifetime_debt_repaid, 0) + v_repay,
    updated_at = now()
  where user_id = p_user_id;

  insert into public.user_points_ledger (
    user_id, delta, balance_after, debt_delta, debt_after,
    clawback_target, gross_points, reason, source,
    related_order_id, idempotency_key, operator_id
  ) values (
    p_user_id, v_credit, v_new_balance, -v_repay, v_new_debt,
    0, p_points, v_reason, coalesce(p_source, ''),
    p_related_order_id, v_key, p_operator_id
  )
  returning id into v_ledger_id;

  return jsonb_build_object(
    'ok', true, 'duplicate', false,
    'ledger_id', v_ledger_id, 'user_id', p_user_id,
    'delta', v_credit, 'gross_points', p_points,
    'debt_repaid', v_repay,
    'balance_after', v_new_balance, 'debt_after', v_new_debt,
    'idempotency_key', v_key
  );
exception
  when unique_violation then
    select * into v_existing from public.user_points_ledger where idempotency_key = v_key;
    if found then
      return jsonb_build_object(
        'ok', true, 'duplicate', true,
        'ledger_id', v_existing.id, 'user_id', v_existing.user_id,
        'delta', v_existing.delta, 'balance_after', v_existing.balance_after,
        'debt_delta', coalesce(v_existing.debt_delta, 0),
        'debt_after', coalesce(v_existing.debt_after, 0),
        'idempotency_key', v_existing.idempotency_key
      );
    end if;
    raise;
end;
$$;

revoke all on function public.mcj_award_user_points(uuid, integer, text, text, uuid, text, uuid) from public;
grant execute on function public.mcj_award_user_points(uuid, integer, text, text, uuid, text, uuid) to service_role;

create or replace function public.mcj_clawback_user_points(
  p_user_id uuid,
  p_points_target integer,
  p_reason text default '',
  p_source text default 'order_refund_clawback',
  p_related_order_id uuid default null,
  p_idempotency_key text default null,
  p_operator_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.user_points_ledger%rowtype;
  v_account public.user_points_accounts%rowtype;
  v_applied integer;
  v_debt_add integer;
  v_new_balance integer;
  v_new_debt integer;
  v_ledger_id uuid;
  v_key text;
  v_reason text;
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'user_id_required');
  end if;
  if p_points_target is null or p_points_target <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_points_target');
  end if;
  v_key := nullif(trim(coalesce(p_idempotency_key, '')), '');
  if v_key is null then
    return jsonb_build_object('ok', false, 'error', 'idempotency_key_required');
  end if;

  select * into v_existing from public.user_points_ledger where idempotency_key = v_key;
  if found then
    return jsonb_build_object(
      'ok', true, 'duplicate', true,
      'ledger_id', v_existing.id, 'user_id', v_existing.user_id,
      'delta', v_existing.delta, 'balance_after', v_existing.balance_after,
      'debt_delta', coalesce(v_existing.debt_delta, 0),
      'debt_after', coalesce(v_existing.debt_after, 0),
      'clawback_target', coalesce(v_existing.clawback_target, 0),
      'idempotency_key', v_existing.idempotency_key
    );
  end if;

  insert into public.user_points_accounts (user_id, balance, lifetime_earned, lifetime_spent, outstanding_debt)
  values (p_user_id, 0, 0, 0, 0)
  on conflict (user_id) do nothing;

  select * into v_account from public.user_points_accounts where user_id = p_user_id for update;

  select * into v_existing from public.user_points_ledger where idempotency_key = v_key;
  if found then
    return jsonb_build_object(
      'ok', true, 'duplicate', true,
      'ledger_id', v_existing.id, 'user_id', v_existing.user_id,
      'delta', v_existing.delta, 'balance_after', v_existing.balance_after,
      'debt_delta', coalesce(v_existing.debt_delta, 0),
      'debt_after', coalesce(v_existing.debt_after, 0),
      'clawback_target', coalesce(v_existing.clawback_target, 0),
      'idempotency_key', v_existing.idempotency_key
    );
  end if;

  v_applied := least(p_points_target, greatest(coalesce(v_account.balance, 0), 0));
  v_debt_add := p_points_target - v_applied;
  v_new_balance := coalesce(v_account.balance, 0) - v_applied;
  v_new_debt := coalesce(v_account.outstanding_debt, 0) + v_debt_add;

  v_reason := coalesce(nullif(trim(p_reason), ''), '订单退款回退积分')
    || '（应回收 ' || p_points_target
    || '，已扣余额 ' || v_applied
    || '，记入欠款 ' || v_debt_add || '）';

  update public.user_points_accounts
  set
    balance = v_new_balance,
    lifetime_spent = coalesce(lifetime_spent, 0) + v_applied,
    outstanding_debt = v_new_debt,
    lifetime_debt_opened = coalesce(lifetime_debt_opened, 0) + v_debt_add,
    updated_at = now()
  where user_id = p_user_id;

  insert into public.user_points_ledger (
    user_id, delta, balance_after, debt_delta, debt_after,
    clawback_target, gross_points, reason, source,
    related_order_id, idempotency_key, operator_id
  ) values (
    p_user_id, -v_applied, v_new_balance, v_debt_add, v_new_debt,
    p_points_target, 0, v_reason,
    coalesce(nullif(trim(p_source), ''), 'order_refund_clawback'),
    p_related_order_id, v_key, p_operator_id
  )
  returning id into v_ledger_id;

  return jsonb_build_object(
    'ok', true, 'duplicate', false,
    'ledger_id', v_ledger_id, 'user_id', p_user_id,
    'delta', -v_applied, 'applied', v_applied,
    'debt_opened', v_debt_add, 'clawback_target', p_points_target,
    'balance_after', v_new_balance, 'debt_after', v_new_debt,
    'idempotency_key', v_key
  );
exception
  when unique_violation then
    select * into v_existing from public.user_points_ledger where idempotency_key = v_key;
    if found then
      return jsonb_build_object(
        'ok', true, 'duplicate', true,
        'ledger_id', v_existing.id, 'user_id', v_existing.user_id,
        'delta', v_existing.delta, 'balance_after', v_existing.balance_after,
        'debt_delta', coalesce(v_existing.debt_delta, 0),
        'debt_after', coalesce(v_existing.debt_after, 0),
        'clawback_target', coalesce(v_existing.clawback_target, 0),
        'idempotency_key', v_existing.idempotency_key
      );
    end if;
    raise;
end;
$$;

revoke all on function public.mcj_clawback_user_points(uuid, integer, text, text, uuid, text, uuid) from public;
grant execute on function public.mcj_clawback_user_points(uuid, integer, text, text, uuid, text, uuid) to service_role;

notify pgrst, 'reload schema';
