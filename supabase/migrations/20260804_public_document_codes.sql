-- Formal document codes: orders MCJO######, companion withdraw WD######, CS payroll CSW######.
-- Also: clear PW codes from drafts; backfill only approved companions; hide reuse.
-- Safe to re-run.

create extension if not exists pgcrypto;

-- ========== ORDER public numbers ==========
create sequence if not exists public.order_public_no_seq
  as bigint start with 1 increment by 1 minvalue 1 no maxvalue cache 1;

create or replace function public.mcj_allocate_order_no()
returns text
language plpgsql
as $$
declare
  code text;
  n bigint;
begin
  loop
    n := nextval('public.order_public_no_seq');
    code := 'MCJO' || lpad(n::text, 6, '0');
    exit when not exists (select 1 from public.orders where order_no = code);
  end loop;
  return code;
end;
$$;

grant execute on function public.mcj_allocate_order_no() to service_role;

-- Backfill formal order numbers for rows still on legacy / UUID-looking labels
do $$
declare
  r record;
  code text;
  max_n bigint := 0;
  n bigint;
begin
  for r in
    select id, order_no, created_at
    from public.orders
    where order_no is null
       or btrim(order_no) = ''
       or order_no !~* '^MCJO[0-9]+$'
    order by created_at asc nulls last, id asc
  loop
    -- Keep already-formal codes; only rewrite legacy timestamp / random codes
    if r.order_no ~* '^MCJO[0-9]+$' then
      continue;
    end if;
    n := nextval('public.order_public_no_seq');
    code := 'MCJO' || lpad(n::text, 6, '0');
    while exists (select 1 from public.orders o where o.order_no = code and o.id <> r.id) loop
      n := nextval('public.order_public_no_seq');
      code := 'MCJO' || lpad(n::text, 6, '0');
    end loop;
    update public.orders set order_no = code where id = r.id;
    if n > max_n then max_n := n; end if;
  end loop;

  select coalesce(max(
    case
      when order_no ~* '^MCJO[0-9]+$' then nullif(regexp_replace(order_no, '^MCJO0*', '', 'i'), '')::bigint
      else 0
    end
  ), 0) into max_n
  from public.orders
  where order_no is not null;

  if max_n < 1 then
    perform setval('public.order_public_no_seq', 1, false);
  else
    perform setval('public.order_public_no_seq', max_n, true);
  end if;
end $$;

create unique index if not exists orders_order_no_formal_uidx
  on public.orders (order_no)
  where order_no is not null and btrim(order_no) <> '';

-- ========== Companion withdrawal numbers ==========
create sequence if not exists public.companion_withdrawal_no_seq
  as bigint start with 1 increment by 1 minvalue 1 no maxvalue cache 1;

create or replace function public.mcj_allocate_withdrawal_no()
returns text
language plpgsql
as $$
declare
  code text;
  n bigint;
begin
  loop
    n := nextval('public.companion_withdrawal_no_seq');
    code := 'WD' || lpad(n::text, 6, '0');
    exit when not exists (select 1 from public.companion_withdrawals where withdrawal_no = code);
  end loop;
  return code;
end;
$$;

grant execute on function public.mcj_allocate_withdrawal_no() to service_role;

do $$
declare
  r record;
  code text;
  max_n bigint := 0;
  n bigint;
begin
  if to_regclass('public.companion_withdrawals') is null then
    return;
  end if;
  for r in
    select id, withdrawal_no, created_at
    from public.companion_withdrawals
    where withdrawal_no is null
       or btrim(withdrawal_no) = ''
       or withdrawal_no !~* '^WD[0-9]+$'
    order by created_at asc nulls last, id asc
  loop
    n := nextval('public.companion_withdrawal_no_seq');
    code := 'WD' || lpad(n::text, 6, '0');
    while exists (select 1 from public.companion_withdrawals w where w.withdrawal_no = code and w.id <> r.id) loop
      n := nextval('public.companion_withdrawal_no_seq');
      code := 'WD' || lpad(n::text, 6, '0');
    end loop;
    update public.companion_withdrawals set withdrawal_no = code where id = r.id;
    if n > max_n then max_n := n; end if;
  end loop;

  select coalesce(max(
    case
      when withdrawal_no ~* '^WD[0-9]+$' then nullif(regexp_replace(withdrawal_no, '^WD0*', '', 'i'), '')::bigint
      else 0
    end
  ), 0) into max_n
  from public.companion_withdrawals
  where withdrawal_no is not null;

  if max_n < 1 then
    perform setval('public.companion_withdrawal_no_seq', 1, false);
  else
    perform setval('public.companion_withdrawal_no_seq', max_n, true);
  end if;
