-- Cat-food wallet, recharge campaigns, compensation.
-- Run in Supabase SQL Editor after init.sql / boss-uid.sql.

-- ---------------------------------------------------------------------------
-- Wallets
-- ---------------------------------------------------------------------------
create table if not exists public.wallets (
  id uuid primary key default gen_random_uuid(),
  boss_id uuid not null unique references public.profiles(id) on delete cascade,
  paid_balance numeric(12,2) not null default 0 check (paid_balance >= 0),
  bonus_balance numeric(12,2) not null default 0 check (bonus_balance >= 0),
  total_balance numeric(12,2) not null default 0 check (total_balance >= 0),
  frozen boolean not null default false,
  total_paid_in numeric(12,2) not null default 0,
  total_bonus_in numeric(12,2) not null default 0,
  total_spent numeric(12,2) not null default 0,
  total_compensation numeric(12,2) not null default 0,
  total_recharge_rm numeric(12,2) not null default 0,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  boss_id uuid not null references public.profiles(id) on delete cascade,
  transaction_type text not null,
  amount numeric(12,2) not null check (amount > 0),
  balance_type text not null check (balance_type in ('paid', 'bonus')),
  direction text not null check (direction in ('credit', 'debit')),
  related_order_id uuid,
  related_recharge_id uuid,
  campaign_id uuid,
  compensation_id uuid,
  reason text not null default '',
  internal_note text not null default '',
  operator_id uuid references public.profiles(id),
  idempotency_key text not null,
  paid_balance_after numeric(12,2),
  bonus_balance_after numeric(12,2),
  total_balance_after numeric(12,2),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  constraint wallet_transactions_idempotency_unique unique (idempotency_key)
);

create index if not exists idx_wallet_tx_boss_created
  on public.wallet_transactions (boss_id, created_at desc);
create index if not exists idx_wallet_tx_type
  on public.wallet_transactions (transaction_type, created_at desc);

-- Soft-delete protection: no delete policy for authenticated; service role only.
revoke delete on public.wallet_transactions from authenticated, anon;

-- ---------------------------------------------------------------------------
-- Recharge campaigns
-- ---------------------------------------------------------------------------
create table if not exists public.recharge_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  pay_amount_rm numeric(12,2) not null check (pay_amount_rm > 0),
  base_cat_food numeric(12,2) not null check (base_cat_food >= 0),
  bonus_cat_food numeric(12,2) not null default 0 check (bonus_cat_food >= 0),
  total_cat_food numeric(12,2) not null check (total_cat_food >= 0),
  starts_at timestamptz,
  ends_at timestamptz,
  per_boss_limit integer not null default 0,
  first_recharge_only boolean not null default false,
  enabled boolean not null default true,
  sort_order integer not null default 100,
  description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_recharge_campaigns_enabled_sort
  on public.recharge_campaigns (enabled, sort_order);

