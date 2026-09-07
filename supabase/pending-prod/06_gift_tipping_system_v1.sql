-- Gift / tipping system V1 + accounting (PR179)
-- Safe to re-run. Does not drop data.

-- 1) Catalog metadata for rarity / effect (admin-configurable, not hardcoded)
alter table public.gifts
  add column if not exists rarity text not null default 'common';
alter table public.gifts
  add column if not exists effect_type text not null default 'float';

comment on column public.gifts.rarity is 'common|rare|epic|legendary — display + future achievement hooks';
comment on column public.gifts.effect_type is 'none|float|burst|rain — client animation effect';

-- 2) Gift transaction channel for accounting
alter table public.gift_transactions
  add column if not exists source_channel text not null default 'companion_detail';

comment on column public.gift_transactions.source_channel is 'companion_detail|tip_sheet|order_related|admin|other';

-- 3) Permanent companion gift wall (aggregated received gifts)
create table if not exists public.companion_gift_wall (
  id uuid primary key default gen_random_uuid(),
  companion_id uuid not null references public.profiles(id) on delete cascade,
  gift_id uuid references public.gifts(id) on delete set null,
  gift_name text not null default '',
  icon_url text not null default '',
  rarity text not null default 'common',
  effect_type text not null default 'float',
  quantity integer not null default 0 check (quantity >= 0),
  total_value numeric(14,2) not null default 0 check (total_value >= 0),
  last_received_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (companion_id, gift_id)
);

create index if not exists idx_companion_gift_wall_companion
  on public.companion_gift_wall (companion_id, quantity desc);

alter table public.companion_gift_wall enable row level security;
grant select, insert, update, delete on public.companion_gift_wall to service_role;

-- 4) Extensibility stub for future achievement / badge / reward engine
create table if not exists public.reward_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  actor_id uuid,
  subject_id uuid,
  subject_type text not null default 'companion',
  payload jsonb not null default '{}'::jsonb,
  source_table text not null default '',
  source_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_reward_events_subject
  on public.reward_events (subject_type, subject_id, created_at desc);
create index if not exists idx_reward_events_type
  on public.reward_events (event_type, created_at desc);

alter table public.reward_events enable row level security;
grant select, insert on public.reward_events to service_role;

comment on table public.reward_events is 'Append-only reward/achievement hook; gift sends emit gift_received events';

-- 5) Harden paid-only debit when prefer=paid (no bonus fallback)
-- Gift/tip spends must use CS-approved recharge (paid_balance) only.
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
) returns jsonb
language plpgsql
security definer
as $$
declare
  w public.wallets%rowtype;
  settings public.wallet_settings%rowtype;
  existing public.wallet_transactions%rowtype;
  remaining numeric;
  take_paid numeric := 0;
  take_bonus numeric := 0;
  tx public.wallet_transactions%rowtype;
  txs jsonb := '[]'::jsonb;
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

  if coalesce(p_prefer_balance_type, '') = 'paid' then
    if w.paid_balance < p_amount then
      raise exception 'insufficient paid balance';
    end if;
    take_paid := p_amount;
    take_bonus := 0;
  else
    if w.total_balance < p_amount then
      raise exception 'insufficient balance';
    end if;
    remaining := p_amount;
    if p_prefer_balance_type = 'bonus' then
      take_bonus := least(w.bonus_balance, remaining);
      remaining := remaining - take_bonus;
      take_paid := least(w.paid_balance, remaining);
    else
      take_bonus := least(w.bonus_balance, remaining);
      remaining := remaining - take_bonus;
      take_paid := least(w.paid_balance, remaining);
    end if;
    if take_bonus + take_paid < p_amount then
      raise exception 'insufficient balance';
    end if;
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
    'transactions', txs,
    'wallet', to_jsonb(w)
  );
end;
$$;

-- 6) Gift income settlement status (Received → Pending settlement → Available → Withdrawn)
alter table public.gift_transactions
  add column if not exists settlement_status text not null default 'received';
alter table public.gift_transactions
  add column if not exists income_transaction_id uuid;
alter table public.gift_transactions
  add column if not exists withdrawal_id uuid;
alter table public.gift_transactions
  add column if not exists received_at timestamptz;
alter table public.gift_transactions
  add column if not exists available_at timestamptz;
alter table public.gift_transactions
  add column if not exists withdrawn_at timestamptz;
alter table public.gift_transactions
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'gift_transactions_settlement_status_check'
  ) then
    alter table public.gift_transactions
      add constraint gift_transactions_settlement_status_check
      check (settlement_status in ('received', 'pending_settlement', 'available', 'withdrawn'));
  end if;
exception when others then
  null;
end $$;

update public.gift_transactions
  set settlement_status = 'available',
      received_at = coalesce(received_at, created_at),
      available_at = coalesce(available_at, created_at)
  where settlement_status = 'received'
    and available_at is null
    and created_at < now() - interval '1 minute';

