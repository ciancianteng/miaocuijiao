# Staging-only: apply companion_tags

**Target:** Staging Supabase `cfccwysniduwkjskiqgy`  
**Do NOT run on Production** `jqfaknpmcnqwqvatrwgo`

Admin UI no longer accepts DB passwords / DATABASE_URL / PAT / SQL execution.
Apply migrations with SQL Editor or internal CLI only.

## Option A — SQL Editor (recommended)

1. Open: https://supabase.com/dashboard/project/cfccwysniduwkjskiqgy/sql/new  
2. Paste contents of `supabase/companion-tags.sql`  
3. Run  
4. Verify:

```sql
select count(*) from public.companion_tags;
```

## Option B — Internal CLI

```bash
STAGING_DB_PASSWORD='…' node scripts/apply-companion-tags-staging.mjs
# or
STAGING_DATABASE_URL='postgresql://postgres.cfccwysniduwkjskiqgy:***@…' node scripts/apply-companion-tags-staging.mjs
```

## Verify write path

After apply, Staging/Production admin → 陪玩标签管理 should load from DB and allow CRUD
(no migration credential inputs in the admin panel).
