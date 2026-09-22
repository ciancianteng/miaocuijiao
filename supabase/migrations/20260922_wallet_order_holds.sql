-- Cat-food order holds: reserve on pay, finalize on COMPLETE, release on cancel.
-- Safe to re-run. Staging first, then pending-prod.

alter table public.wallets
  add column if not exists held_balance numeric(12,2) not null default 0
    check (held_balance >= 0);

comment on column public.wallets.held_balance is
  'Cat-food reserved for unpaid-completion orders. available = paid_balance + bonus_balance; ledger total includes held.';

-- Keep total_balance = paid + bonus + held (recompute trigger optional; RPCs maintain invariant).

create table if not exists public.wallet_order_holds (
  id uuid primary key default gen_random_uuid(),
  boss_id uuid not null references public.profiles(id) on delete cascade,
  order_id uuid not null,
  order_no text not null default '',
  amount numeric(12,2) not null check (amount > 0),
  status text not null default 'held'
    check (status in ('held', 'finalized', 'released')),
  hold_idempotency_key text not null,
  finalize_idempotency_key text,
  release_idempotency_key text,
  paid_taken numeric(12,2) not null default 0,
  bonus_taken numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finalized_at timestamptz,
  released_at timestamptz,
  unique (order_id),
  unique (hold_idempotency_key)
);

create index if not exists idx_wallet_order_holds_boss_status
  on public.wallet_order_holds (boss_id, status);

create index if not exists idx_wallet_order_holds_order
  on public.wallet_order_holds (order_id);

