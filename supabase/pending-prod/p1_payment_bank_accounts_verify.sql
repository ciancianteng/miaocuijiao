-- READ-ONLY catalog checks for public.payment_bank_accounts.
-- Use twice:
--   1) on Staging (cfccwysniduwkjskiqgy) BEFORE the Production apply, to capture the reference schema;
--   2) on Production (jqfaknpmcnqwqvatrwgo) AFTER p1_payment_bank_accounts_create_and_qr.sql.
-- SELECT only. Never selects encrypted_payload or account numbers.

-- V1 columns
select ordinal_position, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'payment_bank_accounts'
order by ordinal_position;

-- V2 table exists
select to_regclass('public.payment_bank_accounts') as reg;

-- V3 constraints (PK / unique / FK / check)
select conname, contype, pg_get_constraintdef(oid) as def
from pg_constraint
where conrelid = 'public.payment_bank_accounts'::regclass
order by conname;

-- V4 indexes
select indexname, indexdef
from pg_indexes
where schemaname = 'public' and tablename = 'payment_bank_accounts'
order by indexname;

-- V5 RLS flags
select relname, relrowsecurity, relforcerowsecurity
from pg_class
where oid = 'public.payment_bank_accounts'::regclass;

-- V6 policies
select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'payment_bank_accounts'
order by policyname;

-- V7 grants
select grantee, string_agg(privilege_type, ',' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'payment_bank_accounts'
group by grantee
order by grantee;

-- V8 user triggers (updated_at automation etc.)
select tgname, pg_get_triggerdef(oid) as def
from pg_trigger
where tgrelid = 'public.payment_bank_accounts'::regclass and not tgisinternal
order by tgname;

-- V9 row count (expect 0 on a fresh Production table)
select count(*) as rows from public.payment_bank_accounts;
