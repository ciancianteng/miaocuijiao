-- 2026-07-31: companion service_ids + game_prices (id-keyed games)
-- service_type = 陪玩服务/陪聊服务（可多选，逗号分隔）
-- service_ids = services.id UUID 数组
-- game = 游戏名称（展示/兼容）
-- game_prices = { "<service_id>": price, "<name>": price }

alter table public.companion_profiles
  add column if not exists service_type text not null default '陪玩服务';

alter table public.companion_profiles
  add column if not exists service_ids jsonb not null default '[]'::jsonb;

alter table public.companion_profiles
  add column if not exists game_prices jsonb not null default '{}'::jsonb;

comment on column public.companion_profiles.service_type is
  '可提供服务：陪玩服务 / 陪聊服务；多选逗号分隔';
comment on column public.companion_profiles.service_ids is
  '可接游戏：public.services.id UUID 数组';
comment on column public.companion_profiles.game_prices is
  '各游戏价格：优先按 service_id 键，兼容游戏名键';

-- Backfill service_ids from game name match against enabled services
update public.companion_profiles cp
set service_ids = coalesce((
  select jsonb_agg(distinct s.id)
  from public.services s
  where s.enabled = true
    and (
      cp.game = s.name
      or cp.game like s.name || ',%'
      or cp.game like '%,' || s.name
      or cp.game like '%,' || s.name || ',%'
      or cp.game like '%、' || s.name || '%'
      or cp.game like '%' || s.name || '、%'
      or cp.game like '%|' || s.name || '%'
    )
), '[]'::jsonb)
where coalesce(jsonb_array_length(service_ids), 0) = 0
  and coalesce(nullif(trim(game), ''), '') <> '';

-- Ensure empty service_type gets default when they have games
update public.companion_profiles
set service_type = '陪玩服务'
where coalesce(nullif(trim(service_type), ''), '') = ''
  and (
    coalesce(nullif(trim(game), ''), '') <> ''
    or coalesce(jsonb_array_length(service_ids), 0) > 0
  );
