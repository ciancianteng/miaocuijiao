-- CS monthly salary: one payroll row per staff per calendar period.
-- Rejected / cancelled / pay_failed rows are excluded so a period can be re-applied after reject.

create unique index if not exists uq_staff_payrolls_staff_period_active
  on public.staff_payrolls (staff_id, period_start)
  where status is distinct from 'rejected'
    and status is distinct from 'cancelled'
    and status is distinct from 'pay_failed';

comment on index public.uq_staff_payrolls_staff_period_active is
  'At most one active/completed staff payroll per (staff_id, period_start).';

-- Allow re-lock after release: unique only while frozen/settled, not released.
-- Drop legacy unique (source_kind, source_id) if present, replace with partial unique.
do $$
declare
  cname text;
begin
  for cname in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'payout_source_locks'
      and con.contype = 'u'
  loop
    execute format('alter table public.payout_source_locks drop constraint %I', cname);
  end loop;
exception
  when undefined_table then null;
end $$;

drop index if exists public.uq_payout_source_locks_source_active;
create unique index if not exists uq_payout_source_locks_source_active
  on public.payout_source_locks (source_kind, source_id)
  where status in ('frozen', 'settled');
