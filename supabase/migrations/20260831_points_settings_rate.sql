-- Boss order points: amount × rate + refund clawback debt.
-- Idempotent / safe on Staging that already ran 20260831_points_settings.sql.
-- NOT executed yet on Staging as of design fix — do not confuse with any prior draft.
--
-- Pricing unit is CAT FOOD (订单 paid_cat_food / total_amount), NOT bank MYR.
-- Column is points_per_cat_food (never points_per_rm) so Admin copy cannot claim RM falsely.
--
-- Does not drop points_settings / accounts / ledger rows.
-- Does not touch wallets / popularity / Production.

-- ---------------------------------------------------------------------------
-- points_settings: rate formula (猫粮 × rate)
-- ---------------------------------------------------------------------------
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

-- Backfill defaults for any pre-existing row (Staging already has id=1).
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
    select 1 from pg_constraint
    where conname = 'points_settings_points_per_cat_food_nonneg'
  ) then
    alter table public.points_settings
      add constraint points_settings_points_per_cat_food_nonneg
      check (points_per_cat_food >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'points_settings_min_order_cat_food_nonneg'
  ) then
    alter table public.points_settings
      add constraint points_settings_min_order_cat_food_nonneg
      check (min_order_cat_food >= 0);
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
comment on column public.points_settings.points_per_cat_food is
  'Boss loyalty: points per 1 猫粮 of order effective spend (paid_cat_food||total_amount). Not bank MYR.';
comment on column public.points_settings.min_order_cat_food is
  'Minimum effective order cat-food amount required to earn points. Default 0.';
comment on column public.points_settings.max_reward_points is
  'Cap per order. 0 = unlimited.';
comment on column public.points_settings.rounding_mode is
  'How to round cat_food_spend * points_per_cat_food: floor (default) | ceil | round.';
comment on column public.points_settings.order_completion_points is
  'Deprecated fixed award. Kept for backward compatibility; award path uses rate formula.';

-- ---------------------------------------------------------------------------
-- Points debt (refund clawback that cannot fit in current balance)
-- Keep balance >= 0; outstanding_debt holds unrecovered clawback obligation.
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
    select 1 from pg_constraint
    where conname = 'user_points_accounts_debt_nonneg'
  ) then
    alter table public.user_points_accounts
      add constraint user_points_accounts_debt_nonneg
      check (outstanding_debt >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'user_points_accounts_debt_opened_nonneg'
  ) then
    alter table public.user_points_accounts
      add constraint user_points_accounts_debt_opened_nonneg
      check (lifetime_debt_opened >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'user_points_accounts_debt_repaid_nonneg'
  ) then
    alter table public.user_points_accounts
      add constraint user_points_accounts_debt_repaid_nonneg
      check (lifetime_debt_repaid >= 0);
  end if;
end $$;

comment on column public.user_points_accounts.outstanding_debt is
  'Unrecovered points clawback after refunds when balance was insufficient. Future awards repay debt first.';
comment on column public.user_points_accounts.lifetime_debt_opened is
  'Sum of debt opened by refund clawbacks.';
comment on column public.user_points_accounts.lifetime_debt_repaid is
  'Sum of debt repaid from later awards.';

alter table public.user_points_ledger
  add column if not exists debt_delta integer not null default 0;

alter table public.user_points_ledger
  add column if not exists debt_after integer not null default 0;

alter table public.user_points_ledger
  add column if not exists clawback_target integer not null default 0;

alter table public.user_points_ledger
  add column if not exists gross_points integer not null default 0;

comment on column public.user_points_ledger.debt_delta is
  'Change to outstanding_debt (+ open debt on clawback, - repay on award).';
comment on column public.user_points_ledger.debt_after is
  'outstanding_debt after this ledger row.';
comment on column public.user_points_ledger.clawback_target is
  'Full clawback obligation for refund rows (e.g. original award 380). 0 otherwise.';
comment on column public.user_points_ledger.gross_points is
  'Gross points for award rows before debt offset (used as refund clawback target). 0 for non-award rows.';

