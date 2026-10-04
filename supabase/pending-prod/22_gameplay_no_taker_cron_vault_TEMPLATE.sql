-- PR #362 · Production VAULT — template. Run AFTER Step 1 + merge + the 401 endpoint check, BEFORE Step 2.
-- Owner: Production SQL Editor (project jqfaknpmcnqwqvatrwgo). Never from automation.
--
-- 1) Replace <PRODUCTION_GAMEPLAY_CRON_SECRET> with the exact value of the Vercel Production env
--    GAMEPLAY_CRON_SECRET (same value; the endpoint compares header x-cron-secret against it).
-- 2) Run. Then discard the editor tab: do NOT save it as a snippet, do NOT commit an edited copy,
--    do NOT paste the value into chat / PR / tickets.
--    It is a plain SELECT on purpose (pg_stat_statements stores SELECT constants normalized); do not wrap it in DO.
-- 3) Run the verification query (prints name + length only).
--
-- Placeholder guard: if this template is run unedited, Vault holds the placeholder, every tick gets 401,
-- and 22_gameplay_no_taker_cron_step2_activate.sql refuses to activate (it rejects placeholder / < 32 chars).
-- Re-running with a new value updates both Vault entries in place (no duplicates).

select public.mcj_set_gameplay_no_taker_cron(
  'https://www.meowcuijiao.com/api/cron/gameplay-no-taker',
  '<PRODUCTION_GAMEPLAY_CRON_SECRET>'
);

-- ── Verification (read-only; never selects the secret value) ───────────────
-- Expected: gameplay_no_taker_cron_secret  len >= 32  url_value = null
--           gameplay_no_taker_cron_url     len = 54   url_value = https://www.meowcuijiao.com/api/cron/gameplay-no-taker
select name,
       length(decrypted_secret) as len,
       case when name = 'gameplay_no_taker_cron_url' then decrypted_secret end as url_value
from vault.decrypted_secrets
where name in ('gameplay_no_taker_cron_url', 'gameplay_no_taker_cron_secret')
order by name;
