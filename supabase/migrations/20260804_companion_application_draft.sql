-- Companion application draft lifecycle
-- Formal companion lists must only show application_status in (approved, verified, passed).
-- Drafts: application_status = 'draft' (or legacy never-submitted pending).
-- Archived drafts: application_status = 'archived' (auto after 30 days or admin archive).

alter table public.companion_profiles
  add column if not exists application_status text not null default 'pending';

alter table public.companion_profiles
  add column if not exists application_submitted_at timestamptz;

comment on column public.companion_profiles.application_status is
  'draft=未提交申请草稿; pending=已提交待审; approved=正式陪玩; rejected/resubmit=审核结果; archived=草稿归档';

-- Backfill: never-submitted pending/empty → draft (do not touch approved / submitted rows)
update public.companion_profiles
set application_status = 'draft',
    updated_at = now()
where coalesce(application_submitted_at::text, '') = ''
  and lower(coalesce(application_status, '')) in ('', 'pending')
  and lower(coalesce(verification_status, '')) not in ('approved', 'verified', 'passed');

-- Soft uniqueness: one companion_profiles row per user (ignore if duplicates already exist).
do $$
begin
  create unique index if not exists companion_profiles_user_id_unique
    on public.companion_profiles (user_id);
exception
  when others then
    raise notice 'companion_profiles_user_id_unique skipped: %', SQLERRM;
end $$;

-- Partial index for operational lists
create index if not exists companion_profiles_formal_approved_idx
  on public.companion_profiles (updated_at desc)
  where lower(application_status) in ('approved', 'verified', 'passed');

create index if not exists companion_profiles_draft_idx
  on public.companion_profiles (updated_at desc)
  where lower(application_status) in ('draft', 'archived');
