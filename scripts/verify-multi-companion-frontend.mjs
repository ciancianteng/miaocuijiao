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

test("TEST 1b modal has 再加一位陪玩 (no order create)", () => {
  assert.match(placeSrc, /再加一位陪玩/);
  assert.match(placeSrc, /data-po-add-another/);
  assert.match(placeSrc, /addAnotherCompanion/);
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
        if (Array.isArray(c.services) && c.services.length) {
          return c.services.map(function (s, i) {
            return {
              name: s.name,
              price: Number(s.price || 0),
              serviceId: s.serviceId || s.id || "",
              sort: i,
            };
          });
        }
        return [{ name: c.service || "陪玩", price: Number(c.unitPrice || 30), serviceId: c.serviceId || "" }];
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

  // P0-4: service-specific price must win over level default unitPrice
  const priced = api.add({
    companionId: "33333333-3333-4333-8333-333333333333",
    companionName: "小宏",
    unitPrice: 30, // level default
    service: "三角洲手游 国服",
    serviceId: "svc-delta",
    services: [
      { name: "王者荣耀", price: 30, serviceId: "svc-wz" },
      { name: "三角洲手游 国服", price: 35, serviceId: "svc-delta" },
      { name: "三角洲陪跑刀 一千万", price: 30, serviceId: "svc-knife" },
    ],
    online: true,
  });
  assert.equal(priced.ok, true);
  assert.equal(api.getLines()[0].unitPrice, 35);
  assert.equal(api.getLines()[0].serviceId, "svc-delta");
  assert.equal(api.getLines()[0].service, "三角洲手游 国服");
  assert.equal(api.getTotal(), 35);
  api.clear();

  // P0-5: preferId miss must NOT fall back to services[0] (王者荣耀@30)
  // Name still matches → keep 三角洲@35
  const missId = api.add({
    companionId: "44444444-4444-4444-8444-444444444444",
    companionName: "小宏",
    unitPrice: 35,
    service: "三角洲手游 国服",
    serviceId: "svc-delta-stale-id",
    services: [
      { name: "王者荣耀 国服", price: 30, serviceId: "svc-wz" },
      { name: "三角洲手游 国服", price: 35, serviceId: "svc-delta" },
    ],
    online: true,
  });
  assert.equal(missId.ok, true);
  assert.equal(api.getLines()[0].unitPrice, 35);
  assert.equal(api.getLines()[0].service, "三角洲手游 国服");
  assert.notEqual(api.getLines()[0].service, "王者荣耀 国服");
  api.clear();

  // P0-5b: both id+name miss catalog → keep explicit unitPrice/name (no services[0])
  const missBoth = api.add({
    companionId: "55555555-5555-4555-8555-555555555555",
    companionName: "小宏",
    unitPrice: 35,
    service: "三角洲手游 国服",
    serviceId: "svc-orphan",
    services: [{ name: "王者荣耀 国服", price: 30, serviceId: "svc-wz" }],
    online: true,
  });
  assert.equal(missBoth.ok, true);
  assert.equal(api.getLines()[0].unitPrice, 35);
  assert.equal(api.getLines()[0].service, "三角洲手游 国服");
  assert.equal(api.getLines()[0].serviceId, "svc-orphan");
  api.clear();

  // CASE A: 35 + 35 = 70
  api.add({
    companionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    companionName: "小灰灰",
    unitPrice: 30,
    service: "三角洲手游 国服",
    serviceId: "svc-delta",
    services: [
      { name: "王者荣耀 国服", price: 30, serviceId: "svc-wz" },
      { name: "三角洲手游 国服", price: 35, serviceId: "svc-delta" },
    ],
    online: true,
  });
  api.add({
    companionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    companionName: "小宏",
    unitPrice: 30,
    service: "三角洲手游 国服",
    serviceId: "svc-delta",
    services: [
      { name: "王者荣耀 国服", price: 30, serviceId: "svc-wz" },
      { name: "三角洲手游 国服", price: 35, serviceId: "svc-delta" },
    ],
    online: true,
  });
  assert.equal(api.getLines()[0].unitPrice, 35);
  assert.equal(api.getLines()[1].unitPrice, 35);
  assert.equal(api.getTotal(), 70);
  api.clear();

  // CASE B: 35 + 30 = 65
  api.add({
    companionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    companionName: "小灰灰",
    unitPrice: 30,
    service: "三角洲手游 国服",
    serviceId: "svc-delta",
    services: [
      { name: "王者荣耀 国服", price: 30, serviceId: "svc-wz" },
      { name: "三角洲手游 国服", price: 35, serviceId: "svc-delta" },
    ],
    online: true,
  });
  api.add({
    companionId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    companionName: "小宏",
    unitPrice: 30,
    service: "王者荣耀 国服",
    serviceId: "svc-wz",
    services: [
      { name: "王者荣耀 国服", price: 30, serviceId: "svc-wz" },
      { name: "三角洲手游 国服", price: 35, serviceId: "svc-delta" },
    ],
    online: true,
  });
  assert.equal(api.getTotal(), 65);
  const payloadCaseB = api.buildPayload();
  assert.equal(payloadCaseB.companions[0].unitPrice, 35);
  assert.equal(payloadCaseB.companions[0].totalAmount, 35);
  assert.equal(payloadCaseB.companions[1].unitPrice, 30);
  assert.equal(payloadCaseB.companions[1].totalAmount, 30);
  api.clear();

  // CASE C: both level fallback 30 → 60
  api.add({
    companionId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    companionName: "A",
    unitPrice: 30,
    service: "王者荣耀 国服",
    serviceId: "svc-wz",
    services: [{ name: "王者荣耀 国服", price: 30, serviceId: "svc-wz" }],
    online: true,
  });
  api.add({
    companionId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    companionName: "B",
    unitPrice: 30,
    service: "王者荣耀 国服",
    serviceId: "svc-wz",
    services: [{ name: "王者荣耀 国服", price: 30, serviceId: "svc-wz" }],
    online: true,
  });
  assert.equal(api.getTotal(), 60);
  api.clear();
});

