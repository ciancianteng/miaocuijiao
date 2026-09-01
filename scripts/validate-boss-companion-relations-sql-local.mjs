/**
 * Local ephemeral Postgres validation for boss_companion_relations migration.
 * Does NOT touch Staging (cfccwysniduwkjskiqgy) or Production (jqfaknpmcnqwqvatrwgo).
 *
 * Requires: local `psql` + postgres service (sudo -u postgres).
 * Usage: node scripts/validate-boss-companion-relations-sql-local.mjs
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SQL = path.join(ROOT, "supabase/migrations/20260901_boss_companion_relations.sql");
const DB = "bcr_mig_validate";

function psql(args, { input, allowFail = false } = {}) {
  const r = spawnSync("sudo", ["-u", "postgres", "psql", ...args], {
    input,
    encoding: "utf8",
  });
  if (!allowFail && r.status !== 0) {
    console.error(r.stdout || "");
    console.error(r.stderr || "");
    throw new Error(`psql failed: ${args.join(" ")}`);
  }
  return r;
}

if (!fs.existsSync(SQL)) throw new Error("missing migration " + SQL);

psql(["-c", `DROP DATABASE IF EXISTS ${DB};`]);
psql(["-c", `CREATE DATABASE ${DB};`]);
psql(["-d", DB, "-v", "ON_ERROR_STOP=1"], {
  input: `
create role authenticated nologin;
create table public.profiles (id uuid primary key, role text);
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
`,
});

const apply = psql(["-d", DB, "-v", "ON_ERROR_STOP=1", "-f", SQL], { allowFail: true });
if (apply.status !== 0) {
  console.error(apply.stdout);
  console.error(apply.stderr);
  psql(["-c", `DROP DATABASE IF EXISTS ${DB};`], { allowFail: true });
  process.exit(1);
}
console.log("APPLY_OK");

const check = psql(["-d", DB, "-tA", "-v", "ON_ERROR_STOP=1"], {
  input: `
select 'relations='||to_regclass('public.boss_companion_relations');
select 'events='||to_regclass('public.boss_companion_relation_events');
select 'idx_count='||count(*)::text from pg_indexes where tablename in ('boss_companion_relations','boss_companion_relation_events');
select 'pol_count='||count(*)::text from pg_policies where tablename in ('boss_companion_relations','boss_companion_relation_events');
select 'trg='||string_agg(tgname,',' order by tgname) from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relname='boss_companion_relation_events' and not t.tgisinternal;
`,
});
console.log(check.stdout.trim());

psql(["-d", DB, "-v", "ON_ERROR_STOP=1"], {
  input: `
insert into public.profiles(id, role) values
  ('11111111-1111-1111-1111-111111111111','boss'),
  ('22222222-2222-2222-2222-222222222222','companion'),
  ('33333333-3333-3333-3333-333333333333','admin'),
  ('44444444-4444-4444-4444-444444444444','boss');
insert into public.boss_companion_relations(boss_id, companion_id, status, bound_by)
 values ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','active','33333333-3333-3333-3333-333333333333');
insert into public.boss_companion_relation_events(relation_id, companion_id, to_boss_id, action, operator_id)
 select id, companion_id, boss_id, 'bind', bound_by from public.boss_companion_relations limit 1;
`,
});

const upd = psql(["-d", DB, "-v", "ON_ERROR_STOP=1", "-c", "update public.boss_companion_relation_events set remark='mut';"], {
  allowFail: true,
});
if (!/append-only/i.test(upd.stderr + upd.stdout)) {
  console.error("APPEND_ONLY_FAIL", upd.stderr || upd.stdout);
  psql(["-c", `DROP DATABASE IF EXISTS ${DB};`], { allowFail: true });
  process.exit(1);
}
console.log("APPEND_ONLY_OK");

const dup = psql(
  [
    "-d",
    DB,
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    "insert into public.boss_companion_relations(boss_id, companion_id, status) values ('44444444-4444-4444-4444-444444444444','22222222-2222-2222-2222-222222222222','active');",
  ],
  { allowFail: true }
);
if (!/unique|uq_boss_companion/i.test(dup.stderr + dup.stdout)) {
  console.error("UNIQUE_ACTIVE_FAIL", dup.stderr || dup.stdout);
  psql(["-c", `DROP DATABASE IF EXISTS ${DB};`], { allowFail: true });
  process.exit(1);
}
console.log("UNIQUE_ACTIVE_OK");

psql(["-c", `DROP DATABASE IF EXISTS ${DB};`], { allowFail: true });
console.log("LOCAL_SQL_VALIDATE_PASS (Staging/Production untouched)");
