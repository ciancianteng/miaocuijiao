-- Platform config center: non-secret settings stay in platform_settings.data
-- Secret VALUES never stored in plaintext. Encrypted vault + metadata only.

create table if not exists public.platform_secret_vault (
  secret_key text primary key,
  ciphertext text not null default '',
  configured boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  note text not null default ''
);

create table if not exists public.platform_config_logs (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid,
  admin_role text not null default '',
  config_type text not null default '',
  action text not null default '',
  before_status text not null default '',
  after_status text not null default '',
  reason text not null default '',
  ip text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists idx_platform_config_logs_time on public.platform_config_logs (created_at desc);

alter table public.platform_secret_vault enable row level security;
alter table public.platform_config_logs enable row level security;

grant select, insert, update, delete on public.platform_secret_vault to service_role;
grant select, insert on public.platform_config_logs to service_role;

-- Expand default public config keys (merge-safe; does not wipe existing data)
insert into public.platform_settings (id, data)
values (
  'global',
  '{
    "siteName": "妙脆角",
    "siteNameEn": "Meow Cui Jiao",
    "companyName": "MEOW CUI JIAO ENTERPRISE",
    "contactEmail": "",
    "supportContact": "",
    "timezone": "Asia/Kuala_Lumpur",
    "defaultCurrency": "RM",
    "catFoodDisplayName": "猫粮",
    "maintenanceMessage": "",
    "termsUrl": "",
    "privacyUrl": "",
    "registerOpen": true,
    "allowBossOrder": true,
    "allowCompanionApply": true,
    "allowCustomerServiceLogin": true,
    "allowCompanionGrab": true,
    "allowWithdraw": true,
    "allowRecharge": true,
    "maintenanceMode": false,
    "showAnnouncements": true,
    "gameplayMallOpen": true,
    "defaultCommissionRate": 20,
    "defaultRebateRate": 0,
    "defaultDeposit": 100,
    "defaultLevel": "Lv1",
    "sessionHours": 168,
    "loginFailLockCount": 5,
    "adminTwoFactorRequired": false,
    "sensitiveChangeReverify": true,
    "mailFromName": "MEOW CUI JIAO",
    "mailFromEmail": "",
    "smtpHost": "",
    "smtpPort": 587,
    "smtpTls": true,
    "aiEnabled": false,
    "aiModel": "",
    "aiSystemPrompt": "",
    "aiDailyLimit": 100,
    "aiHandoffRule": "用户要求人工或敏感纠纷时转客服",
    "paymentChannelsPublic": {}
  }'::jsonb
)
on conflict (id) do nothing;

notify pgrst, 'reload schema';
