#!/usr/bin/env node
/**
 * Offline verification: boss tutorial v2.
 * Does NOT touch Production / Staging DB. Tutorial must be display-only.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const results = [];

function read(rel) {
  return readFileSync(path.join(root, rel), "utf8");
}

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

function loadConfig() {
  const code = read("src/guide-tutorial-config.js");
  const sandbox = { window: {}, globalThis: {} };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.runInNewContext(code, sandbox);
  return sandbox.MCJGuideTutorialConfig || sandbox.window.MCJGuideTutorialConfig;
}

const cfg = loadConfig();
const guideJs = read("src/guide-tutorial.js");
const guideCss = read("src/guide-tutorial.css");
const guideHtml = read("guide.html");
const mineHtml = read("mine.html");
const indexHtml = read("index.html");
const roleGates = read("src/role-gates.js");
const packageJson = read("package.json");

test("TEST 1 first-visit / home entry exists", () => {
  assert.match(indexHtml, /data-boss-tutorial-entry/);
  assert.match(indexHtml, /guide\.html\?role=boss/);
  assert.match(indexHtml, /第一次使用？查看老板使用教学|老板使用教学/);
});

test("TEST 2 mine replay entry exists", () => {
  assert.match(mineHtml, /data-boss-tutorial-entry/);
  assert.match(mineHtml, /老板使用教学/);
  assert.match(mineHtml, /guide\.html\?role=boss/);
});

test("TEST 3 tutorial does not create orders", () => {
  assert.doesNotMatch(guideJs, /place_order|place_multi_order|fetch\(['\"]\/api\/orders/);
  assert.doesNotMatch(guideJs, /debitWallet|creditWallet|\/api\/wallet/);
  const bossSteps = cfg.roles.boss.steps;
  assert.ok(bossSteps.length >= 10);
});

test("TEST 4 tutorial does not debit wallet / mutate live data", () => {
  assert.doesNotMatch(guideJs, /localStorage\.setItem\(['\"]mcjAuth/);
  assert.doesNotMatch(guideJs, /POST['\"]?\s*,/);
  assert.match(guideJs, /mcjGuideRoot/);
});

test("TEST 5 tutorial display-only (no payment writes)", () => {
  assert.doesNotMatch(guideJs, /submit_payment_proof|pay_order/);
  assert.match(guideHtml, /mcjGuideRoot/);
});

test("TEST 6 single-order tutorial present", () => {
  const ids = cfg.roles.boss.steps.map((s) => s.id);
  assert.ok(ids.includes("boss-single"));
  const step = cfg.roles.boss.steps.find((s) => s.id === "boss-single");
  assert.match(step.caption, /立即下单|游戏 ID|时长/);
  assert.ok(step.visualMock);
});

test("TEST 7 per-service pricing tutorial present", () => {
  assert.equal(cfg.flags.perServicePricingEnabled, true);
  const step = cfg.roles.boss.steps.find((s) => s.id === "boss-pricing");
  assert.ok(step);
  assert.match(step.caption, /单价|小计|总价|不同/);
  assert.match(step.visualMock, /王者荣耀|三角洲|40/);
  assert.doesNotMatch(JSON.stringify(cfg.roles.boss.steps), /每个陪玩只有一个固定价格/);
});

test("TEST 8 multi-companion tutorial present", () => {
  assert.equal(cfg.flags.multiCompanionEnabled, true);
  const add = cfg.roles.boss.steps.find((s) => s.id === "boss-multi-add");
  const team = cfg.roles.boss.steps.find((s) => s.id === "boss-multi-team");
  assert.ok(add && team);
  assert.match(add.caption + add.visualMock, /再加一位陪玩/);
  assert.match(team.caption, /联合订单|85|不用分开/);
});

test("TEST 9 clock/check confirmation tutorial", () => {
  const step = cfg.roles.boss.steps.find((s) => s.id === "boss-confirm");
  assert.ok(step);
  assert.match(step.visualMock, /🕐/);
  assert.match(step.visualMock, /✅/);
});

test("TEST 10 partial companion cancel tutorial", () => {
  const step = cfg.roles.boss.steps.find((s) => s.id === "boss-unavailable");
  assert.ok(step);
  assert.match(step.caption + step.visualMock, /当前陪玩无法接单，请重新选择陪玩/);
  assert.doesNotMatch(step.caption, /整个订单取消/);
});

test("TEST 11 replacement + keep-remaining tutorial", () => {
  const slot = cfg.roles.boss.steps.find((s) => s.id === "boss-replace-slot");
  const rep = cfg.roles.boss.steps.find((s) => s.id === "boss-replace");
  const keep = cfg.roles.boss.steps.find((s) => s.id === "boss-keep");
  assert.ok(slot && rep && keep);
  assert.match(slot.visualMock, /\+ 重新选择陪玩/);
  assert.match(rep.caption, /原联合订单|不用再确认/);
  assert.match(keep.visualMock + keep.caption, /只保留剩余陪玩继续/);
});

test("TEST 12 close tutorial returns to normal pages", () => {
  assert.match(guideJs, /data-skip/);
  assert.match(guideJs, /doneHref|location\.assign/);
  assert.match(cfg.roles.boss.doneHref, /companion-center/);
});

test("TEST 13 mobile layout CSS present", () => {
  assert.match(guideCss, /max-width:\s*420px|viewport-fit/);
  assert.match(guideCss, /mcj-guide-mock/);
  assert.match(guideCss, /gm-hl/);
  assert.match(guideHtml, /viewport-fit=cover/);
});

test("TEST 14 reservation hidden when not Production", () => {
  assert.equal(cfg.flags.reservationTutorialEnabled, false);
  const ids = cfg.roles.boss.steps.map((s) => s.id);
  assert.ok(!ids.includes("boss-reservation"));
  const reserved = (cfg.roles.boss.allSteps || []).find((s) => s.id === "boss-reservation");
  assert.ok(reserved);
  assert.equal(reserved.enabled, false);
  assert.equal(reserved.hiddenReason, "NOT_PRODUCTION");
});

test("TEST 15 role-gates allow guide + cancel step enabled", () => {
  assert.match(roleGates, /\\\/guide\\\.html\$/);
  assert.equal(cfg.flags.unpaidCancelTutorialEnabled, true);
  assert.ok(cfg.roles.boss.steps.some((s) => s.id === "boss-cancel"));
  assert.match(packageJson, /verify:boss-tutorial/);
  assert.match(guideHtml, /20260920bossV2/);
});

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exitCode = 1;
