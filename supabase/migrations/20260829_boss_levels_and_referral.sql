-- Boss Portal: level tiers (points-based) + referral/promotion rewards.
-- Builds on user_points / point_transactions (20260829_user_points_system.sql).
-- Does NOT seed fake user balances — only configurable tier/rule defaults.

-- ─────────────────────────────────────────────
-- 1) Boss level tiers (门槛 = 累计积分 total_points)
-- ─────────────────────────────────────────────
create table if not exists public.boss_level_tiers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  level_rank int not null unique check (level_rank >= 1),
  min_points numeric(14, 2) not null default 0 check (min_points >= 0),
  badge_label text not null default '',
  benefits jsonb not null default '{}'::jsonb,
  sort int not null default 0,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_boss_level_tiers_enabled_rank
  on public.boss_level_tiers (enabled, level_rank);

alter table public.boss_level_tiers enable row level security;
grant select, insert, update, delete on public.boss_level_tiers to service_role;

-- Default tiers (config only). Adjust in Admin later; not mock user data.
insert into public.boss_level_tiers (code, name, level_rank, min_points, badge_label, sort, enabled)
values
  ('newbie', '萌新老板', 1, 0, '萌新老板', 1, true),
  ('bronze', '青铜老板', 2, 1000, '青铜老板', 2, true),
  ('silver', '白银老板', 3, 3000, '白银老板', 3, true),
  ('gold', '黄金老板', 4, 6000, '黄金老板', 4, true),
  ('platinum', '铂金老板', 5, 15000, '铂金老板', 5, true),
  ('diamond', '钻石老板', 6, 40000, '钻石老板', 6, true)
on conflict (code) do nothing;

-- Resolve current/next tier from a points total (read model helper).
create or replace function public.mcj_boss_level_from_points(p_points numeric)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_pts numeric := greatest(0, coalesce(p_points, 0));
  v_cur public.boss_level_tiers%rowtype;
  v_next public.boss_level_tiers%rowtype;
  v_need numeric;
  v_progressive numeric;
  v_span numeric;
begin
  select * into v_cur
  from public.boss_level_tiers
  where enabled = true and min_points <= v_pts
  order by level_rank desc
  limit 1;

  if v_cur.id is null then
    return jsonb_build_object(
      'ok', true,
      'total_points', v_pts,
      'current', null,
      'next', null,
      'points_to_next', null,
      'progress_ratio', 0
    );
  end if;

  select * into v_next
  from public.boss_level_tiers
  where enabled = true and level_rank > v_cur.level_rank
  order by level_rank asc
  limit 1;

  if v_next.id is null then
    return jsonb_build_object(
      'ok', true,
      'total_points', v_pts,
      'current', jsonb_build_object(
        'code', v_cur.code,
        'name', v_cur.name,
        'level_rank', v_cur.level_rank,
        'min_points', v_cur.min_points,
        'badge_label', v_cur.badge_label
      ),
      'next', null,
      'points_to_next', 0,
      'progress_ratio', 1
    );
  end if;

  v_need := greatest(0, v_next.min_points - v_pts);
  v_span := greatest(1, v_next.min_points - v_cur.min_points);
  v_progressive := least(1, greatest(0, (v_pts - v_cur.min_points) / v_span));

  return jsonb_build_object(
    'ok', true,
    'total_points', v_pts,
    'current', jsonb_build_object(
      'code', v_cur.code,
      'name', v_cur.name,
      'level_rank', v_cur.level_rank,
      'min_points', v_cur.min_points,
      'badge_label', v_cur.badge_label
    ),
    'next', jsonb_build_object(
      'code', v_next.code,
      'name', v_next.name,
      'level_rank', v_next.level_rank,
      'min_points', v_next.min_points,
      'badge_label', v_next.badge_label
    ),
    'points_to_next', v_need,
    'progress_ratio', round(v_progressive::numeric, 4)
  );
end;
$$;

grant execute on function public.mcj_boss_level_from_points(numeric) to service_role;

-- ─────────────────────────────────────────────
-- 2) Referral / 推广返利 (real binds + reward ledger)
-- ─────────────────────────────────────────────
create table if not exists public.referral_relations (
  id uuid primary key default gen_random_uuid(),
  inviter_id uuid not null references public.profiles(id) on delete cascade,
  invitee_id uuid not null references public.profiles(id) on delete cascade,
  invite_code text not null default '',
  status text not null default 'active' check (status in ('pending', 'active', 'invalid', 'blocked')),
  bound_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint referral_relations_no_self check (inviter_id <> invitee_id),
  constraint referral_relations_invitee_unique unique (invitee_id)
);

