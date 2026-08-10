-- Persist companion apply auth choice (id_card | deposit) for refresh + admin review.
alter table public.companion_profiles
  add column if not exists credential_mode text;

comment on column public.companion_profiles.credential_mode is
  'Apply auth choice: id_card | deposit. Eligibility remains OR of approved identity/deposit.';