create index if not exists idx_gift_tx_settlement
  on public.gift_transactions (receiver_companion_id, settlement_status, created_at asc);

comment on column public.gift_transactions.settlement_status is
  'received|pending_settlement|available|withdrawn — companion gift income lifecycle';

-- 7) Atomic gift/tip send: wallet debit + gift_transactions + companion income
create or replace function public.mcj_send_gift_tip(
  p_boss_id uuid,
  p_companion_id uuid,
  p_idempotency_key text,
  p_kind text,
  p_gift_id uuid,
  p_gift_name text,
  p_quantity integer,
  p_gross numeric,
  p_commission_rate numeric,
  p_commission_amount numeric,
  p_companion_income numeric,
  p_message text default '',
  p_source_channel text default 'companion_detail',
  p_related_order_id uuid default null,
  p_tx_no text default null
) returns jsonb
language plpgsql
security definer
as $$
declare
  existing public.gift_transactions%rowtype;
  debit_result jsonb;
  tx public.gift_transactions%rowtype;
  income public.transactions%rowtype;
  tx_no text;
  now_ts timestamptz := now();
begin
  if coalesce(btrim(p_idempotency_key), '') = '' then
    raise exception 'idempotency_key required';
  end if;
  if p_gross is null or p_gross <= 0 then
    raise exception 'gross must be positive';
  end if;
  if coalesce(p_kind, '') not in ('gift', 'tip') then
    raise exception 'kind must be gift or tip';
  end if;

  select * into existing
    from public.gift_transactions
   where idempotency_key = p_idempotency_key
   limit 1;
  if found then
    return jsonb_build_object('ok', true, 'duplicate', true, 'transaction', to_jsonb(existing), 'tx_no', existing.tx_no);
  end if;

  debit_result := public.mcj_wallet_debit(
    p_boss_id,
    p_kind,
    p_gross,
    'gift:' || p_idempotency_key,
    coalesce(p_gift_name, p_kind) || ' x' || coalesce(p_quantity, 1),
    '',
    p_boss_id,
    p_related_order_id,
    'paid'
  );

  tx_no := coalesce(nullif(btrim(p_tx_no), ''), 'GIFT' || to_char(now_ts, 'YYMMDDHH24MISS') || substr(md5(p_idempotency_key), 1, 6));

  insert into public.gift_transactions (
    tx_no, sender_boss_id, receiver_companion_id, gift_id, gift_name, quantity,
    gross_cat_food, platform_commission_rate, platform_commission_amount, companion_income,
    message, related_order_id, kind, idempotency_key, source_channel,
    settlement_status, received_at, created_at, updated_at
  ) values (
    tx_no, p_boss_id, p_companion_id, p_gift_id, coalesce(p_gift_name, ''), greatest(coalesce(p_quantity, 1), 1),
    p_gross, coalesce(p_commission_rate, 0), coalesce(p_commission_amount, 0), coalesce(p_companion_income, 0),
    coalesce(p_message, ''), p_related_order_id, p_kind, p_idempotency_key, coalesce(nullif(btrim(p_source_channel), ''), 'companion_detail'),
    'received', now_ts, now_ts, now_ts
  )
  on conflict (idempotency_key) do nothing
  returning * into tx;

  if tx.id is null then
    select * into tx from public.gift_transactions where idempotency_key = p_idempotency_key limit 1;
    return jsonb_build_object('ok', true, 'duplicate', true, 'transaction', to_jsonb(tx), 'tx_no', tx.tx_no, 'debit', debit_result);
  end if;

  if coalesce(p_companion_income, 0) > 0 then
    select * into income
      from public.transactions
     where user_id = p_companion_id
       and transaction_type = 'companion_income'
       and note = 'MCJ_GIFT_INCOME:' || tx_no
     limit 1;
    if not found then
      insert into public.transactions (
        user_id, order_id, transaction_type, amount, status, note, created_at
      ) values (
        p_companion_id, null, 'companion_income', p_companion_income, 'completed',
        'MCJ_GIFT_INCOME:' || tx_no, now_ts
      ) returning * into income;
    end if;

    update public.gift_transactions
       set settlement_status = 'available',
           available_at = now_ts,
           income_transaction_id = income.id,
           updated_at = now_ts
     where id = tx.id
     returning * into tx;
  end if;

  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'transaction', to_jsonb(tx),
    'tx_no', tx.tx_no,
    'income', to_jsonb(income),
    'debit', debit_result
  );
exception
  when unique_violation then
    select * into existing from public.gift_transactions where idempotency_key = p_idempotency_key limit 1;
    return jsonb_build_object('ok', true, 'duplicate', true, 'transaction', to_jsonb(existing), 'tx_no', existing.tx_no);
end;
$$;

grant execute on function public.mcj_send_gift_tip(
  uuid, uuid, text, text, uuid, text, integer, numeric, numeric, numeric, numeric, text, text, uuid, text
) to service_role;

notify pgrst, 'reload schema';