create index if not exists idx_referral_relations_inviter
  on public.referral_relations (inviter_id, status);

create index if not exists idx_referral_relations_code
  on public.referral_relations (invite_code);

create table if not exists public.referral_reward_rules (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  -- Display / cap for banner e.g. 「最高返利 30%」
  max_rebate_percent numeric(6, 2) not null default 30 check (max_rebate_percent >= 0 and max_rebate_percent <= 100),
  -- Actual rate applied on trigger base amount
  rebate_percent numeric(6, 2) not null default 0 check (rebate_percent >= 0 and rebate_percent <= 100),
  reward_asset text not null default 'cat_food' check (reward_asset in ('cat_food', 'points')),
  -- When reward is created from real activity
  trigger_event text not null check (trigger_event in (
    'invitee_register',
    'invitee_first_recharge',
    'invitee_order_completed'
  )),
  -- Both sides: inviter always; invitee optional (双方得奖励)
  credit_invitee boolean not null default false,
  invitee_fixed_cat_food numeric(12, 2) not null default 0,
  invitee_fixed_points numeric(12, 2) not null default 0,
  enabled boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.referral_reward_rules enable row level security;
grant select, insert, update, delete on public.referral_reward_rules to service_role;

insert into public.referral_reward_rules (
  code, name, max_rebate_percent, rebate_percent, reward_asset, trigger_event,
  credit_invitee, invitee_fixed_cat_food, enabled, sort
) values
  (
    'order_completed_rebate',
    '被邀请人订单完成返利',
    30,
    5,
    'cat_food',
    'invitee_order_completed',
    false,
    0,
    true,
    1
  ),
  (
    'first_recharge_both',
    '被邀请人首充双方奖励',
    30,
    10,
    'cat_food',
    'invitee_first_recharge',
    true,
    20,
    true,
    2
  )
on conflict (code) do nothing;

create table if not exists public.referral_rewards (
  id uuid primary key default gen_random_uuid(),
  relation_id uuid not null references public.referral_relations(id) on delete cascade,
  rule_id uuid references public.referral_reward_rules(id) on delete set null,
  beneficiary_id uuid not null references public.profiles(id) on delete cascade,
  inviter_id uuid not null references public.profiles(id) on delete cascade,
  invitee_id uuid not null references public.profiles(id) on delete cascade,
  -- Real source docs (at least one should be set for non-manual rows)
  order_id uuid references public.orders(id) on delete set null,
  payment_order_id uuid references public.payment_orders(id) on delete set null,
  trigger_event text not null,
  reward_asset text not null check (reward_asset in ('cat_food', 'points')),
  base_amount numeric(14, 2) not null default 0,
  rebate_percent numeric(6, 2) not null default 0,
  reward_amount numeric(14, 2) not null check (reward_amount >= 0),
  status text not null default 'credited' check (status in ('pending', 'credited', 'cancelled', 'failed')),
  wallet_tx_id uuid,
  point_tx_id uuid,
  description text not null default '',
  created_at timestamptz not null default now()
);

-- Idempotency: same beneficiary cannot earn twice from same order under same rule trigger
create unique index if not exists uniq_referral_reward_order_beneficiary
  on public.referral_rewards (beneficiary_id, order_id, trigger_event)
  where order_id is not null;

create unique index if not exists uniq_referral_reward_payment_beneficiary
  on public.referral_rewards (beneficiary_id, payment_order_id, trigger_event)
  where payment_order_id is not null;

create index if not exists idx_referral_rewards_inviter_created
  on public.referral_rewards (inviter_id, created_at desc);

create index if not exists idx_referral_rewards_beneficiary_created
  on public.referral_rewards (beneficiary_id, created_at desc);

alter table public.referral_relations enable row level security;
alter table public.referral_rewards enable row level security;
grant select, insert, update, delete on public.referral_relations to service_role;
grant select, insert, update, delete on public.referral_rewards to service_role;

-- Per-boss invite code (stable, derived storage; not fake stats)
create table if not exists public.boss_invite_codes (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  invite_code text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.boss_invite_codes enable row level security;
grant select, insert, update, delete on public.boss_invite_codes to service_role;
