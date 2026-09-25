-- Application review audit fields (admin one-click approve/reject).
-- Safe to re-run. Mirror of supabase/migrations/20260925_companion_application_reviewed.sql

alter table public.companion_profiles
  add column if not exists application_reviewed_at timestamptz;

alter table public.companion_profiles
  add column if not exists application_reviewed_by uuid references public.profiles(id);
