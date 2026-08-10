-- P0 unified account: one email → one user_id; multi-role on same account.
-- Safe to re-run. Does not delete historical orders.

-- 1) Multi-role column on profiles (optional SoT besides auth app_metadata.roles)
alter table public.profiles
  add column if not exists roles text[] default null;

comment on column public.profiles.roles is
  'Multi-role flags for the same user_id, e.g. {boss,companion}. Single-role profiles.role kept for legacy reads.';

-- 2) Normalize + unique email on profiles when email is present
-- First normalize existing values (trim + lower).
update public.profiles
set email = lower(trim(email))
where email is not null
  and email <> lower(trim(email));

-- Deduplicate profiles.email collisions before unique index:
-- keep the earliest created_at row's email; blank out later duplicates' email
-- (auth.users remains source of login; blanked rows keep id / orders / wallets).
with ranked as (
  select
    id,
    email,
    row_number() over (
      partition by lower(trim(email))
      order by created_at nulls last, id
    ) as rn
  from public.profiles
  where email is not null
    and trim(email) <> ''
)
update public.profiles p
set email = null
from ranked r
where p.id = r.id
  and r.rn > 1;

create unique index if not exists profiles_email_normalized_uidx
  on public.profiles (lower(trim(email)))
  where email is not null and trim(email) <> '';

-- 3) Ensure companion_profiles.user_id stays unique (one companion card per account)
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'companion_profiles_user_id_key'
  ) then
    begin
      alter table public.companion_profiles
        add constraint companion_profiles_user_id_key unique (user_id);
    exception when others then
      raise notice 'companion_profiles.user_id unique skipped: %', sqlerrm;
    end;
  end if;
end $$;
