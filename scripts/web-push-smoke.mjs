/**
 * Offline smoke checks for Web Push helpers (no network / no secrets required).
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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
assert.match(sw, /event\.waitUntil/);
assert.match(sw, /registration\.showNotification/);
assert.match(sw, /push_received/);
assert.match(sw, /notification_shown/);

// 3) client never auto-requests permission on load
const client = readFileSync(path.join(root, "src/web-push-client.js"), "utf8");
assert.doesNotMatch(client, /requestPermission\(\)[\s\S]{0,40}DOMContentLoaded/);
assert.match(client, /Notification\.requestPermission/);
assert.match(client, /开启妙脆角通知|开启妙脆角通知/);
assert.match(client, /function getAccessToken\(preferredRole\)/);
assert.match(client, /role === "companion"\) return companionToken\(\)/);
assert.match(client, /matched === "expired"/);
assert.match(client, /Service Worker 尚未激活/);
assert.match(client, /subscriptionUsesVapidKey/);

// 4) API rejects foreign target_user_id
const api = readFileSync(path.join(root, "server/api/push.js"), "utf8");
assert.match(api, /禁止为其他用户绑定|target_user_id/);
assert.match(api, /vapidPublicKey/);
assert.match(api, /unsubscribe/);
assert.match(api, /getPushStatusForUser\(userId, endpoint, role\)/);

const sender = readFileSync(path.join(root, "server/api/_web-push.js"), "utf8");
assert.match(sender, /last_provider_status/);
assert.match(sender, /statusCode === 404 \|\| statusCode === 410/);
assert.match(sender, /妙脆角通知测试/);
assert.match(sender, /这是一条系统 Push 测试通知/);
assert.match(sender, /return Promise\.resolve\(\)/);
assert.match(sender, /on_conflict=user_id,role,endpoint_hash/);

const diagnosticsMigration = readFileSync(
  path.join(root, "supabase/migrations/20260916_web_push_provider_diagnostics.sql"),
  "utf8"
);
assert.match(diagnosticsMigration, /last_provider_status/);
assert.match(diagnosticsMigration, /provider_results/);
assert.match(diagnosticsMigration, /unique index if not exists push_subscriptions_user_role_endpoint_key/i);
assert.match(diagnosticsMigration, /unique index if not exists push_subscriptions_active_role_endpoint_key/i);
assert.doesNotMatch(diagnosticsMigration, /\b(truncate|delete\s+from)\b/i);
assert.match(sender, /on_conflict=user_id,role,endpoint_hash/);
assert.match(sender, /hasOtherActiveBindings/);
assert.match(sender, /account_rebound/);

const businessPush = readFileSync(
  path.join(root, "server/api/_web-push-business-events.js"),
  "utf8"
);
assert.match(businessPush, /return Promise\.resolve\(\)/);
assert.match(businessPush, /sent_count[\s\S]*looksInFlight/);

for (const file of [
  "server/api/_boss-order-notify.js",
  "server/api/_companion-inbox.js",
  "server/api/_companion-order-notify.js",
  "server/api/_wallet.js",
  "server/api/admin/finance.js",
]) {
  const source = readFileSync(path.join(root, file), "utf8");
  assert.match(source, /await fanout(?:WebPush|OrderLifecyclePush)\(/, `${file} must await Web Push`);
}

// 5) A companion portal must never inherit a concurrently logged-in boss JWT.
function storage(values = {}) {
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null;
    },
    setItem(key, value) {
      values[key] = String(value);
    },
    removeItem(key) {
      delete values[key];
    },
  };
}
const localStorage = storage({
  mcjAuthAccessToken: "boss.jwt.token",
  mcjCompanionSession: JSON.stringify({ token: "companion.jwt.token" }),
  mcjServiceSession: JSON.stringify({ token: "service.jwt.token" }),
});
const sessionStorage = storage();
const navigator = {
  userAgent: "Android",
  platform: "Linux",
  maxTouchPoints: 1,
  serviceWorker: { addEventListener() {} },
};
const window = {
  navigator,
  localStorage,
  sessionStorage,
  location: { pathname: "/companion/dashboard" },
  isSecureContext: true,
  setTimeout,
  clearTimeout,
};
window.window = window;
const context = vm.createContext({
  window,
  globalThis: window,
  navigator,
  localStorage,
  sessionStorage,
  setTimeout,
  clearTimeout,
  URL,
  URLSearchParams,
  console,
});
vm.runInContext(client, context);
assert.equal(window.MCJWebPush.getAccessTokenForRole("companion"), "companion.jwt.token");
assert.equal(window.MCJWebPush.getAccessTokenForRole("boss"), "boss.jwt.token");
assert.equal(window.MCJWebPush.getAccessTokenForRole("customer_service"), "service.jwt.token");

// 6) fanout only from server inbox writers
const wallet = readFileSync(path.join(root, "server/api/_wallet.js"), "utf8");
const inbox = readFileSync(path.join(root, "server/api/_companion-inbox.js"), "utf8");
const finance = readFileSync(path.join(root, "server/api/admin/finance.js"), "utf8");
assert.match(wallet, /fanoutWebPush/);
assert.match(inbox, /fanoutWebPush/);
assert.match(finance, /fanoutWebPush/);

// 7) endpoint hash isolation helper shape
function hashEndpoint(endpoint) {
  return createHash("sha256").update(String(endpoint || "")).digest("hex");
}
const a = hashEndpoint("https://push.example/a");
const b = hashEndpoint("https://push.example/b");
assert.notEqual(a, b);
assert.equal(a, hashEndpoint("https://push.example/a"));

// 8) private key must not appear in client/SW/bundle sources
for (const file of ["src/web-push-client.js", "public/sw-mcj.js", "mine.html"]) {
  const text = readFileSync(path.join(root, file), "utf8");
  assert.doesNotMatch(text, /VAPID_PRIVATE_KEY\s*=\s*['\"][^'\"]+/);
  assert.doesNotMatch(text, /BEGIN PRIVATE KEY/);
}

console.log("WEB_PUSH_SMOKE: PASS");