-- ---------------------------------------------------------------------------
-- Award RPC: credit net after outstanding_debt repayment (keeps balance >= 0)
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

  select * into v_existing
  from public.user_points_ledger
  where idempotency_key = v_key;

  if found then
    return jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'ledger_id', v_existing.id,
      'user_id', v_existing.user_id,
      'delta', v_existing.delta,
      'balance_after', v_existing.balance_after,
      'debt_delta', coalesce(v_existing.debt_delta, 0),
      'debt_after', coalesce(v_existing.debt_after, 0),
      'idempotency_key', v_existing.idempotency_key
    );
  end if;

  insert into public.user_points_accounts (user_id, balance, lifetime_earned, lifetime_spent, outstanding_debt)
  values (p_user_id, 0, 0, 0, 0)
  on conflict (user_id) do nothing;

  select * into v_account
  from public.user_points_accounts
  where user_id = p_user_id
  for update;

  select * into v_existing
  from public.user_points_ledger
  where idempotency_key = v_key;

  if found then
    return jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'ledger_id', v_existing.id,
      'user_id', v_existing.user_id,
      'delta', v_existing.delta,
      'balance_after', v_existing.balance_after,
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
    user_id,
    delta,
    balance_after,
    debt_delta,
    debt_after,
    clawback_target,
    gross_points,
    reason,
    source,
    related_order_id,
    idempotency_key,
    operator_id
  ) values (
    p_user_id,
    v_credit,
    v_new_balance,
    -v_repay,
    v_new_debt,
    0,
    p_points,
    v_reason,
    coalesce(p_source, ''),
    p_related_order_id,
    v_key,
    p_operator_id
  )
  returning id into v_ledger_id;

  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'ledger_id', v_ledger_id,
    'user_id', p_user_id,
    'delta', v_credit,
    'gross_points', p_points,
    'debt_repaid', v_repay,
    'balance_after', v_new_balance,
    'debt_after', v_new_debt,
    'idempotency_key', v_key
  );
exception
  when unique_violation then
    select * into v_existing
    from public.user_points_ledger
    where idempotency_key = v_key;
    if found then
      return jsonb_build_object(
        'ok', true,
        'duplicate', true,
        'ledger_id', v_existing.id,
        'user_id', v_existing.user_id,
        'delta', v_existing.delta,
        'balance_after', v_existing.balance_after,
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

-- ---------------------------------------------------------------------------
-- Clawback RPC: full obligation; debit balance then open debt for remainder
-- ---------------------------------------------------------------------------
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

  select * into v_existing
  from public.user_points_ledger
  where idempotency_key = v_key;

  if found then
    return jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'ledger_id', v_existing.id,
      'user_id', v_existing.user_id,
      'delta', v_existing.delta,
      'balance_after', v_existing.balance_after,
      'debt_delta', coalesce(v_existing.debt_delta, 0),
      'debt_after', coalesce(v_existing.debt_after, 0),
      'clawback_target', coalesce(v_existing.clawback_target, 0),
      'idempotency_key', v_existing.idempotency_key
    );
  end if;

  insert into public.user_points_accounts (user_id, balance, lifetime_earned, lifetime_spent, outstanding_debt)
  values (p_user_id, 0, 0, 0, 0)
  on conflict (user_id) do nothing;

  select * into v_account
  from public.user_points_accounts
  where user_id = p_user_id
  for update;

  select * into v_existing
  from public.user_points_ledger
  where idempotency_key = v_key;

  if found then
    return jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'ledger_id', v_existing.id,
      'user_id', v_existing.user_id,
      'delta', v_existing.delta,
      'balance_after', v_existing.balance_after,
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
    user_id,
    delta,
    balance_after,
    debt_delta,
    debt_after,
    clawback_target,
    gross_points,
    reason,
    source,
    related_order_id,
    idempotency_key,
    operator_id
  ) values (
    p_user_id,
    -v_applied,
    v_new_balance,
    v_debt_add,
    v_new_debt,
    p_points_target,
    0,
    v_reason,
    coalesce(nullif(trim(p_source), ''), 'order_refund_clawback'),
    p_related_order_id,
    v_key,
    p_operator_id
  )
  returning id into v_ledger_id;

  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'ledger_id', v_ledger_id,
    'user_id', p_user_id,
    'delta', -v_applied,
    'applied', v_applied,
    'debt_opened', v_debt_add,
    'clawback_target', p_points_target,
    'balance_after', v_new_balance,
    'debt_after', v_new_debt,
    'idempotency_key', v_key
  );
exception
  when unique_violation then
    select * into v_existing
    from public.user_points_ledger
    where idempotency_key = v_key;
    if found then
      return jsonb_build_object(
        'ok', true,
        'duplicate', true,
        'ledger_id', v_existing.id,
        'user_id', v_existing.user_id,
        'delta', v_existing.delta,
        'balance_after', v_existing.balance_after,
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
