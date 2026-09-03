-- Flag for test / smoke accounts. Default false; do NOT backfill or delete rows here.
-- Dashboard aggregation excludes is_test_account = true (also @meow.test / Smoke names in code).

alter table public.profiles
  add column if not exists is_test_account boolean not null default false;

alter table public.companion_profiles
  add column if not exists is_test_account boolean not null default false;

comment on column public.profiles.is_test_account is
  'When true, exclude from production business dashboard stats. Set by ops; never auto-delete.';

comment on column public.companion_profiles.is_test_account is
  'When true, companion is a test/smoke fixture and must not appear in business metrics.';

create index if not exists idx_profiles_is_test_account
  on public.profiles (is_test_account)
  where is_test_account = true;