-- ─── HOLD ─────────────────────────────────────────────────────────────
create or replace function public.mcj_wallet_hold(
  p_boss_id uuid,
  p_order_id uuid,
  p_order_no text,
  p_amount numeric,
  p_idempotency_key text,
  p_reason text default '',
  p_operator_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  w public.wallets%rowtype;
  existing public.wallet_order_holds%rowtype;
  remaining numeric;
  take_paid numeric := 0;
  take_bonus numeric := 0;
  avail numeric;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid amount';
  end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    raise exception 'idempotency_key required';
  end if;

  select * into existing from public.wallet_order_holds where order_id = p_order_id;
  if found then
    return jsonb_build_object('ok', true, 'duplicate', true, 'hold', to_jsonb(existing));
  end if;

  select * into existing from public.wallet_order_holds where hold_idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('ok', true, 'duplicate', true, 'hold', to_jsonb(existing));
  end if;

  perform public.mcj_ensure_wallet(p_boss_id);
  select * into w from public.wallets where boss_id = p_boss_id for update;
  if w.frozen then
    raise exception 'wallet frozen';
  end if;

  avail := coalesce(w.paid_balance, 0) + coalesce(w.bonus_balance, 0);
  if avail < p_amount then
    raise exception 'insufficient balance';
  end if;

  remaining := p_amount;
  take_bonus := least(w.bonus_balance, remaining);
  remaining := remaining - take_bonus;
  take_paid := least(w.paid_balance, remaining);
  remaining := remaining - take_paid;
  if remaining > 0.0001 then
    raise exception 'insufficient balance';
  end if;

  update public.wallets
    set paid_balance = paid_balance - take_paid,
        bonus_balance = bonus_balance - take_bonus,
        held_balance = coalesce(held_balance, 0) + p_amount,
        updated_at = now()
  where boss_id = p_boss_id
  returning * into w;

  insert into public.wallet_order_holds (
    boss_id, order_id, order_no, amount, status, hold_idempotency_key, paid_taken, bonus_taken
  ) values (
    p_boss_id, p_order_id, coalesce(p_order_no, ''), p_amount, 'held', p_idempotency_key, take_paid, take_bonus
  ) returning * into existing;

  insert into public.wallet_transactions (
    boss_id, transaction_type, amount, balance_type, direction,
    related_order_id, reason, internal_note, operator_id, idempotency_key,
    paid_balance_after, bonus_balance_after, total_balance_after
  ) values (
    p_boss_id, 'order_hold', p_amount, 'paid', 'debit',
    p_order_id, coalesce(p_reason, ''), 'catfood hold reserve', p_operator_id, p_idempotency_key,
    w.paid_balance, w.bonus_balance, w.paid_balance + w.bonus_balance + coalesce(w.held_balance, 0)
  );

  return jsonb_build_object('ok', true, 'duplicate', false, 'hold', to_jsonb(existing), 'wallet', to_jsonb(w));
exception
  when unique_violation then
    select * into existing from public.wallet_order_holds where order_id = p_order_id or hold_idempotency_key = p_idempotency_key limit 1;
    return jsonb_build_object('ok', true, 'duplicate', true, 'hold', to_jsonb(existing));
end;
$$;

-- ─── FINALIZE (on COMPLETE) ───────────────────────────────────────────
create or replace function public.mcj_wallet_finalize_hold(
  p_order_id uuid,
  p_idempotency_key text,
  p_reason text default '',
  p_operator_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  h public.wallet_order_holds%rowtype;
  w public.wallets%rowtype;
begin
  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    raise exception 'idempotency_key required';
  end if;

  select * into h from public.wallet_order_holds where order_id = p_order_id for update;
  if not found then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'no_hold');
  end if;
  if h.status = 'finalized' then
    return jsonb_build_object('ok', true, 'duplicate', true, 'hold', to_jsonb(h));
  end if;
  if h.status = 'released' then
    raise exception 'hold already released';
  end if;

  select * into w from public.wallets where boss_id = h.boss_id for update;
  if coalesce(w.held_balance, 0) < h.amount then
    raise exception 'held_balance mismatch';
  end if;

  update public.wallets
    set held_balance = held_balance - h.amount,
        total_balance = greatest(0, total_balance - h.amount),
        total_spent = coalesce(total_spent, 0) + h.amount,
        updated_at = now()
  where boss_id = h.boss_id
  returning * into w;

  update public.wallet_order_holds
    set status = 'finalized',
        finalize_idempotency_key = p_idempotency_key,
        finalized_at = now(),
        updated_at = now()
  where id = h.id
  returning * into h;

  insert into public.wallet_transactions (
    boss_id, transaction_type, amount, balance_type, direction,
    related_order_id, reason, internal_note, operator_id, idempotency_key,
    paid_balance_after, bonus_balance_after, total_balance_after
  ) values (
    h.boss_id, 'order_payment', h.amount, 'paid', 'debit',
    h.order_id, coalesce(p_reason, ''), 'catfood hold finalize on complete', p_operator_id, p_idempotency_key,
    w.paid_balance, w.bonus_balance, w.paid_balance + w.bonus_balance + coalesce(w.held_balance, 0)
  )
  on conflict (idempotency_key) do nothing;

  return jsonb_build_object('ok', true, 'duplicate', false, 'hold', to_jsonb(h), 'wallet', to_jsonb(w));
exception
  when unique_violation then
    select * into h from public.wallet_order_holds where order_id = p_order_id;
    return jsonb_build_object('ok', true, 'duplicate', true, 'hold', to_jsonb(h));
end;
$$;

-- ─── RELEASE (cancel / fail) ──────────────────────────────────────────
create or replace function public.mcj_wallet_release_hold(
  p_order_id uuid,
  p_idempotency_key text,
  p_reason text default '',
  p_operator_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  h public.wallet_order_holds%rowtype;
  w public.wallets%rowtype;
begin
  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    raise exception 'idempotency_key required';
  end if;

  select * into h from public.wallet_order_holds where order_id = p_order_id for update;
  if not found then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'no_hold');
  end if;
  if h.status = 'released' then
    return jsonb_build_object('ok', true, 'duplicate', true, 'hold', to_jsonb(h));
  end if;
  if h.status = 'finalized' then
    raise exception 'hold already finalized';
  end if;

  select * into w from public.wallets where boss_id = h.boss_id for update;
  if coalesce(w.held_balance, 0) < h.amount then
    raise exception 'held_balance mismatch';
  end if;

  update public.wallets
    set held_balance = held_balance - h.amount,
        paid_balance = paid_balance + coalesce(h.paid_taken, 0),
        bonus_balance = bonus_balance + coalesce(h.bonus_taken, 0),
        updated_at = now()
  where boss_id = h.boss_id
  returning * into w;

  update public.wallet_order_holds
    set status = 'released',
        release_idempotency_key = p_idempotency_key,
        released_at = now(),
        updated_at = now()
  where id = h.id
  returning * into h;

  insert into public.wallet_transactions (
    boss_id, transaction_type, amount, balance_type, direction,
    related_order_id, reason, internal_note, operator_id, idempotency_key,
    paid_balance_after, bonus_balance_after, total_balance_after
  ) values (
    h.boss_id, 'order_hold_release', h.amount, 'paid', 'credit',
    h.order_id, coalesce(p_reason, ''), 'catfood hold release', p_operator_id, p_idempotency_key,
    w.paid_balance, w.bonus_balance, w.paid_balance + w.bonus_balance + coalesce(w.held_balance, 0)
  )
  on conflict (idempotency_key) do nothing;

  return jsonb_build_object('ok', true, 'duplicate', false, 'hold', to_jsonb(h), 'wallet', to_jsonb(w));
exception
  when unique_violation then
    select * into h from public.wallet_order_holds where order_id = p_order_id;
    return jsonb_build_object('ok', true, 'duplicate', true, 'hold', to_jsonb(h));
end;
$$;

grant execute on function public.mcj_wallet_hold(uuid, uuid, text, numeric, text, text, uuid) to service_role;
grant execute on function public.mcj_wallet_finalize_hold(uuid, text, text, uuid) to service_role;
grant execute on function public.mcj_wallet_release_hold(uuid, text, text, uuid) to service_role;

notify pgrst, 'reload schema';
