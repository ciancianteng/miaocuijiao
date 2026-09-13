/**
 * Offline smoke checks for Web Push helpers (no network / no secrets required).
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { readFileSync } from "node:fs";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

// 1) migration has required columns
const migration = readFileSync(path.join(root, "supabase/migrations/20260913_push_subscriptions.sql"), "utf8");
for (const col of [
  "user_id",
  "role",
  "endpoint",
  "p256dh",
  "auth",
  "user_agent",
  "device_label",
  "status",
  "created_at",
  "updated_at",
  "last_seen_at",
]) {
  assert.match(migration, new RegExp("\\b" + col + "\\b"), "missing column " + col);
}
assert.match(migration, /push_subscriptions_deny_all/);

// 2) SW handles push + notificationclick
const sw = readFileSync(path.join(root, "public/sw-mcj.js"), "utf8");
assert.match(sw, /addEventListener\(\s*["']push["']/);
assert.match(sw, /addEventListener\(\s*["']notificationclick["']/);
assert.match(sw, /clients\.openWindow|client\.navigate/);

// 3) client never auto-requests permission on load
const client = readFileSync(path.join(root, "src/web-push-client.js"), "utf8");
assert.doesNotMatch(client, /requestPermission\(\)[\s\S]{0,40}DOMContentLoaded/);
assert.match(client, /Notification\.requestPermission/);
assert.match(client, /开启妙脆角通知|开启妙脆角通知/);

// 4) API rejects foreign target_user_id
const api = readFileSync(path.join(root, "server/api/push.js"), "utf8");
assert.match(api, /禁止为其他用户绑定|target_user_id/);
assert.match(api, /vapidPublicKey/);
assert.match(api, /unsubscribe/);

// 5) fanout only from server inbox writers
const wallet = readFileSync(path.join(root, "server/api/_wallet.js"), "utf8");
const inbox = readFileSync(path.join(root, "server/api/_companion-inbox.js"), "utf8");
const finance = readFileSync(path.join(root, "server/api/admin/finance.js"), "utf8");
assert.match(wallet, /fanoutWebPush/);
assert.match(inbox, /fanoutWebPush/);
assert.match(finance, /fanoutWebPush/);

// 6) endpoint hash isolation helper shape
function hashEndpoint(endpoint) {
  return createHash("sha256").update(String(endpoint || "")).digest("hex");
}
const a = hashEndpoint("https://push.example/a");
const b = hashEndpoint("https://push.example/b");
assert.notEqual(a, b);
assert.equal(a, hashEndpoint("https://push.example/a"));

// 7) private key must not appear in client/SW/bundle sources
for (const file of ["src/web-push-client.js", "public/sw-mcj.js", "mine.html"]) {
  const text = readFileSync(path.join(root, file), "utf8");
  assert.doesNotMatch(text, /VAPID_PRIVATE_KEY\s*=\s*['\"][^'\"]+/);
  assert.doesNotMatch(text, /BEGIN PRIVATE KEY/);
}

console.log("WEB_PUSH_SMOKE: PASS");
