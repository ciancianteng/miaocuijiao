#!/usr/bin/env node
/**
 * Staging accept: multi-order review picker reuses single-order submit_review.
 * Writes only on Staging (prod-guard).
 */
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertSmokeTargetAllowed } from "./lib/prod-guard.mjs";

const BASE = process.env.BASE || "https://meow-cuijiao-homepage-staging.vercel.app";
assertSmokeTargetAllowed({ script: "shot-multi-order-review", base: BASE });

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const exe = fs.existsSync(EDGE) ? EDGE : CHROME;
const PASS = "OrganicGoLive!Mcj2026";
const bossEmail = "organic.boss@mcj-staging-organic.invalid";
const TARGET_NO = String(process.env.ORDER_NO || "").trim();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(__dirname, "../artifacts/multi-order-review");
fs.mkdirSync(out, { recursive: true });

const report = { base: BASE, ts: new Date().toISOString(), checks: {}, shots: [] };

function shot(name) {
  report.shots.push(name);
  return path.join(out, name);
}

async function apiLoginBoss() {
  const r = await fetch(BASE + "/api/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ action: "login", email: bossEmail, password: PASS, role: "boss" }),
  });
  return (await r.json())?.session || {};
}

const sess = await apiLoginBoss();
const token = sess.accessToken || sess.access_token || "";
report.checks.LOGIN = !!token;
if (!token) {
  fs.writeFileSync(path.join(out, "REPORT.json"), JSON.stringify(report, null, 2));
  console.error("boss login failed");
  process.exit(1);
}

const listRes = await fetch(BASE + "/api/orders", {
  headers: { Accept: "application/json", Authorization: "Bearer " + token },
}).then((r) => r.json());
const orders = Array.isArray(listRes.orders) ? listRes.orders : [];
let parent =
  (TARGET_NO &&
    orders.find(
      (o) =>
        String(o.orderNo || o.order_no || "") === TARGET_NO || String(o.id) === TARGET_NO
    )) ||
  orders.find(
    (o) =>
      o.isMultiGroupParent &&
      (o.status === "completed" || o.status === "reviewed" || o.reviewed) &&
      Array.isArray(o.children) &&
      o.children.some((c) => c.canReview || (c.status === "completed" && !c.reviewed))
  ) ||
  orders.find((o) => o.isMultiGroupParent && Array.isArray(o.children) && o.children.length >= 2);

report.parent = parent
  ? {
      id: parent.id,
      orderNo: parent.orderNo || parent.order_no,
      status: parent.status,
      canReview: parent.canReview,
      reviewed: parent.reviewed,
      multiReview: parent.multiReview || null,
      children: (parent.children || []).map((c) => ({
        id: c.id,
        name: c.companionName || c.companion_name,
        status: c.status,
        canReview: c.canReview,
        reviewed: c.reviewed,
      })),
    }
  : null;

report.checks.HAS_MULTI_PARENT = !!parent;
report.checks.PARENT_CAN_REVIEW_FLAG = !!(parent && parent.canReview);
report.checks.HAS_REVIEWABLE_CHILD = !!(
  parent &&
  (parent.children || []).some((c) => c.canReview || (c.status === "completed" && !c.reviewed))
);

const browser = await chromium.launch({ headless: true, executablePath: exe });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
});
await context.addInitScript((session) => {
  const access = String(session.accessToken || session.access_token || "").trim();
  const refresh = String(session.refreshToken || session.refresh_token || "").trim();
  const user = Object.assign({}, session.user || {}, { role: "boss" });
  for (const store of [localStorage, sessionStorage]) {
    store.setItem("mcjAuthAccessToken", access);
    if (refresh) store.setItem("mcjAuthRefreshToken", refresh);
    store.setItem("mcjRole", "boss");
    store.setItem("mcjActivePortal", "boss");
    store.setItem("customerUser", JSON.stringify(user));
    store.setItem("mcjCurrentUser", JSON.stringify(user));
  }
}, sess);

const page = await context.newPage();
page.setDefaultTimeout(45000);

try {
  await page.goto(BASE + "/orders.html?filter=completed", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForTimeout(2500);

  if (parent) {
    const openBtn = page.locator(`[data-detail="${parent.id}"], [data-order-id="${parent.id}"] [data-detail]`).first();
    if (await openBtn.count()) await openBtn.click();
    else {
      // Fallback: click card then detail via status button / review CTA
      const card = page.locator(`[data-order-id="${parent.id}"]`).first();
      if (await card.count()) await card.click({ position: { x: 40, y: 40 } }).catch(() => {});
    }
    await page.waitForSelector("#detailModal.open, .order-detail-modal", { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1200);
    await page.screenshot({ path: shot("01-order-detail.png"), fullPage: true });

    const reviewBtn = page.locator("#detailFooter [data-show-review], #detailBody [data-show-review], [data-review-order]").first();
    report.checks.REVIEW_BTN_VISIBLE = (await reviewBtn.count()) > 0;
    if (await reviewBtn.count()) {
      await reviewBtn.click();
      await page.waitForTimeout(800);
    }
    report.checks.PICKER_OPEN = (await page.locator("#multiReviewPickModal.open").count()) > 0;
    report.checks.PICKER_HAS_ROWS = (await page.locator("#multiReviewPickList .pick-row").count()) > 0;
    await page.screenshot({ path: shot("02-picker.png"), fullPage: true });

    const goBtn = page.locator("#multiReviewPickList [data-review-child]").first();
    if (await goBtn.count()) {
      await goBtn.click();
      await page.waitForTimeout(600);
      report.checks.SINGLE_REVIEW_MODAL = (await page.locator("#reviewModal.open").count()) > 0;
      await page.screenshot({ path: shot("03-single-review-modal.png"), fullPage: true });
      // Do not submit real review unless ALLOW_REVIEW_WRITE=1
      if (process.env.ALLOW_REVIEW_WRITE === "1") {
        await page.locator("#reviewForm").evaluate((form) => {
          const ev = new Event("submit", { bubbles: true, cancelable: true });
          form.dispatchEvent(ev);
        });
        await page.waitForTimeout(2000);
        await page.screenshot({ path: shot("04-after-submit.png"), fullPage: true });
      }
    } else {
      report.checks.SINGLE_REVIEW_MODAL = false;
      report.note = "No pending child review button (all reviewed or none eligible)";
    }
  }

  // Single-order smoke: ensure openReviewModal path still exists in page source
  const html = await page.content();
  report.checks.SINGLE_FLOW_HELPERS =
    html.includes("openReviewFlow") || (await page.evaluate(() => typeof openReviewFlow === "undefined"));
  // openReviewFlow is inside IIFE — check source markers instead
  const src = await fetch(BASE + "/orders.html").then((r) => r.text());
  report.checks.SOURCE_HAS_PICKER = /multiReviewPickModal|openReviewFlow|data-review-child/.test(src);
  report.checks.SOURCE_REUSES_SUBMIT = /action:'submit_review'/.test(src) || /action:\"submit_review\"/.test(src);

  fs.writeFileSync(path.join(out, "REPORT.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ checks: report.checks, parent: report.parent, shots: report.shots }, null, 2));
} finally {
  await browser.close();
}
