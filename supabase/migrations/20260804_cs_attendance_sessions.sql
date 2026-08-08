-- CS multi-shift attendance sessions (same day multiple clock-in/out).
-- Independent of customer_service_reports daily unique row.

create extension if not exists pgcrypto;

create table if not exists public.cs_attendance_sessions (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.profiles(id) on delete cascade,
  work_date date not null,
  clock_in_at timestamptz not null,
  clock_out_at timestamptz,
  session_type text not null default 'normal'
    check (session_type in ('normal', 'overtime', 'temp', 'night')),
  duration_minutes numeric(10,2) not null default 0,
  status text not null default 'open'
    check (status in ('open', 'closed', 'adjusted', 'void')),
  late_minutes integer not null default 0,
  early_leave_minutes integer not null default 0,
  note text not null default '',
  admin_note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_cs_att_sessions_service_date
  on public.cs_attendance_sessions (service_id, work_date desc, clock_in_at desc);

create index if not exists idx_cs_att_sessions_open
  on public.cs_attendance_sessions (service_id, status)
  where status = 'open';

create index if not exists idx_cs_att_sessions_month
  on public.cs_attendance_sessions (work_date desc);

-- At most one open session per staff
create unique index if not exists idx_cs_att_sessions_one_open
  on public.cs_attendance_sessions (service_id)
  where status = 'open';

grant select, insert, update, delete on public.cs_attendance_sessions to service_role;
grant select on public.cs_attendance_sessions to authenticated;

-- Backfill: one closed/open session from legacy daily reports (best effort, once)
do $$
declare
  r record;
  st text;
  typ text;
  mins numeric;
begin
  if to_regclass('public.customer_service_reports') is null then
    return;
  end if;
  for r in
    select id, customer_service_id, report_date, shift_start, shift_end, note, created_at
    from public.customer_service_reports
    where report_date is not null
      and report_date <> date '1970-01-01'
      and shift_start is not null
      and customer_service_id is not null
    order by report_date asc, created_at asc
  loop
    if exists (
      select 1 from public.cs_attendance_sessions s
      where s.service_id = r.customer_service_id
        and s.work_date = r.report_date
        and s.clock_in_at = r.shift_start
    ) then
      continue;
    end if;
    st := case when r.shift_end is null then 'open' else 'closed' end;
    mins := case
      when r.shift_end is not null then greatest(0, extract(epoch from (r.shift_end - r.shift_start)) / 60.0)
      else 0
    end;
    typ := 'normal';
    begin
      insert into public.cs_attendance_sessions (
        service_id, work_date, clock_in_at, clock_out_at, session_type,
        duration_minutes, status, note, created_at, updated_at
      ) values (
        r.customer_service_id, r.report_date, r.shift_start, r.shift_end, typ,
        mins, st, coalesce(r.note, ''), coalesce(r.created_at, now()), now()
      );
    exception when unique_violation then
      -- open-session unique: leave as-is
      null;
    end;
  end loop;
end $$;

notify pgrst, 'reload schema';
