#!/usr/bin/env node
/**
 * Offline N1 checks: companion_notifications migration is non-empty and idempotent.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mig = path.join(root, "supabase/migrations/20260804_companion_notifications.sql");
const sql = fs.readFileSync(mig, "utf8");

let failed = 0;
function ok(cond, label) {
  if (Cond) console.log(`PASS ${label}`);
  else {
    console.error(`FAIL ${label}`);
    failed++;
  }
}

ok(sql.trim().length > 100, "migration non-empty");
ok(/create table if not exists public\.companion_notifications/i.test(sql), "CREATE IF NOT EXISTS");
ok(/unique\s*\(\s*companion_id\s*,\s*notice_key\s*\)/i.test(sql), "unique (companion_id, notice_key)");
ok(/notice_key/i.test(sql), "notice_key column");
ok(/notification_type/i.test(sql), "notification_type column");
ok(/related_application_id/i.test(sql), "related_application_id column");
ok(/order_id/i.test(sql), "order_id column");
ok(/add column if not exists/i.test(sql), "ADD COLUMN IF NOT EXISTS guards");
ok(!/\bdrop table\b/i.test(sql), "no DROP TABLE");
ok(!/\bemitOrderNotificationEvent\b/i.test(sql), "no emit runtime in SQL");

// No accidental runtime wiring in this N1 change set (scripts only).
const apply = fs.readFileSync(path.join(root, "scripts/apply-companion-notifications-n1-staging.mjs"), "utf8");
ok(/Session Pooler|pooler/i.test(apply), "apply script mentions pooler");
ok(/PRODUCTION_PROJECT_REF|Refusing Production/i.test(apply), "apply refuses Production");
ok(/isDirectDbHost|skip Direct/i.test(apply), "apply skips Direct db.*");

if (failed) {
  console.error(`verify-companion-notifications-n1-offline FAILED (${failed})`);
  process.exit(1);
}
console.log("verify-companion-notifications-n1-offline: ok");
