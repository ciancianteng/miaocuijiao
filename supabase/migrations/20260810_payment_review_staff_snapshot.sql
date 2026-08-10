-- Payment review staff snapshot (order receipts + wallet recharge).
-- Source of truth for four-end display: reviewed_by_staff_id + reviewed_by_staff_name.
-- Safe to re-run.

alter table public.payment_receipts
  add column if not exists reviewed_by_staff_id uuid references public.profiles(id);

alter table public.payment_receipts
  add column if not exists reviewed_by_staff_name text not null default '';

alter table public.payment_receipts
  add column if not exists review_remark text not null default '';

-- Backfill staff_id from legacy reviewed_by / confirmed_by when missing.
update public.payment_receipts
set reviewed_by_staff_id = coalesce(reviewed_by_staff_id, reviewed_by, confirmed_by)
where reviewed_by_staff_id is null
  and coalesce(reviewed_by, confirmed_by) is not null;

alter table public.payment_orders
  add column if not exists reviewed_by_staff_id uuid references public.profiles(id);

alter table public.payment_orders
  add column if not exists reviewed_by_staff_name text not null default '';

alter table public.payment_orders
  add column if not exists reviewed_at timestamptz;

alter table public.payment_orders
  add column if not exists review_remark text not null default '';

-- Backfill staff display names from profiles when snapshot empty.
update public.payment_receipts pr
set reviewed_by_staff_name = coalesce(
  nullif(btrim(pr.reviewed_by_staff_name), ''),
  nullif(btrim(p.display_name), ''),
  nullif(btrim(p.nickname), ''),
  ''
)
from public.profiles p
where pr.reviewed_by_staff_id = p.id
  and coalesce(nullif(btrim(pr.reviewed_by_staff_name), ''), '') = '';

update public.payment_orders po
set reviewed_by_staff_name = coalesce(
  nullif(btrim(po.reviewed_by_staff_name), ''),
  nullif(btrim(p.display_name), ''),
  nullif(btrim(p.nickname), ''),
  ''
)
from public.profiles p
where po.reviewed_by_staff_id = p.id
  and coalesce(nullif(btrim(po.reviewed_by_staff_name), ''), '') = '';

create table if not exists public.payment_review_history (
  id uuid primary key default gen_random_uuid(),
  source_table text not null check (source_table in ('payment_receipts', 'payment_orders')),
  source_id uuid not null,
  action text not null default '',
  reviewed_by_staff_id uuid references public.profiles(id),
  reviewed_by_staff_name text not null default '',
  review_status text not null default '',
  review_remark text not null default '',
  reject_reason text not null default '',
  reviewed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists payment_review_history_source_idx
  on public.payment_review_history (source_table, source_id, created_at desc);

create index if not exists payment_receipts_staff_reviewed_idx
  on public.payment_receipts (reviewed_by_staff_id, reviewed_at desc);

create index if not exists payment_orders_staff_reviewed_idx
  on public.payment_orders (reviewed_by_staff_id, reviewed_at desc);

grant select, insert, update, delete on public.payment_review_history to service_role;

notify pgrst, 'reload schema';
