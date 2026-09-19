#!/usr/bin/env node
/**
 * Offline verification: multi-companion frontend team bar + place_multi_order wiring.
 * Does NOT touch Production / Staging DB.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const results = [];

function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
    console.log(`PASS  ${name}`);
  } catch (e) {
    results.push({ name, ok: false, error: String(e?.message || e) });
    console.error(`FAIL  ${name}: ${e?.message || e}`);
  }
}

const teamSrc = readFileSync(path.join(root, "src/multi-companion-team.js"), "utf8");
const hallSrc = readFileSync(path.join(root, "src/companion-hall.js"), "utf8");
const placeSrc = readFileSync(path.join(root, "src/place-order-modal.js"), "utf8");
const ordersHtml = readFileSync(path.join(root, "orders.html"), "utf8");
const centerHtml = readFileSync(path.join(root, "companion-center.html"), "utf8");

test("TEST 1 single-order path unchanged (place_order + 立即下单)", () => {
  assert.match(placeSrc, /action:\s*"place_order"/);
  assert.match(placeSrc, /MCJPlaceOrder/);
  assert.match(hallSrc, /立即下单/);
  assert.match(hallSrc, /data-hall-order/);
  assert.doesNotMatch(placeSrc, /place_multi_order/);
});

test("TEST 2–3 add companions increments count", () => {
  const store = {};
  const document = {
    querySelector() {
      return null;
    },
    createElement() {
      return {
        classList: { add() {}, remove() {} },
        setAttribute() {},
        appendChild() {},
        style: {},
      };
    },
    head: { appendChild() {} },
    body: { appendChild() {}, classList: { add() {}, remove() {} } },
    documentElement: { classList: { add() {}, remove() {} } },
    addEventListener() {},
  };
  const window = {
    MCJPlaceOrder: {
      resolveServices(c) {
        return [{ name: c.service || "陪玩", price: Number(c.unitPrice || 30) }];
      },
    },
    addEventListener() {},
  };
  const sessionStorage = {
    getItem(k) {
      return store[k] || null;
    },
    setItem(k, v) {
      store[k] = String(v);
    },
    removeItem(k) {
      delete store[k];
    },
  };
  const localStorage = sessionStorage;
  const sandbox = {
    window,
    document,
    sessionStorage,
    localStorage,
    console,
    setTimeout,
    clearTimeout,
    location: { href: "" },
    fetch() {
      return Promise.reject(new Error("no fetch in unit test"));
    },
  };
  sandbox.window = Object.assign(window, { document, sessionStorage, localStorage });
  vm.runInNewContext(teamSrc, sandbox);
  const api = sandbox.window.MCJMultiCompanionTeam;
  assert.ok(api);
  assert.equal(api.getCount(), 0);
  const a = api.add({
    companionId: "11111111-1111-4111-8111-111111111111",
    companionName: "A",
    unitPrice: 30,
    service: "三角洲",
    online: true,
  });
  assert.equal(a.ok, true);
  assert.equal(api.getCount(), 1);
  const b = api.add({
    companionId: "22222222-2222-4222-8222-222222222222",
    companionName: "B",
    unitPrice: 40,
    service: "三角洲",
    online: true,
  });
  assert.equal(b.ok, true);
  assert.equal(api.getCount(), 2);

  // TEST 4 duplicate
  const dup = api.add({
    companionId: "11111111-1111-4111-8111-111111111111",
    companionName: "A",
    unitPrice: 30,
    online: true,
  });
  assert.equal(dup.ok, false);
  assert.equal(dup.error, "duplicate");
  assert.equal(api.getCount(), 2);

  // TEST 5 total 70
  assert.equal(api.getTotal(), 70);

  // TEST 6 remove B
  api.remove("22222222-2222-4222-8222-222222222222");
  assert.equal(api.getCount(), 1);
  assert.equal(api.getTotal(), 30);

  // re-add B for later tests
  api.add({
    companionId: "22222222-2222-4222-8222-222222222222",
    companionName: "B",
    unitPrice: 40,
    service: "三角洲",
    online: true,
  });

  // TEST 7 min 2 gate via buildPayload still builds but UI checks count — payload companions length
  api.remove("22222222-2222-4222-8222-222222222222");
  assert.equal(api.getCount(), 1);
  // restore 2
  api.add({
    companionId: "22222222-2222-4222-8222-222222222222",
    companionName: "B",
    unitPrice: 40,
    service: "三角洲",
    online: true,
  });

  // TEST 8 payload uses place_multi_order once (single payload)
  sandbox.window.MCJMultiCompanionTeam._test.state.sharedGameId = "boss-gid-1";
  const payload = api.buildPayload();
  assert.equal(payload.action, "place_multi_order");
  assert.equal(payload.companions.length, 2);
  assert.equal(payload.paymentMethod, "catfood");
  assert.ok(payload.idempotencyKey);

  // TEST 9 no place_order in team module
  assert.doesNotMatch(teamSrc, /action:\s*["']place_order["']/);
  assert.match(teamSrc, /place_multi_order/);

  // TEST 10 clear
  api.clear();
  assert.equal(api.getCount(), 0);
});

test("TEST 11 parent/child order UI markers", () => {
  assert.match(ordersHtml, /isMultiParent|isMultiGroupParent/);
  assert.match(ordersHtml, /od-children|子订单/);
  assert.match(ordersHtml, /多人订单/);
  assert.match(ordersHtml, /data-action="request_refund"/);
});

test("TEST 12 legacy single-order UI + hall secondary CTA wired", () => {
  assert.match(hallSrc, /加入一起下单/);
  assert.match(hallSrc, /data-hall-team-add/);
  assert.match(centerHtml, /multi-companion-team\.js/);
  assert.match(teamSrc, /team-bar|去结算|确认一起下单|一次支付整组订单/);
});

test("STATIC floating bar safe-area / bottom-nav offset", () => {
  const css = readFileSync(path.join(root, "src/multi-companion-team.css"), "utf8");
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /bottom:\s*calc\(64px/);
});

const failed = results.filter((r) => !r.ok);
console.log("");
console.log(
  JSON.stringify(
    {
      ok: failed.length === 0,
      passed: results.filter((r) => r.ok).length,
      failed: failed.length,
      failures: failed,
    },
    null,
    2
  )
);
if (failed.length) process.exit(1);
console.log("verify-multi-companion-frontend: PASS");
