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
const workbenchSrc = readFileSync(path.join(root, "src/companion-workbench.js"), "utf8");
const companionApi = readFileSync(path.join(root, "server/api/companion.js"), "utf8");
const paymentSrc = readFileSync(path.join(root, "src/payment-confirm.js"), "utf8");

test("TEST 1 single-order path unchanged (place_order + 立即下单)", () => {
  assert.match(placeSrc, /action:\s*"place_order"/);
  assert.match(placeSrc, /MCJPlaceOrder/);
  assert.match(hallSrc, /立即下单/);
  assert.match(hallSrc, /data-hall-order/);
  assert.doesNotMatch(placeSrc, /place_multi_order/);
});

test("TEST 1b checkout has +加一位陪玩一起下单 (no order create)", () => {
  assert.match(placeSrc, /加一位陪玩一起下单/);
  assert.match(placeSrc, /data-po-add-another/);
  assert.match(placeSrc, /addAnotherCompanion/);
  assert.match(placeSrc, /joinTeamAndCheckout/);
  assert.match(placeSrc, /MCJMultiCompanionTeam\.add/);
  assert.doesNotMatch(placeSrc, /addAnotherCompanion[\s\S]{0,400}place_order/);
});

test("TEST 2–3 add companions increments count + group total", () => {
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
    companionName: "晴子",
    unitPrice: 30,
    service: "CSGO",
    online: true,
  });
  assert.equal(a.ok, true);
  assert.equal(api.getCount(), 1);
  assert.equal(api.getTotal(), 30);
  const b = api.add({
    companionId: "22222222-2222-4222-8222-222222222222",
    companionName: "瑞秋",
    unitPrice: 25,
    service: "无畏契约",
    online: true,
  });
  assert.equal(b.ok, true);
  assert.equal(api.getCount(), 2);
  assert.equal(api.getTotal(), 55);

  // TEST 4 duplicate
  const dup = api.add({
    companionId: "11111111-1111-4111-8111-111111111111",
    companionName: "晴子",
    unitPrice: 30,
    online: true,
  });
  assert.equal(dup.ok, false);
  assert.equal(dup.error, "duplicate");
  assert.equal(api.getCount(), 2);

  // TEST 6 remove 瑞秋
  api.remove("22222222-2222-4222-8222-222222222222");
  assert.equal(api.getCount(), 1);
  assert.equal(api.getTotal(), 30);

  // restore 瑞秋
  api.add({
    companionId: "22222222-2222-4222-8222-222222222222",
    companionName: "瑞秋",
    unitPrice: 25,
    service: "无畏契约",
    online: true,
  });

  // TEST 8 payload uses place_multi_order once (single payload)
  sandbox.window.MCJMultiCompanionTeam._test.state.sharedGameId = "boss-gid-1";
  const payload = api.buildPayload();
  assert.equal(payload.action, "place_multi_order");
  assert.equal(payload.companions.length, 2);
  assert.equal(payload.companions[0].totalAmount, 30);
  assert.equal(payload.companions[1].totalAmount, 25);
  assert.equal(payload.paymentMethod, "catfood");
  assert.ok(payload.idempotencyKey);

  // same key while pending
  const payload2 = api.buildPayload();
  assert.equal(payload2.idempotencyKey, payload.idempotencyKey);

  // TEST 9 no place_order in team module
  assert.doesNotMatch(teamSrc, /action:\s*["']place_order["']/);
  assert.match(teamSrc, /place_multi_order/);

  // TEST 10 clear
  api.clear();
  assert.equal(api.getCount(), 0);
});

test("TEST floating bar + checkout copy", () => {
  assert.match(teamSrc, /已选/);
  assert.match(teamSrc, /人 ·/);
  assert.match(teamSrc, /继续选/);
  assert.match(teamSrc, /查看队伍/);
  assert.match(teamSrc, /去结算/);
  assert.match(teamSrc, /确认付款/);
  assert.match(teamSrc, /联合下单/);
  assert.match(teamSrc, /本订单一次付款，每位陪玩按自己的服务价格分别结算/);
  assert.match(teamSrc, /data-mcj-team-continue/);
});

test("TEST boss list parent-only + child hidden", () => {
  assert.match(ordersHtml, /isMultiParent|isMultiGroupParent/);
  assert.match(ordersHtml, /isMultiChild/);
  assert.match(ordersHtml, /if\(isMultiChild\(o\)\)return false/);
  assert.match(ordersHtml, /多人陪玩订单/);
  assert.match(ordersHtml, /multiCompanionLabel|共.*位陪玩/);
  assert.match(ordersHtml, /od-children|陪玩列表/);
  assert.match(ordersHtml, /data-action="request_refund"/);
});

test("TEST companion co-peer visibility (no peer income)", () => {
  assert.match(companionApi, /attachGroupPeers/);
  assert.match(companionApi, /groupPeers/);
  assert.match(workbenchSrc, /本次联合陪玩/);
  assert.match(workbenchSrc, /一起接单/);
  assert.match(workbenchSrc, /你的订单金额/);
  assert.match(workbenchSrc, /其他陪玩收入不会显示/);
  assert.doesNotMatch(companionApi, /_groupPeers[\s\S]{0,200}playerIncome/);
});

test("TEST payment page multi parent", () => {
  assert.match(paymentSrc, /isMultiParent/);
  assert.match(paymentSrc, /多人陪玩订单/);
  assert.match(paymentSrc, /总付款|一次付款/);
});

test("TEST hall cards only 查看详情 + 立即下单 (no 加入一起下单)", () => {
  assert.match(hallSrc, /查看详情/);
  assert.match(hallSrc, /立即下单/);
  assert.match(hallSrc, /data-hall-order/);
  assert.doesNotMatch(hallSrc, /加入一起下单/);
  assert.doesNotMatch(hallSrc, /data-hall-team-add/);
  assert.match(centerHtml, /multi-companion-team\.js/);
  assert.match(teamSrc, /联合下单/);
  assert.match(teamSrc, /继续添加陪玩/);
  assert.match(teamSrc, /mcj-team-member/);
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
