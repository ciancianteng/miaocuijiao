-- PR #362 · Production STEP 1 — infrastructure only. DOES NOT start the cron.
-- Mirror of supabase/migrations/20261004_gameplay_no_taker_pg_cron.sql (same functions, byte-identical bodies).
-- Owner: run in the Production SQL Editor (project jqfaknpmcnqwqvatrwgo) when approved. Never from automation.
--
-- What this file does:
--   * installs pg_cron + pg_net if missing (supabase_vault is already installed);
--   * creates/replaces public.mcj_set_gameplay_no_taker_cron(text, text) and public.mcj_gameplay_no_taker_tick();
--   * revokes EXECUTE on both from public / anon / authenticated.
-- What this file does NOT do:
--   * no cron.schedule / cron.alter_job — job gameplay-no-taker-sweep is NOT created or activated;
--   * no Vault writes (URL/secret are stored later via 22_gameplay_no_taker_cron_vault_TEMPLATE.sql);
--   * no table data is read or modified.
-- Safe to re-run: "if not exists" + "create or replace" + revoke are idempotent.
--
-- Production order (full details in PR #362):
--   PRE-MERGE   Vercel Production env GAMEPLAY_CRON_SECRET (Sensitive) created; this file reviewed.
--   STEP 1      this file  → run the verification block at the bottom (expected: gameplay_jobs = 0).
--   MERGE       normal Production deployment from main.
--   CHECK       GET https://www.meowcuijiao.com/api/cron/gameplay-no-taker without secret → must be 401 (404/503 = STOP).
--   VAULT       22_gameplay_no_taker_cron_vault_TEMPLATE.sql (secret typed in the SQL Editor only, never saved).
--   STEP 2      22_gameplay_no_taker_cron_step2_activate.sql.

begin;

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.mcj_set_gameplay_no_taker_cron(p_url text, p_secret text)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_id uuid;
begin
  if coalesce(trim(p_url), '') = '' or coalesce(trim(p_secret), '') = '' then
    raise exception 'url and secret are required';
  end if;
  select id into v_id from vault.secrets where name = 'gameplay_no_taker_cron_url';
  if v_id is null then
    perform vault.create_secret(trim(p_url), 'gameplay_no_taker_cron_url');
  else
    perform vault.update_secret(v_id, trim(p_url));
  end if;
  v_id := null;
  select id into v_id from vault.secrets where name = 'gameplay_no_taker_cron_secret';
  if v_id is null then
    perform vault.create_secret(trim(p_secret), 'gameplay_no_taker_cron_secret');
  else
    perform vault.update_secret(v_id, trim(p_secret));
  end if;
end;
$$;

create or replace function public.mcj_gameplay_no_taker_tick()
returns bigint
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'gameplay_no_taker_cron_url' limit 1;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'gameplay_no_taker_cron_secret' limit 1;
  if coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then
    raise notice 'gameplay_no_taker cron: vault secrets missing, skipped';
    return null;
  end if;
  return net.http_get(
    url := v_url,
    headers := jsonb_build_object('x-cron-secret', v_secret),
    timeout_milliseconds := 30000
  );
end;
$$;

revoke all on function public.mcj_set_gameplay_no_taker_cron(text, text) from public, anon, authenticated;
revoke all on function public.mcj_gameplay_no_taker_tick() from public, anon, authenticated;

commit;

-- ── Verification (read-only) ────────────────────────────────────────────────
-- Expected: pg_cron, pg_net, supabase_vault all listed.
select extname, extversion from pg_extension
where extname in ('pg_cron', 'pg_net', 'supabase_vault') order by extname;

-- Expected: 2 rows, security_definer = true, anon_exec = false, authenticated_exec = false.
select p.proname,
       pg_get_function_identity_arguments(p.oid) as args,
       p.prosecdef as security_definer,
       has_function_privilege('anon', p.oid, 'execute') as anon_exec,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_exec
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('mcj_set_gameplay_no_taker_cron', 'mcj_gameplay_no_taker_tick')
order by p.proname;

-- Expected: gameplay_jobs = 0 (the cron must NOT exist after Step 1).
select count(*) as gameplay_jobs from cron.job where jobname = 'gameplay-no-taker-sweep';