end $$;

-- ========== CS payroll numbers ==========
create sequence if not exists public.cs_payroll_no_seq
  as bigint start with 1 increment by 1 minvalue 1 no maxvalue cache 1;

create or replace function public.mcj_allocate_cs_payroll_no()
returns text
language plpgsql
as $$
declare
  code text;
  n bigint;
begin
  loop
    n := nextval('public.cs_payroll_no_seq');
    code := 'CSW' || lpad(n::text, 6, '0');
    exit when not exists (select 1 from public.staff_payrolls where payroll_no = code);
  end loop;
  return code;
end;
$$;

grant execute on function public.mcj_allocate_cs_payroll_no() to service_role;

do $$
declare
  r record;
  code text;
  max_n bigint := 0;
  n bigint;
begin
  if to_regclass('public.staff_payrolls') is null then
    return;
  end if;
  for r in
    select id, payroll_no, created_at
    from public.staff_payrolls
    where payroll_no is null
       or btrim(payroll_no) = ''
       or payroll_no !~* '^CSW[0-9]+$'
    order by created_at asc nulls last, id asc
  loop
    n := nextval('public.cs_payroll_no_seq');
    code := 'CSW' || lpad(n::text, 6, '0');
    while exists (select 1 from public.staff_payrolls p where p.payroll_no = code and p.id <> r.id) loop
      n := nextval('public.cs_payroll_no_seq');
      code := 'CSW' || lpad(n::text, 6, '0');
    end loop;
    update public.staff_payrolls set payroll_no = code where id = r.id;
    if n > max_n then max_n := n; end if;
  end loop;

  select coalesce(max(
    case
      when payroll_no ~* '^CSW[0-9]+$' then nullif(regexp_replace(payroll_no, '^CSW0*', '', 'i'), '')::bigint
      else 0
    end
  ), 0) into max_n
  from public.staff_payrolls
  where payroll_no is not null;

  if max_n < 1 then
    perform setval('public.cs_payroll_no_seq', 1, false);
  else
    perform setval('public.cs_payroll_no_seq', max_n, true);
  end if;
end $$;

-- ========== Companion codes: drafts must NOT keep formal PW ==========
do $$
declare
  r record;
  code text;
  max_n bigint := 0;
  n bigint;
begin
  if to_regclass('public.companion_profiles') is null then
    return;
  end if;

  -- Clear codes on draft / archived leftovers
  update public.companion_profiles
  set companion_code = null
  where (
      application_status in ('draft', 'archived', 'deleted')
      or application_submitted_at is null
      or nickname ~* '^草稿保留'
    )
    and companion_code is not null;

  -- Backfill PW only for approved formal companions missing a code
  for r in
    select id, companion_code, created_at
    from public.companion_profiles
    where application_status in ('approved', 'verified', 'passed')
      and (companion_code is null or btrim(companion_code) = '')
    order by created_at asc nulls last, id asc
  loop
    n := nextval('public.companion_code_seq');
    code := 'PW' || lpad(n::text, 5, '0');
    while exists (
      select 1 from public.companion_profiles p
      where p.companion_code = code and p.id <> r.id
    ) loop
      n := nextval('public.companion_code_seq');
      code := 'PW' || lpad(n::text, 5, '0');
    end loop;
    update public.companion_profiles set companion_code = code where id = r.id;
    if n > max_n then max_n := n; end if;
  end loop;

  select coalesce(max(
    case
      when companion_code ~* '^PW[0-9]+$' then nullif(regexp_replace(companion_code, '^PW0*', '', 'i'), '')::bigint
      else 0
    end
  ), 0) into max_n
  from public.companion_profiles
  where companion_code is not null;

  if max_n < 1 then
    perform setval('public.companion_code_seq', 1, false);
  else
    perform setval('public.companion_code_seq', max_n, true);
  end if;
end $$;

-- ========== Boss MCJ codes: ensure missing bosses get one ==========
do $$
declare
  r record;
begin
  for r in
    select id
    from public.profiles
    where role = 'boss'
      and (boss_uid is null or btrim(boss_uid) = '')
    order by created_at asc nulls last, id asc
  loop
    update public.profiles
      set boss_uid = 'MCJ' || lpad(nextval('public.boss_uid_seq')::text, 5, '0')
    where id = r.id
      and (boss_uid is null or btrim(boss_uid) = '');
  end loop;
end $$;

notify pgrst, 'reload schema';
