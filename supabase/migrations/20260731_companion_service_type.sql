-- 2026-07-31: companion_profiles.service_type（陪玩服务 / 陪聊服务）
-- 与 game（游戏分类）分离，禁止把游戏名写入服务类型。

alter table public.companion_profiles
  add column if not exists service_type text not null default '陪玩服务';

comment on column public.companion_profiles.service_type is
  '服务类型：陪玩服务 / 陪聊服务；可多选，逗号分隔';

-- 仅回填空值；已有显式 service_type 不覆盖
update public.companion_profiles
set service_type = '陪玩服务'
where coalesce(nullif(trim(service_type), ''), '') = ''
  and coalesce(nullif(trim(game), ''), '') <> '';

update public.companion_profiles
set service_type = '陪聊服务'
where (
  coalesce(service_type, '') in ('', '陪玩服务')
  and (
    main_service ~ '(陪聊|语音|语聊|聊天)'
    or coalesce(tags, '') ~ '(陪聊|语音|语聊|聊天)'
  )
  and coalesce(nullif(trim(game), ''), '') = ''
);