test("TEST floating bar + checkout copy", () => {
  assert.match(teamSrc, /已选/);
  assert.match(teamSrc, /人 ·/);
  assert.match(teamSrc, /继续选/);
  assert.match(teamSrc, /查看队伍/);
  assert.match(teamSrc, /去结算/);
  assert.match(teamSrc, /确认并支付/);
  assert.match(teamSrc, /本订单一次付款，系统会分别为每位陪玩结算/);
  assert.match(teamSrc, /data-mcj-team-continue/);
  assert.match(teamSrc, /continueToHall/);
  assert.match(teamSrc, /\/companion-center\.html/);
  assert.match(teamSrc, /mcjMultiTeamPicking/);
});

test("TEST continue选 navigates to hall (not toast-only)", () => {
  assert.match(teamSrc, /function continueToHall/);
  assert.match(teamSrc, /location\.href\s*=\s*HALL_HREF/);
  // Must not only toast without navigation on continue
  const continueBlock = teamSrc.slice(
    teamSrc.indexOf("[data-mcj-team-continue]"),
    teamSrc.indexOf("[data-mcj-team-continue]") + 280
  );
  assert.match(continueBlock, /continueToHall/);
});

test("TEST service price preferred over level unitPrice", () => {
  assert.match(teamSrc, /hasExplicit|preferId miss|never silently rewrite/i);
  assert.match(teamSrc, /serviceId/);
  assert.match(teamSrc, /addCompanionFromHallButton/);
  assert.doesNotMatch(teamSrc, /total\s*=\s*companions\.length\s*\*\s*30/);
  assert.doesNotMatch(teamSrc, /multiPrice\s*=\s*30/);
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
  assert.match(workbenchSrc, /同单陪玩/);
  assert.match(workbenchSrc, /联合订单/);
  assert.match(workbenchSrc, /你的订单金额/);
  assert.match(workbenchSrc, /其他陪玩收入不会显示/);
  assert.doesNotMatch(companionApi, /_groupPeers[\s\S]{0,200}playerIncome/);
});

test("TEST payment page multi parent", () => {
  assert.match(paymentSrc, /isMultiParent/);
  assert.match(paymentSrc, /多人陪玩订单/);
  assert.match(paymentSrc, /总付款|一次付款/);
});

test("TEST hall secondary CTA + center script wired", () => {
  assert.match(hallSrc, /加入一起下单/);
  assert.match(hallSrc, /data-hall-team-add/);
  assert.match(centerHtml, /multi-companion-team\.js/);
});

test("STATIC floating bar safe-area / bottom-nav offset", () => {
  const css = readFileSync(path.join(root, "src/multi-companion-team.css"), "utf8");
  assert.match(css, /--mcj-bottom-actions-h/);
  assert.match(css, /bottom:\s*calc\(var\(--mcj-bottom-actions-h/);
  assert.match(teamSrc, /syncBottomStackOffset/);
});

test("P0-1 submitOrder must not reference undeclared mask", () => {
  // Extract submitOrder body roughly and ensure readStartTimeFromDom(mask) is gone
  assert.doesNotMatch(placeSrc, /readStartTimeFromDom\(\s*mask\s*\)/);
  assert.match(placeSrc, /readStartTimeFromDom\(\s*activeMask\(\)\s*\)/);
  assert.match(placeSrc, /sanitizeUserError|Can't find variable/);
});

test("P0-2 iOS input font-size >= 16px in place-order modal", () => {
  const css = readFileSync(path.join(root, "src/place-order-modal.css"), "utf8");
  assert.match(css, /\.mcj-po-scroll input[\s\S]*?font-size:\s*16px/);
  assert.match(css, /text-size-adjust:\s*100%/);
  assert.doesNotMatch(css, /user-scalable\s*=\s*no/);
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
