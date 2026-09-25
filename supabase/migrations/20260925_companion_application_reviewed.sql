-- Application review audit fields (admin one-click approve/reject).
-- Safe to re-run.

alter table public.companion_profiles
  add column if not exists application_reviewed_at timestamptz;

alter table public.companion_profiles
  add column if not exists application_reviewed_by uuid references public.profiles(id);

comment on column public.companion_profiles.application_reviewed_at is
  'When admin last approved/rejected/resubmit the companion application.';
comment on column public.companion_profiles.application_reviewed_by is
  'Admin profile id who last reviewed the companion application.';
