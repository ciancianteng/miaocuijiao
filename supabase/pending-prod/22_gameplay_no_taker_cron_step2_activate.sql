-- PR #362 · Production STEP 2 — cron activation only. THIS FILE STARTS THE EVERY-MINUTE JOB.
-- Owner: Production SQL Editor (project jqfaknpmcnqwqvatrwgo). Never from automation.
--
-- Run ONLY after ALL of these are true:
--   a. PR #362 is merged and the normal Production deployment is live;
--   b. GAMEPLAY_CRON_SECRET exists in Vercel Production (Sensitive) and that deployment was built after it;
--   c. Production Vault URL + secret configured via 22_gameplay_no_taker_cron_vault_TEMPLATE.sql;
--   d. GET https://www.meowcuijiao.com/api/cron/gameplay-no-taker without a secret returned 401
--      (404 = code not deployed, 503 = env secret missing → STOP, do not run this file).
--
-- Arming: the guard below refuses to run until the set_config line is uncommented, i.e. the operator
-- explicitly confirms check (d). It also refuses when Step 1 is missing, the Vault URL is not the
-- Production endpoint, or the Vault secret is missing / a placeholder / shorter than 32 chars.
--
-- Idempotent: job name is exactly gameplay-no-taker-sweep. If it already exists it is updated in place
-- (cron.alter_job → same schedule/command, active = true); otherwise it is created once. Never two jobs.
-- No table data is modified.
--
-- Emergency stop (see PR #362 → Rollback):
--   select cron.alter_job(jobid, active := false) from cron.job where jobname = 'gameplay-no-taker-sweep';

begin;

-- select set_config('mcj.gameplay_cron_activation', 'endpoint-401-confirmed', true);

do $$
declare
  v_url text;
  v_secret text;
  v_jobs int;
  v_jobid bigint;
begin
  if coalesce(current_setting('mcj.gameplay_cron_activation', true), '') <> 'endpoint-401-confirmed' then
    raise exception 'Not armed: confirm the unauthenticated endpoint check returned 401, then uncomment the set_config line.';
  end if;

  if not exists (select 1 from pg_extension where extname = 'pg_cron')
     or not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise exception 'pg_cron / pg_net missing: run 22_gameplay_no_taker_cron_step1_infra.sql first.';
  end if;
  if to_regprocedure('public.mcj_gameplay_no_taker_tick()') is null
     or to_regprocedure('public.mcj_set_gameplay_no_taker_cron(text, text)') is null then
    raise exception 'PR #362 functions missing: run 22_gameplay_no_taker_cron_step1_infra.sql first.';
  end if;

  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'gameplay_no_taker_cron_url' limit 1;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'gameplay_no_taker_cron_secret' limit 1;
  if coalesce(v_url, '') <> 'https://www.meowcuijiao.com/api/cron/gameplay-no-taker' then
    raise exception 'Vault gameplay_no_taker_cron_url is not the Production endpoint.';
  end if;
  if length(coalesce(v_secret, '')) < 32
     or v_secret like '<%' or v_secret ilike '%PRODUCTION_GAMEPLAY_CRON_SECRET%' then
    raise exception 'Vault gameplay_no_taker_cron_secret missing / placeholder / shorter than 32 chars (len=%).',
      length(coalesce(v_secret, ''));
  end if;

  select count(*), min(jobid) into v_jobs, v_jobid from cron.job where jobname = 'gameplay-no-taker-sweep';
  if v_jobs > 1 then
    raise exception 'Found % jobs named gameplay-no-taker-sweep; resolve manually before activating.', v_jobs;
  elsif v_jobs = 1 then
    perform cron.alter_job(
      v_jobid,
      schedule := '* * * * *',
      command := 'select public.mcj_gameplay_no_taker_tick()',
      active := true
    );
  else
    perform cron.schedule('gameplay-no-taker-sweep', '* * * * *', 'select public.mcj_gameplay_no_taker_tick()');
  end if;

  select count(*) into v_jobs from cron.job
  where jobname = 'gameplay-no-taker-sweep' and active
    and schedule = '* * * * *' and command = 'select public.mcj_gameplay_no_taker_tick()';
  if v_jobs <> 1 then
    raise exception 'Activation check failed: expected exactly 1 active gameplay-no-taker-sweep job, found %.', v_jobs;
  end if;
end;
$$;

commit;

-- ── Verification (read-only) ────────────────────────────────────────────────
-- Expected now: 1 row, schedule '* * * * *', active = true.
select jobid, jobname, schedule, active, command from cron.job where jobname = 'gameplay-no-taker-sweep';

-- Expected after 2–3 minutes: recent rows status = 'succeeded'.
select d.status, d.return_message, d.start_time
from cron.job_run_details d join cron.job j using (jobid)
where j.jobname = 'gameplay-no-taker-sweep'
order by d.start_time desc limit 5;

-- Expected after 2–3 minutes: status_code = 200 (401 = Vault secret ≠ Vercel env → disable the job and fix).
select id, status_code, error_msg, created from net._http_response order by created desc limit 5;
