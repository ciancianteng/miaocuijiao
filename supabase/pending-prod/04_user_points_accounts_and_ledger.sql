-- =============================================================================
-- PENDING PROD MIGRATION 04 / 05
-- DO NOT EXECUTE on Production in this agent turn.
-- Source SoT: supabase/migrations/20260830_user_points.sql
-- =============================================================================
-- 覆盖对象：
--   • public.user_points_accounts   ← 你清单中的 user_points
--   • public.user_points_ledger     ← 你清单中的 user_points_ledger
--   • RPC public.mcj_award_user_points（基础幂等入账；05 会替换为含欠款版）
--
-- 用途：
--   user_points_accounts：Boss 积分余额账户（独立于钱包猫粮 / 陪玩人气）。
--   user_points_ledger：积分流水账；idempotency_key UNIQUE 防重复发放。
--
-- 风险：
--   P0-功能：缺表 → 积分发放/查询/Admin 积分页失败。
--   P0-资金：related_order_id FK → orders(id uuid)。若现网 orders.id 非 uuid 会失败。
--   P1：基础 RPC 不含退款欠款逻辑；必须随后执行 05，否则退款 clawback 能力不完整。
--   P1：service_role 才有 execute；authenticated 仅 select。
-- =============================================================================

create extension if not exists pgcrypto;

create table if not exists public.user_points_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  balance integer not null default 0,
  lifetime_earned integer not null default 0,
  lifetime_spent integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_points_accounts_user_id_key unique (user_id),
  constraint user_points_accounts_balance_nonneg check (balance >= 0),
  constraint user_points_accounts_earned_nonneg check (lifetime_earned >= 0),
  constraint user_points_accounts_spent_nonneg check (lifetime_spent >= 0)
);

create index if not exists idx_user_points_accounts_user
  on public.user_points_accounts(user_id);

create table if not exists public.user_points_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  delta integer not null,
  balance_after integer not null,
  reason text not null default '',
  source text not null default '',
  related_order_id uuid references public.orders(id),
  idempotency_key text not null,
  operator_id uuid,
  created_at timestamptz not null default now(),
  constraint user_points_ledger_idempotency_key_key unique (idempotency_key)
);

create index if not exists idx_user_points_ledger_user_created
  on public.user_points_ledger(user_id, created_at desc);

create index if not exists idx_user_points_ledger_order
  on public.user_points_ledger(related_order_id)
  where related_order_id is not null;

create index if not exists idx_user_points_ledger_source
  on public.user_points_ledger(source, created_at desc);

comment on table public.user_points_accounts is
  'Boss loyalty points balance. Independent from wallets (猫粮) and companion popularity.';
comment on table public.user_points_ledger is
  'Append-only points ledger. idempotency_key UNIQUE prevents duplicate awards.';

create or replace function public.tg_user_points_accounts_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_user_points_accounts_updated_at on public.user_points_accounts;
create trigger trg_user_points_accounts_updated_at
  before update on public.user_points_accounts
  for each row
  execute function public.tg_user_points_accounts_set_updated_at();

-- Baseline award RPC (05 replaces with debt-aware version)
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
  v_ledger_id uuid;
  v_key text;
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
      'idempotency_key', v_existing.idempotency_key
    );
  end if;

  insert into public.user_points_accounts (user_id, balance, lifetime_earned, lifetime_spent)
  values (p_user_id, 0, 0, 0)
  on conflict (user_id) do nothing;

  select * into v_account from public.user_points_accounts where user_id = p_user_id for update;

  select * into v_existing from public.user_points_ledger where idempotency_key = v_key;
  if found then
    return jsonb_build_object(
      'ok', true, 'duplicate', true,
      'ledger_id', v_existing.id, 'user_id', v_existing.user_id,
      'delta', v_existing.delta, 'balance_after', v_existing.balance_after,
      'idempotency_key', v_existing.idempotency_key
    );
  end if;

  v_new_balance := coalesce(v_account.balance, 0) + p_points;

  update public.user_points_accounts
  set balance = v_new_balance,
      lifetime_earned = coalesce(lifetime_earned, 0) + p_points,
      updated_at = now()
  where user_id = p_user_id;

  insert into public.user_points_ledger (
    user_id, delta, balance_after, reason, source,
    related_order_id, idempotency_key, operator_id
  ) values (
    p_user_id, p_points, v_new_balance, coalesce(p_reason, ''), coalesce(p_source, ''),
    p_related_order_id, v_key, p_operator_id
  ) returning id into v_ledger_id;

  return jsonb_build_object(
    'ok', true, 'duplicate', false,
    'ledger_id', v_ledger_id, 'user_id', p_user_id,
    'delta', p_points, 'balance_after', v_new_balance,
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
        'idempotency_key', v_existing.idempotency_key
      );
    end if;
    raise;
end;
$$;

revoke all on function public.mcj_award_user_points(uuid, integer, text, text, uuid, text, uuid) from public;
grant execute on function public.mcj_award_user_points(uuid, integer, text, text, uuid, text, uuid) to service_role;

grant select, insert, update, delete on public.user_points_accounts to service_role;
grant select, insert, update, delete on public.user_points_ledger to service_role;
grant select on public.user_points_accounts to authenticated;
grant select on public.user_points_ledger to authenticated;

notify pgrst, 'reload schema';
