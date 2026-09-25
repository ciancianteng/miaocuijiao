#!/usr/bin/env node
/**
 * Offline verification: guide document (boss 01-12 + companion + login CTA).
 * Display-only — must not create orders / debit wallet.
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
  return sandbox.MCJ_GUIDE_TUTORIAL || sandbox.window.MCJ_GUIDE_TUTORIAL;
}

const cfg = loadConfig();
const guideJs = read("src/guide-tutorial.js");
const guideCss = read("src/guide-tutorial.css");
const guideHtml = read("guide.html");
const mineHtml = read("mine.html");
const indexHtml = read("index.html");
const roleGates = read("src/role-gates.js");
const packageJson = read("package.json");

test("TEST 1 home / mine entry exists", () => {
  assert.match(indexHtml, /guide\.html\?role=boss/);
  assert.match(mineHtml, /guide\.html\?role=boss/);
  assert.match(mineHtml, /老板使用教学|使用教学/);
});

test("TEST 2 config has boss + companion sections", () => {
  assert.ok(cfg && cfg.boss && cfg.companion);
  assert.equal(cfg.boss.title, "老板使用教学");
  assert.equal(cfg.companion.title, "陪玩教学");
  assert.ok(cfg.boss.steps.length >= 12);
  assert.ok(cfg.companion.steps.length >= 5);
});

test("TEST 3 boss required chapters present", () => {
  const titles = cfg.boss.steps.map((s) => s.title).join("|");
  assert.match(titles, /注册/);
  assert.match(titles, /充值猫粮/);
  assert.match(titles, /选择陪玩/);
  assert.match(titles, /单人立即下单/);
  assert.match(titles, /多陪玩一起下单/);
  assert.match(titles, /离线陪玩|预约/);
  assert.match(titles, /支付流程/);
  assert.match(titles, /客服审核/);
  assert.match(titles, /陪玩确认/);
  assert.match(titles, /开始服务/);
  assert.match(titles, /完成订单/);
  assert.match(titles, /评价陪玩/);
});

test("TEST 4 multi + CS review wording", () => {
  const multi = cfg.boss.steps.find((s) => s.id === "b05");
  const pay = cfg.boss.steps.find((s) => s.id === "b04");
  const cs = cfg.boss.steps.find((s) => s.id === "b08");
  assert.ok(multi && pay && cs);
  assert.match(JSON.stringify(multi), /加入一起下单|更换陪玩|放弃增加/);
  assert.match(JSON.stringify(pay), /等待客服审核|不会立刻进入/);
  assert.match(JSON.stringify(cs), /等待客服审核/);
});

test("TEST 5 companion login CTA reuses /companion/login/", () => {
  assert.equal(cfg.companionLoginHref, "/companion/login/");
  assert.match(guideJs, /companionLoginHref|\/companion\/login\//);
  assert.match(guideJs, /\/companion\/dashboard\//);
  assert.match(guideJs, /data-guide-companion-login/);
  assert.match(guideJs, /mcj-guide-login-btn|mcj-guide-companion-go/);
});

test("TEST 6 tutorial display-only (no order/wallet writes)", () => {
  assert.doesNotMatch(guideJs, /place_order|place_multi_order|fetch\(['\"]\/api\/orders/);
  assert.doesNotMatch(guideJs, /debitWallet|creditWallet|\/api\/wallet/);
  assert.doesNotMatch(guideJs, /submit_payment_proof|pay_order/);
  assert.doesNotMatch(guideJs, /localStorage\.setItem\(['\"]mcjAuth/);
  assert.match(guideJs, /mcjGuideRoot/);
  assert.match(guideHtml, /mcjGuideRoot/);
});

test("TEST 7 document CSS + mobile + shared header", () => {
  assert.match(guideCss, /mcj-guide-doc-card/);
  assert.match(guideCss, /mcj-guide-login-cta/);
  assert.match(guideCss, /mcj-guide-companion-go/);
  assert.match(guideCss, /max-width:\s*420px/);
  assert.match(guideHtml, /viewport-fit=cover/);
  assert.match(guideHtml, /boss-header\.js/);
  assert.match(guideHtml, /20260925guideNav1/);
  assert.match(guideJs, /data-guide-accordion|mcj-guide-acc/);
  assert.match(guideCss, /mcj-guide-acc-item/);
});

test("TEST 8 role-gates allow guide", () => {
  assert.match(roleGates, /\\\/guide\\\.html\$/);
  assert.match(packageJson, /verify:boss-tutorial/);
});

test("TEST 9 vite build includes guide.html", () => {
  const viteConfig = read("vite.config.js");
  assert.match(viteConfig, /["']guide\.html["']/);
  assert.match(viteConfig, /\["\/guide",\s*"\/guide\.html"\]/);
});

test("TEST 10 accordion mode + companion login CTA", () => {
  assert.match(guideJs, /data-guide-accordion/);
  assert.match(guideJs, /data-acc-toggle/);
  assert.match(guideJs, /data-guide-tab/);
  assert.match(guideJs, /data-guide-companion-login/);
  assert.match(guideJs, /renderCompanionShortcut|mcj-guide-companion-go/);
  assert.ok(cfg.companion.steps.length >= 12);
});

test("TEST 11 shared mobile nav has companion entry card", () => {
  const headerJs = read("src/boss-header.js");
  const headerCss = read("src/boss-header.css");
  assert.match(headerJs, /mcj-mnav-companion-card/);
  assert.match(headerJs, /\/companion\/login\//);
  assert.match(headerJs, /\/companion\/dashboard\//);
  assert.match(headerJs, /进入陪玩工作台/);
  assert.match(headerJs, /guide\.html/);
  assert.match(headerCss, /mcj-mnav-companion-card/);
});

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exitCode = 1;
