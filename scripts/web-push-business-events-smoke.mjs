/**
 * Offline smoke for Web Push business-events wiring (no network / no secrets).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const biz = await import(pathToFileURL(path.join(root, "server/api/_web-push-business-events.js")).href);

assert.equal(biz.ORDER_PUSH_EVENTS.ORDER_PAID, "ORDER_PAID");
assert.equal(biz.ORDER_PUSH_EVENTS.ORDER_ASSIGNED, "ORDER_ASSIGNED");
assert.equal(biz.ORDER_PUSH_EVENTS.ORDER_ACCEPTED, "ORDER_ACCEPTED");
assert.equal(biz.ORDER_PUSH_EVENTS.ORDER_STARTED, "ORDER_STARTED");
assert.equal(biz.ORDER_PUSH_EVENTS.ORDER_COMPLETED, "ORDER_COMPLETED");
assert.equal(biz.ORDER_PUSH_EVENTS.ORDER_CANCELLED, "ORDER_CANCELLED");

assert.equal(biz.mapInboxKindToOrderPushEvent("order_paid"), "ORDER_PAID");
assert.equal(biz.mapInboxKindToOrderPushEvent("order_assigned"), "ORDER_ASSIGNED");
assert.equal(biz.mapInboxKindToOrderPushEvent("order_reassigned"), "ORDER_ASSIGNED");
assert.equal(biz.mapInboxKindToOrderPushEvent("order_accepted"), "ORDER_ACCEPTED");
assert.equal(biz.mapInboxKindToOrderPushEvent("order_started"), "ORDER_STARTED");
assert.equal(biz.mapInboxKindToOrderPushEvent("order_completed"), "ORDER_COMPLETED");
assert.equal(biz.mapInboxKindToOrderPushEvent("order_cancelled"), "ORDER_CANCELLED");
assert.equal(biz.mapInboxKindToOrderPushEvent("wallet_bonus"), "");

assert.equal(
  biz.buildDedupeKey("ORDER_PAID", "ord-1", "user-a"),
  "ORDER_PAID:ord-1:user-a"
);
assert.match(biz.bossOrderClickUrl("abc"), /orders\.html\?id=abc/);
assert.match(biz.companionOrderClickUrl("abc", "waiting_confirm"), /companion\/orders\?focus=abc/);

const ids = biz.orderIdsOf({ id: "o1", order_no: "NO1", boss_id: "b1", companion_id: "c1" });
assert.deepEqual(ids, { orderId: "o1", orderNo: "NO1", bossId: "b1", companionId: "c1" });

const auth = readFileSync(path.join(root, "server/api/_web-push.js"), "utf8");
assert.match(auth, /event_type/);
assert.match(auth, /order_id/);
assert.match(auth, /target_user_id/);

const wallet = readFileSync(path.join(root, "server/api/_wallet.js"), "utf8");
assert.match(wallet, /mapInboxKindToOrderPushEvent/);
assert.match(wallet, /_web-push-business-events/);

const bossNotify = readFileSync(path.join(root, "server/api/_boss-order-notify.js"), "utf8");
assert.match(bossNotify, /fanoutOrderLifecyclePush/);

const companionNotify = readFileSync(path.join(root, "server/api/_companion-order-notify.js"), "utf8");
assert.match(companionNotify, /ORDER_PUSH_EVENTS\.ORDER_ASSIGNED/);
assert.match(companionNotify, /ORDER_PUSH_EVENTS\.ORDER_COMPLETED/);

const migration = readFileSync(
  path.join(root, "supabase/migrations/20260914_web_push_delivery_log.sql"),
  "utf8"
);
assert.match(migration, /web_push_delivery_log/);
assert.match(migration, /dedupe_key/);

console.log("WEB_PUSH_BUSINESS_EVENTS_SMOKE: PASS");
console.log(
  JSON.stringify(
    {
      events: Object.values(biz.ORDER_PUSH_EVENTS),
      dedupe: "web_push_delivery_log.dedupe_key unique",
      targeting: "boss_id / companion_id only — never broadcast",
    },
    null,
    2
  )
);
