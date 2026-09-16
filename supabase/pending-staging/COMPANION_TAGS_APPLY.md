# companion_tags apply notes

**Table:** `public.companion_tags`  
**SQL (canonical):** `supabase/migrations/20260915_companion_tags.sql`  
**Copies:** `supabase/companion-tags.sql`, `server/api/_sql/companion-tags.sql`

Admin UI never runs SQL. Apply with SQL Editor or internal CLI only.

## Staging

**Target:** Staging Supabase `cfccwysniduwkjskiqgy`

```bash
STAGING_DB_PASSWORD='…' node scripts/apply-companion-tags-staging.mjs
# or
STAGING_DATABASE_URL='postgresql://…cfccwysniduwkjskiqgy…' node scripts/apply-companion-tags-staging.mjs
```

SQL Editor: https://supabase.com/dashboard/project/cfccwysniduwkjskiqgy/sql/new

## Production

**Target:** Production Supabase `jqfaknpmcnqwqvatrwgo`  
Requires **both** human gates:

```bash
ALLOW_PROD_SUPABASE_WRITE=1 CONFIRM_PROD_WRITE=I_UNDERSTAND_PROD_RISK \
  PRODUCTION_DATABASE_URL='postgresql://postgres.jqfaknpmcnqwqvatrwgo:***@…' \
  node scripts/apply-companion-tags-production.mjs
```

SQL is idempotent (`IF NOT EXISTS` / `ON CONFLICT DO NOTHING`). No DROP / TRUNCATE.

## Verify

```sql
select count(*) from public.companion_tags;
select id, name, sort_order, is_enabled from public.companion_tags order by sort_order;
```

Admin → 陪玩标签管理 should load from DB (`tableReady: true`) and allow CRUD.
