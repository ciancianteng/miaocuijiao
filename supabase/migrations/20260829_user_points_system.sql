-- Real loyalty points (积分) ledger — no mock balances.
-- Rate (application): 1 猫粮 / ≈ RM1 paid = 10 points, from orders.paid_cat_food (fallback total_amount).

create table if not exists public.user_points (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  total_points numeric(14, 2) not null default 0 check (total_points >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.point_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  points numeric(14, 2) not null,
  type text not null check (type in ('earn', 'redeem', 'admin_adjust')),
  description text not null default '',
  operator_id uuid,
  balance_after numeric(14, 2),
  created_at timestamptz not null default now()
);

-- Same order can only earn points once.
create unique index if not exists uniq_point_transactions_earn_order
  on public.point_transactions (order_id)
  where type = 'earn' and order_id is not null;

create index if not exists idx_point_transactions_user_created
  on public.point_transactions (user_id, created_at desc);

create index if not exists idx_point_transactions_type_created
  on public.point_transactions (type, created_at desc);

alter table public.user_points enable row level security;
alter table public.point_transactions enable row level security;

grant select, insert, update, delete on public.user_points to service_role;
grant select, insert, update, delete on public.point_transactions to service_role;

-- Atomic apply: insert ledger row + update total_points.
create or replace function public.mcj_apply_points(
  p_user_id uuid,
  p_points numeric,
  p_type text,
  p_order_id uuid default null,
  p_description text default '',
  p_operator_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type text := lower(trim(coalesce(p_type, '')));
  v_delta numeric := round(coalesce(p_points, 0)::numeric, 2);
  v_row public.user_points%rowtype;
  v_tx public.point_transactions%rowtype;
  v_next numeric;
begin
  if p_user_id is null then
    raise exception 'user_id required' using errcode = '22023';
  end if;
  if v_type not in ('earn', 'redeem', 'admin_adjust') then
    raise exception 'invalid points type' using errcode = '22023';
  end if;
  if v_delta = 0 then
    raise exception 'points delta must be non-zero' using errcode = '22023';
  end if;
  if v_type = 'earn' and v_delta < 0 then
    raise exception 'earn points must be positive' using errcode = '22023';
  end if;
  if v_type = 'redeem' and v_delta > 0 then
    v_delta := -abs(v_delta);
  end if;

  insert into public.user_points (user_id, total_points, created_at, updated_at)
  values (p_user_id, 0, now(), now())
  on conflict (user_id) do nothing;

  select * into v_row from public.user_points where user_id = p_user_id for update;
  v_next := round(coalesce(v_row.total_points, 0) + v_delta, 2);
  if v_next < 0 then
    raise exception '积分不足，无法扣减' using errcode = 'P0001';
  end if;

  begin
    insert into public.point_transactions (
      user_id, order_id, points, type, description, operator_id, balance_after, created_at
    ) values (
      p_user_id,
      p_order_id,
      v_delta,
      v_type,
      coalesce(p_description, ''),
      p_operator_id,
      v_next,
      now()
    )
    returning * into v_tx;
  exception
    when unique_violation then
      return jsonb_build_object(
        'ok', true,
        'duplicate', true,
        'message', '该订单已发放过积分',
        'total_points', v_row.total_points
      );
  end;

  update public.user_points
  set total_points = v_next, updated_at = now()
  where user_id = p_user_id;

  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'transaction_id', v_tx.id,
    'points', v_delta,
    'type', v_type,
    'total_points', v_next,
    'order_id', p_order_id
  );
end;
$$;

grant execute on function public.mcj_apply_points(uuid, numeric, text, uuid, text, uuid) to service_role;