-- ---------------------------------------------------------------------------
-- Compensation requests
-- ---------------------------------------------------------------------------
create table if not exists public.compensation_requests (
  id uuid primary key default gen_random_uuid(),
  boss_id uuid not null references public.profiles(id),
  related_order_id uuid,
  request_type text not null default 'after_sale',
  suggested_amount numeric(12,2) not null check (suggested_amount > 0),
  approved_amount numeric(12,2),
  balance_type text not null default 'bonus' check (balance_type in ('paid', 'bonus')),
  reason text not null default '',
  staff_note text not null default '',
  evidence_urls text not null default '',
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  applicant_id uuid references public.profiles(id),
  reviewer_id uuid references public.profiles(id),
  review_note text not null default '',
  notify_boss boolean not null default true,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create index if not exists idx_compensation_status_created
  on public.compensation_requests (status, created_at desc);

-- ---------------------------------------------------------------------------
-- Wallet settings (single-row)
-- ---------------------------------------------------------------------------
create table if not exists public.wallet_settings (
  id integer primary key default 1 check (id = 1),
  debit_order text not null default 'expiring_bonus,bonus,paid',
  bonus_can_withdraw boolean not null default false,
  bonus_has_expiry_default boolean not null default false,
  bonus_default_expire_days integer not null default 30,
  cs_max_per_request numeric(12,2) not null default 100,
  cs_max_per_day numeric(12,2) not null default 300,
  allow_cs_apply boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.wallet_settings (id) values (1)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Boss notifications (lightweight)
-- ---------------------------------------------------------------------------
create table if not exists public.boss_notifications (
  id uuid primary key default gen_random_uuid(),
  boss_id uuid not null references public.profiles(id) on delete cascade,
  title text not null default '',
  body text not null default '',
  kind text not null default 'wallet',
  related_id text not null default '',
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_boss_notifications_boss
  on public.boss_notifications (boss_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Extend payment_orders
-- ---------------------------------------------------------------------------
alter table public.payment_orders
  add column if not exists campaign_id uuid references public.recharge_campaigns(id),
  add column if not exists paid_cat_food numeric(12,2) not null default 0,
  add column if not exists bonus_cat_food numeric(12,2) not null default 0,
  add column if not exists credited_at timestamptz,
  add column if not exists credit_idempotency_key text,
  add column if not exists provider_trade_no text not null default '';

create unique index if not exists payment_orders_credit_idempotency_uidx
  on public.payment_orders (credit_idempotency_key)
  where credit_idempotency_key is not null and btrim(credit_idempotency_key) <> '';

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.mcj_ensure_wallet(p_boss_id uuid)
returns public.wallets
language plpgsql
security definer
set search_path = public
as $$
declare
  w public.wallets;
begin
  select * into w from public.wallets where boss_id = p_boss_id for update;
  if found then
    return w;
  end if;
  insert into public.wallets (boss_id)
  values (p_boss_id)
  on conflict (boss_id) do nothing;
  select * into w from public.wallets where boss_id = p_boss_id for update;
  return w;
end;
$$;

create or replace function public.mcj_wallet_credit(
  p_boss_id uuid,
  p_transaction_type text,
  p_amount numeric,
  p_balance_type text,
  p_idempotency_key text,
  p_reason text default '',
  p_internal_note text default '',
  p_operator_id uuid default null,
  p_related_order_id uuid default null,
  p_related_recharge_id uuid default null,
  p_campaign_id uuid default null,
  p_compensation_id uuid default null,
  p_expires_at timestamptz default null,
  p_recharge_rm numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  w public.wallets;
  existing public.wallet_transactions;
  tx public.wallet_transactions;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be positive';
  end if;
  if p_balance_type not in ('paid', 'bonus') then
    raise exception 'invalid balance_type';
  end if;
  if coalesce(btrim(p_idempotency_key), '') = '' then
    raise exception 'idempotency_key required';
  end if;

  select * into existing
  from public.wallet_transactions
  where idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('ok', true, 'duplicate', true, 'transaction', to_jsonb(existing));
  end if;

  w := public.mcj_ensure_wallet(p_boss_id);
  if w.frozen then
    raise exception 'wallet is frozen';
  end if;

  if p_balance_type = 'paid' then
    update public.wallets
      set paid_balance = paid_balance + p_amount,
          total_balance = total_balance + p_amount,
          total_paid_in = total_paid_in + p_amount,
          total_recharge_rm = total_recharge_rm + greatest(coalesce(p_recharge_rm, 0), 0),
          updated_at = now()
      where boss_id = p_boss_id
      returning * into w;
  else
    update public.wallets
      set bonus_balance = bonus_balance + p_amount,
          total_balance = total_balance + p_amount,
          total_bonus_in = total_bonus_in + p_amount,
          total_compensation = case
            when p_transaction_type in ('platform_compensation', 'activity_reward', 'invite_reward')
              then total_compensation + p_amount
            else total_compensation
          end,
          updated_at = now()
      where boss_id = p_boss_id
      returning * into w;
  end if;

  insert into public.wallet_transactions (
    boss_id, transaction_type, amount, balance_type, direction,
    related_order_id, related_recharge_id, campaign_id, compensation_id,
    reason, internal_note, operator_id, idempotency_key,
    paid_balance_after, bonus_balance_after, total_balance_after, expires_at
  ) values (
    p_boss_id, p_transaction_type, p_amount, p_balance_type, 'credit',
    p_related_order_id, p_related_recharge_id, p_campaign_id, p_compensation_id,
    coalesce(p_reason, ''), coalesce(p_internal_note, ''), p_operator_id, p_idempotency_key,
    w.paid_balance, w.bonus_balance, w.total_balance, p_expires_at
  )
  returning * into tx;

  return jsonb_build_object('ok', true, 'duplicate', false, 'wallet', to_jsonb(w), 'transaction', to_jsonb(tx));
exception
  when unique_violation then
    select * into existing from public.wallet_transactions where idempotency_key = p_idempotency_key;
    return jsonb_build_object('ok', true, 'duplicate', true, 'transaction', to_jsonb(existing));
end;
$$;

create or replace function public.mcj_wallet_debit(
  p_boss_id uuid,
  p_transaction_type text,
  p_amount numeric,
  p_idempotency_key text,
  p_reason text default '',
  p_internal_note text default '',
  p_operator_id uuid default null,
  p_related_order_id uuid default null,
  p_prefer_balance_type text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  w public.wallets;
  remaining numeric;
  take_bonus numeric := 0;
  take_paid numeric := 0;
  existing public.wallet_transactions;
  txs jsonb := '[]'::jsonb;
  tx public.wallet_transactions;
  settings public.wallet_settings;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be positive';
  end if;
  if coalesce(btrim(p_idempotency_key), '') = '' then
    raise exception 'idempotency_key required';
  end if;

  select * into existing from public.wallet_transactions where idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('ok', true, 'duplicate', true, 'transaction', to_jsonb(existing));
  end if;

  select * into settings from public.wallet_settings where id = 1;
  w := public.mcj_ensure_wallet(p_boss_id);
  if w.frozen then
    raise exception 'wallet is frozen';
  end if;
  if w.total_balance < p_amount then
    raise exception 'insufficient balance';
  end if;

  remaining := p_amount;
  if p_prefer_balance_type = 'paid' then
    take_paid := least(w.paid_balance, remaining);
    remaining := remaining - take_paid;
    take_bonus := least(w.bonus_balance, remaining);
  elsif p_prefer_balance_type = 'bonus' then
    take_bonus := least(w.bonus_balance, remaining);
    remaining := remaining - take_bonus;
    take_paid := least(w.paid_balance, remaining);
  else
    -- default: bonus first, then paid
    take_bonus := least(w.bonus_balance, remaining);
    remaining := remaining - take_bonus;
    take_paid := least(w.paid_balance, remaining);
  end if;

  if take_bonus + take_paid < p_amount then
    raise exception 'insufficient balance';
  end if;

  update public.wallets
    set paid_balance = paid_balance - take_paid,
        bonus_balance = bonus_balance - take_bonus,
        total_balance = total_balance - (take_paid + take_bonus),
        total_spent = total_spent + (take_paid + take_bonus),
        updated_at = now()
    where boss_id = p_boss_id
    returning * into w;

  if take_bonus > 0 then
    insert into public.wallet_transactions (
      boss_id, transaction_type, amount, balance_type, direction,
      related_order_id, reason, internal_note, operator_id, idempotency_key,
      paid_balance_after, bonus_balance_after, total_balance_after
    ) values (
      p_boss_id, p_transaction_type, take_bonus, 'bonus', 'debit',
      p_related_order_id, coalesce(p_reason, ''), coalesce(p_internal_note, ''), p_operator_id,
      p_idempotency_key || ':bonus',
      w.paid_balance, w.bonus_balance, w.total_balance
    ) returning * into tx;
    txs := txs || jsonb_build_array(to_jsonb(tx));
  end if;

  if take_paid > 0 then
    insert into public.wallet_transactions (
      boss_id, transaction_type, amount, balance_type, direction,
      related_order_id, reason, internal_note, operator_id, idempotency_key,
      paid_balance_after, bonus_balance_after, total_balance_after
    ) values (
      p_boss_id, p_transaction_type, take_paid, 'paid', 'debit',
      p_related_order_id, coalesce(p_reason, ''), coalesce(p_internal_note, ''), p_operator_id,
      case when take_bonus > 0 then p_idempotency_key || ':paid' else p_idempotency_key end,
      w.paid_balance, w.bonus_balance, w.total_balance
    ) returning * into tx;
    txs := txs || jsonb_build_array(to_jsonb(tx));
  end if;

  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'wallet', to_jsonb(w),
    'debited_paid', take_paid,
    'debited_bonus', take_bonus,
    'transactions', txs
  );
exception
  when unique_violation then
    select * into existing from public.wallet_transactions where idempotency_key = p_idempotency_key or idempotency_key like p_idempotency_key || ':%' limit 1;
    return jsonb_build_object('ok', true, 'duplicate', true, 'transaction', to_jsonb(existing));
end;
$$;

-- Atomic recharge credit from payment callback
create or replace function public.mcj_wallet_credit_recharge(
  p_payment_no text,
  p_provider_trade_no text default '',
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  po public.payment_orders;
  key text;
  paid_amt numeric;
  bonus_amt numeric;
  paid_res jsonb;
  bonus_res jsonb;
begin
  select * into po from public.payment_orders where payment_no = p_payment_no for update;
  if not found then
    raise exception 'payment order not found';
  end if;

  if po.credited_at is not null or po.status = 'paid' then
    return jsonb_build_object('ok', true, 'duplicate', true, 'payment_order', to_jsonb(po));
  end if;

  key := coalesce(nullif(btrim(p_idempotency_key), ''), 'recharge:' || po.payment_no);
  paid_amt := coalesce(nullif(po.paid_cat_food, 0), po.cat_food_amount, po.amount, 0);
  bonus_amt := coalesce(po.bonus_cat_food, 0);

  if paid_amt > 0 then
    paid_res := public.mcj_wallet_credit(
      po.boss_id, 'recharge', paid_amt, 'paid', key || ':paid',
      '充值到账', '', null, null, po.id, po.campaign_id, null, null, po.amount
    );
  end if;

  if bonus_amt > 0 then
    bonus_res := public.mcj_wallet_credit(
      po.boss_id, 'recharge_bonus', bonus_amt, 'bonus', key || ':bonus',
      '充值活动赠送', '', null, null, po.id, po.campaign_id, null, null, 0
    );
  end if;

  update public.payment_orders
    set status = 'paid',
        paid_at = coalesce(paid_at, now()),
        credited_at = now(),
        credit_idempotency_key = key,
        provider_trade_no = coalesce(nullif(btrim(p_provider_trade_no), ''), provider_trade_no),
        updated_at = now()
    where id = po.id
    returning * into po;

  insert into public.boss_notifications (boss_id, title, body, kind, related_id)
  values (
    po.boss_id,
    '充值到账',
    format('充值成功：+%s 充值猫粮%s。订单 %s',
      paid_amt::text,
      case when bonus_amt > 0 then format('，+%s 赠送猫粮', bonus_amt::text) else '' end,
      po.payment_no
    ),
    'recharge',
    po.payment_no
  );

  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'payment_order', to_jsonb(po),
    'paid', paid_res,
    'bonus', bonus_res
  );
end;
$$;

grant execute on function public.mcj_ensure_wallet(uuid) to service_role;
grant execute on function public.mcj_wallet_credit(uuid, text, numeric, text, text, text, text, uuid, uuid, uuid, uuid, uuid, timestamptz, numeric) to service_role;
grant execute on function public.mcj_wallet_debit(uuid, text, numeric, text, text, text, uuid, uuid, text) to service_role;
grant execute on function public.mcj_wallet_credit_recharge(text, text, text) to service_role;

notify pgrst, 'reload schema';
