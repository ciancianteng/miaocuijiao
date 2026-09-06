# Staging-only: apply companion_tags

**Target:** Staging Supabase `cfccwysniduwkjskiqgy`  
**Do NOT run on Production** `jqfaknpmcnqwqvatrwgo`

## Option A — SQL Editor (recommended if agent has no Staging DB secret)

1. Open: https://supabase.com/dashboard/project/cfccwysniduwkjskiqgy/sql/new  
2. Paste contents of `supabase/companion-tags.sql`  
3. Run  
4. Verify:

```sql
select count(*) from public.companion_tags;
```

## Option B — Admin UI (after this PR is on Preview/Staging)

1. Open Staging admin → 陪玩标签  
2. If banner “标签表未就绪” shows, paste **one** of:
   - Staging DB password
   - Staging `DATABASE_URL` (must include `cfccwysniduwkjskiqgy`)
   - Supabase PAT
3. Click **执行 Staging companion-tags.sql**

## Option C — CLI

```bash
STAGING_DB_PASSWORD='…' node scripts/apply-companion-tags-staging.mjs
# or
STAGING_DATABASE_URL='postgresql://postgres.cfccwysniduwkjskiqgy:***@…' node scripts/apply-companion-tags-staging.mjs
```

## Verify write path

After apply, Staging admin tag save should succeed (no “标签表未就绪…” error).
