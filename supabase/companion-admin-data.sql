-- Companion admin real data: extend profiles + related tables + private buckets.
-- Run in Supabase SQL Editor.

-- 1) Extend companion_profiles with admin-manageable fields
alter table public.companion_profiles add column if not exists gift_commission_rate numeric(5,2) not null default 0;
alter table public.companion_profiles add column if not exists direct_rebate_rate numeric(5,2) not null default 0;
alter table public.companion_profiles add column if not exists featured boolean not null default false;
alter table public.companion_profiles add column if not exists allow_orders boolean not null default true;
alter table public.companion_profiles add column if not exists tags text not null default '';
alter table public.companion_profiles add column if not exists age integer;
alter table public.companion_profiles add column if not exists gender text not null default '';
alter table public.companion_profiles add column if not exists region text not null default '';
alter table public.companion_profiles add column if not exists main_service text not null default '';
alter table public.companion_profiles add column if not exists game_rank text not null default '';
alter table public.companion_profiles add column if not exists position text not null default '';
alter table public.companion_profiles add column if not exists voice_type text not null default '';
alter table public.companion_profiles add column if not exists schedule text not null default '';
alter table public.companion_profiles add column if not exists application_note text not null default '';
alter table public.companion_profiles add column if not exists application_status text not null default 'pending';
alter table public.companion_profiles add column if not exists application_reject_reason text not null default '';
alter table public.companion_profiles add column if not exists application_submitted_at timestamptz;
alter table public.companion_profiles add column if not exists media_status text not null default 'pending';
alter table public.companion_profiles add column if not exists media_reject_reason text not null default '';
alter table public.companion_profiles add column if not exists level_id text not null default '';
alter table public.companion_profiles add column if not exists level_effective_at timestamptz;
alter table public.companion_profiles add column if not exists commission_effective_at timestamptz;
alter table public.companion_profiles add column if not exists last_login_at timestamptz;
alter table public.companion_profiles add column if not exists contact_phone text not null default '';

-- 2) Identity verification (sensitive files stored as private storage paths)
create table if not exists public.companion_identity_verifications (
  id uuid primary key default gen_random_uuid(),
  companion_profile_id uuid not null references public.companion_profiles(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  real_name text not null default '',
  identity_no text not null default '',
  id_front_path text not null default '',
  id_back_path text not null default '',
  id_handheld_path text not null default '',
  status text not null default 'pending',
  reject_reason text not null default '',
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists idx_companion_identity_profile
  on public.companion_identity_verifications(companion_profile_id);

-- 3) Payment / settlement accounts
create table if not exists public.companion_payment_accounts (
  id uuid primary key default gen_random_uuid(),
  companion_profile_id uuid not null references public.companion_profiles(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  method text not null default '',
  bank_name text not null default '',
  account_name text not null default '',
  bank_account text not null default '',
  account_last4 text not null default '',
  tng_account text not null default '',
  alipay_account text not null default '',
  status text not null default 'pending',
  reject_reason text not null default '',
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists idx_companion_payment_profile
  on public.companion_payment_accounts(companion_profile_id);

alter table public.companion_payment_accounts add column if not exists account_last4 text not null default '';
alter table public.companion_payment_accounts add column if not exists method text not null default '';
alter table public.companion_payment_accounts add column if not exists tng_account text not null default '';
alter table public.companion_payment_accounts add column if not exists alipay_account text not null default '';
alter table public.companion_payment_accounts add column if not exists reject_reason text not null default '';
alter table public.companion_payment_accounts add column if not exists submitted_at timestamptz not null default now();
alter table public.companion_payment_accounts add column if not exists payout_bank_name text not null default '';
alter table public.companion_payment_accounts add column if not exists payout_account_number text not null default '';
alter table public.companion_payment_accounts add column if not exists payout_account_holder text not null default '';

-- 4) Media: avatar / gallery / voice
create table if not exists public.companion_media (
  id uuid primary key default gen_random_uuid(),
  companion_profile_id uuid not null references public.companion_profiles(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  media_type text not null check (media_type in ('avatar','cover','gallery','voice')),
  storage_bucket text not null default '',
  storage_path text not null default '',
  content_type text not null default '',
  duration_seconds numeric(10,2),
  status text not null default 'pending',
  reject_reason text not null default '',
  sort_order integer not null default 100,
  uploaded_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_companion_media_profile_type
  on public.companion_media(companion_profile_id, media_type, sort_order);

-- 5) Deposits
create table if not exists public.companion_deposits (
  id uuid primary key default gen_random_uuid(),
  companion_profile_id uuid not null references public.companion_profiles(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  required_amount numeric(12,2) not null default 100,
  paid_amount numeric(12,2) not null default 0,
  payment_method text not null default '',
  proof_path text not null default '',
  proof_bucket text not null default 'companion-payment-proofs',
  status text not null default 'pending',
  refund_status text not null default 'none',
  reject_reason text not null default '',
  remark text not null default '',
  paid_at timestamptz,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_companion_deposits_profile
  on public.companion_deposits(companion_profile_id, created_at desc);

-- 6) Admin audit logs
create table if not exists public.admin_operation_logs (
  id uuid primary key default gen_random_uuid(),
  module text not null default '',
  action text not null default '',
  target_type text not null default '',
  target_id text not null default '',
  operator_id uuid,
  operator_role text not null default '',
  reason text not null default '',
  before_value jsonb,
  after_value jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_operation_logs_module_time_idx
  on public.admin_operation_logs (module, created_at desc);
create index if not exists admin_operation_logs_target_idx
  on public.admin_operation_logs (target_type, target_id, created_at desc);

alter table public.admin_operation_logs add column if not exists operator_id uuid;
alter table public.admin_operation_logs add column if not exists reason text not null default '';

-- 7) RLS (service role bypasses; companions can read/update own rows via API using service role)
alter table public.companion_identity_verifications enable row level security;
alter table public.companion_payment_accounts enable row level security;
alter table public.companion_media enable row level security;
alter table public.companion_deposits enable row level security;
alter table public.admin_operation_logs enable row level security;

do $$ begin
  create policy "companion_identity_self_read" on public.companion_identity_verifications
    for select using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "companion_payment_self_read" on public.companion_payment_accounts
    for select using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "companion_media_self_read" on public.companion_media
    for select using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "companion_deposits_self_read" on public.companion_deposits
    for select using (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

grant select, insert, update, delete on public.companion_identity_verifications to service_role;
grant select, insert, update, delete on public.companion_payment_accounts to service_role;
grant select, insert, update, delete on public.companion_media to service_role;
grant select, insert, update, delete on public.companion_deposits to service_role;
grant select, insert on public.admin_operation_logs to service_role;

-- 8) Private storage buckets (create via dashboard or Storage API; SQL helper for policies)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('companion-identities', 'companion-identities', false, 10485760, array['image/jpeg','image/png','image/webp']),
  ('companion-gallery', 'companion-gallery', false, 10485760, array['image/jpeg','image/png','image/webp']),
  ('companion-audio', 'companion-audio', false, 20971520, array['audio/mpeg','audio/mp4','audio/wav','audio/webm','audio/ogg','audio/x-m4a']),
  ('companion-payment-proofs', 'companion-payment-proofs', false, 10485760, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update set public = excluded.public;

-- No public read policies for these buckets. Access only via service-role signed URLs.

notify pgrst, 'reload schema';
