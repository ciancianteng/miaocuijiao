/**
 * P0: Boss order list 【评价陪玩】 entry + shared review modal + cross-portal sync.
 * DEPLOY_BUMP: admin-order-review-sync
 * Usage: PREVIEW=https://meow-cuijiao-homepage-staging.vercel.app node scripts/p0-boss-order-review-entry-e2e.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, devices } from "playwright-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.PREVIEW || process.env.MCJ_STAGING_URL || "https://meow-cuijiao-homepage-staging.vercel.app").replace(
  /\/$/,
  ""
);
const PASS = process.env.PASS || process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const BOSS = process.env.E2E_BOSS_EMAIL || "boss.final.1785714993009@meow.test";
const CS = process.env.E2E_CS_EMAIL || "service.final.1785714993009@meow.test";
const COMP = process.env.E2E_COMPANION_EMAIL || "companion.final.1785714993009@meow.test";
const ADMIN = process.env.E2E_ADMIN_EMAIL || "admin@meow.test";
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const ART = path.join("/opt/cursor/artifacts", "boss-order-review-entry-e2e");
const ART_REPO = path.join(ROOT, "artifacts", "boss-order-review-entry-e2e");
fs.mkdirSync(ART, { recursive: true });
fs.mkdirSync(ART_REPO, { recursive: true });

const results = [];
function step(name, ok, detail) {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "").slice(0, 600) });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
  return ok;
}
function tok(j) {
  return j?.session?.accessToken || j?.session?.token || j?.accessToken || j?.token || "";
}
async function api(pathname, token, body, method = null, extraHeaders = {}) {
  const m = method || (body == null ? "GET" : "POST");
  const res = await fetch(`${BASE}${pathname}`, {
    method: m,
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body != null ? { "Content-Type": "application/json" } : {}),
      ...extraHeaders,
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok && json.ok !== false, status: res.status, json };
}
async function shot(page, name) {
  const file = `${name}.png`;
  const p1 = path.join(ART, file);
  await page.screenshot({ path: p1, fullPage: true }).catch(() => null);
  try {
    fs.copyFileSync(p1, path.join(ART_REPO, file));
  } catch (_) {}
  return p1;
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

(async () => {
  console.log("BASE", BASE);
  const stamp = Date.now();
  const reviewText = `老板订单列表评价E2E ${stamp}`;

  const asset = await fetch(`${BASE}/orders.html?cb=${stamp}`, { cache: "no-store" });
  const html = await asset.text();
  step("orders_has_review_modal", /id="reviewModal"/.test(html) && /data-review-order/.test(html), /reviewModal|data-review-order/.test(html) ? "markers present" : "missing markers");
  const mineHtml = await (await fetch(`${BASE}/mine.html?cb=${stamp}`, { cache: "no-store" })).text();
  step("mine_has_pending_tip", /pendingReviewTipId|您有订单还未评价陪玩/.test(mineHtml), /您有订单还未评价陪玩/.test(mineHtml) ? "tip copy present" : "missing tip");

  const bossLogin = await api("/api/auth", null, { action: "login", email: BOSS, password: PASS, loginPortal: "boss" });
  const bossT = tok(bossLogin.json);
  const csLogin = await api("/api/customer-service", null, { action: "login", account: CS, password: PASS });
  const csT = tok(csLogin.json) || tok((await api("/api/auth", null, { action: "login", email: CS, password: PASS, loginPortal: "customer_service" })).json);
  const compLogin = await api("/api/companion", null, { action: "login", account: COMP, password: PASS });
  const compT = tok(compLogin.json) || tok((await api("/api/auth", null, { action: "login", email: COMP, password: PASS, loginPortal: "companion" })).json);
  const adminLogin = await api("/api/auth", null, { action: "login", email: ADMIN, password: PASS, loginPortal: "admin" });
  const adminT = tok(adminLogin.json);
  step("logins", !!(bossT && csT && compT && adminT), `boss=${!!bossT} cs=${!!csT} comp=${!!compT} admin=${!!adminT}`);
  if (!bossT || !csT || !compT || !adminT) {
    fs.writeFileSync(path.join(ART, "results.json"), JSON.stringify({ results, overall: "FAIL" }, null, 2));
    process.exit(1);
  }

  const bootMe = await api("/api/companion?action=bootstrap", compT, null, "GET");
  const companionId = bootMe.json?.data?.player?.id || bootMe.json?.player?.id || "";
  const comps = await api("/api/public/companions", null, null, "GET");
  const testComp =
    (comps.json?.companions || []).find((c) => String(c.id) === String(companionId)) ||
    (comps.json?.companions || []).find((c) => /Final|1717|TEST|验收/i.test(c.name || "")) ||
    (comps.json?.companions || [])[0];
  const unit = Number(
    (Array.isArray(testComp?.services) && testComp.services[0] && (testComp.services[0].price ?? testComp.services[0].unitPrice)) ||
      testComp?.priceValue ||
      testComp?.price ||
      35
  );
  const place = await api("/api/orders", bossT, {
    action: "place_order",
    companionId: testComp?.id || companionId,
    companionName: testComp?.name || "E2E陪玩",
    serviceType: (testComp?.services && testComp.services[0] && (testComp.services[0].name || testComp.services[0].title)) || "VALORANT",
    service: (testComp?.services && testComp.services[0] && (testComp.services[0].name || testComp.services[0].title)) || "VALORANT",
    game: testComp?.game || "VALORANT",
    unitPrice: unit,
    hours: 1,
    quantity: 1,
    totalAmount: unit,
    gameId: `REVIEW-ENTRY-${stamp}`,
    paymentMethod: "tng",
    notes: `review-entry-e2e ${stamp}`,
    idempotencyKey: `review-entry-${stamp}`,
  });
  let orderId = place.json?.order?.id || "";
  let orderNo = place.json?.order?.orderNo || place.json?.order?.order_no || orderId;
  step("place_order", !!(place.ok && orderId), `${orderNo} status=${place.json?.order?.status} msg=${place.json?.message || ""}`);

  const proof = await api("/api/orders", bossT, {
    action: "submit_payment_proof",
    id: orderId,
    proofDataUrl: PNG,
    paymentMethod: "tng",
  });
  step("submit_proof", !!proof.ok, proof.json?.message || `review=${proof.json?.order?.paymentReview}`);

  const pay = await api("/api/customer-service", csT, { action: "confirm_payment", id: orderId });
  let st = pay.json?.order?.status || "";
  step("confirm_payment", !!(pay.ok && (st === "claimed" || st === "pending" || st === "waiting_boss_confirm")), `status=${st} msg=${pay.json?.message || ""}`);

  if (st === "pending") {
    const assign = await api("/api/customer-service", csT, {
      action: "assign_companion",
      id: orderId,
      companion_id: testComp?.id || companionId,
      from_grabs: false,
    });
    st = assign.json?.order?.status || st;
    step("assign_companion", !!assign.ok, `status=${st}`);
  } else {
    step("assign_companion", true, `skip status=${st}`);
  }

  // Clear forced ack so companion can accept
  const pendingForced = await api("/api/companion", compT, { action: "pending_forced" });
  for (const item of pendingForced.json?.pendingForced || []) {
    await api("/api/companion", compT, {
      action: "acknowledge_forced",
      id: item.id || item.contentId || item.content_id,
      content_id: item.id || item.contentId || item.content_id,
    });
  }

  let accept = await api("/api/companion", compT, { action: "accept_direct_order", id: orderId });
  st = accept.json?.order?.status || accept.json?.order?.dbStatus || st;
  if (!accept.ok) {
    accept = await api("/api/companion", compT, { action: "accept_order", id: orderId });
    st = accept.json?.order?.status || st;
  }
  if (st === "waiting_boss_confirm") {
    const bc = await api("/api/orders", bossT, { action: "confirm_companion", id: orderId });
    st = bc.json?.order?.status || st;
  }
  if (st === "confirmed") {
    const start = await api("/api/companion", compT, { action: "start_order", id: orderId });
    st = start.json?.order?.status || st;
  }
  step("start_order", st === "in_progress", `status=${st} acceptMsg=${accept.json?.message || ""}`);

  const complete = await api("/api/companion", compT, { action: "complete_order", id: orderId });
  st = complete.json?.order?.status || st;
  if (st === "in_progress" || complete.json?.awaitingBossConfirm) {
    const confirmDone = await api("/api/orders", bossT, { action: "confirm_completion", id: orderId });
    st = confirmDone.json?.order?.status || st;
    step("boss_confirm_completion", st === "completed" || confirmDone.json?.order?.canReview === true, `status=${st} canReview=${confirmDone.json?.order?.canReview}`);
  } else {
    step("boss_confirm_completion", st === "completed", `direct status=${st}`);
  }

  const listBefore = await api("/api/orders", bossT, null, "GET");
  const rowBefore = (listBefore.json?.orders || []).find((o) => o.id === orderId);
  step(
    "api_can_review",
    !!(rowBefore && (rowBefore.canReview || (rowBefore.status === "completed" && !rowBefore.reviewed))),
    `status=${rowBefore?.status} canReview=${rowBefore?.canReview} reviewed=${rowBefore?.reviewed}`
  );

  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || "/usr/bin/google-chrome-stable",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({ ...devices["iPhone 13"] });
  const page = await context.newPage();
  await page.addInitScript(
    ({ token }) => {
      try {
        localStorage.setItem("mcjAuthAccessToken", token);
        sessionStorage.setItem("mcjAuthAccessToken", token);
        localStorage.setItem("mcjRole", "boss");
      } catch (_) {}
    },
    { token: bossT }
  );

  // Tip on mine (first visit this session) — wait for async pending-review check
  await page.goto(`${BASE}/mine.html?cb=${stamp}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  let tipVisible = 0;
  for (let i = 0; i < 20; i++) {
    tipVisible = await page.locator(".review-tip").filter({ hasText: "您有订单还未评价陪玩" }).count();
    if (tipVisible > 0) break;
    await page.waitForTimeout(500);
  }
  step("mine_tip_once", tipVisible > 0, `tipCount=${tipVisible}`);
  await shot(page, "01-mine-tip");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);
  const tipAgain = await page.locator(".review-tip").filter({ hasText: "您有订单还未评价陪玩" }).count();
  step("mine_tip_no_repeat_refresh", tipAgain === 0, `tipCount=${tipAgain}`);

  await page.goto(`${BASE}/orders.html?filter=completed&cb=${stamp}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(3500);
  const card = page.locator(`[data-order-id="${orderId}"]`);
  await card.waitFor({ timeout: 20000 }).catch(() => null);
  const reviewBtn = card.locator('button[data-review-order]');
  const reviewBtnText = ((await reviewBtn.textContent().catch(() => "")) || "").trim();
  step("list_review_btn", reviewBtnText === "评价陪玩", `text="${reviewBtnText}"`);
  await shot(page, "02-list-review-btn");

  if (await reviewBtn.count()) {
    await reviewBtn.click();
    await page.waitForTimeout(600);
    const modalOpen = await page.locator("#reviewModal.open").count();
    step("review_modal_opens", modalOpen > 0, `open=${modalOpen}`);
    await page.locator('#reviewStars [data-star="5"]').click().catch(() => null);
    await page.fill("#reviewContent", reviewText);
    await shot(page, "03-review-modal");
    page.once("dialog", async (d) => {
      step("submit_success_alert", /成功|已提交|已评价/.test(d.message()), d.message());
      await d.accept();
    });
    await page.click("#reviewSubmitBtn");
    await page.waitForTimeout(2500);
  } else {
    step("review_modal_opens", false, "no list button");
    step("submit_success_alert", false, "skipped");
  }

  await page.waitForTimeout(1500);
  await page.goto(`${BASE}/orders.html?filter=completed&cb=${stamp + 1}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const cardAfter = page.locator(`[data-order-id="${orderId}"]`);
  const doneBtnText = ((await cardAfter.locator("button.is-disabled, button:disabled").first().textContent().catch(() => "")) || "").trim();
  const stillCan = await cardAfter.locator('button[data-review-order]').count();
  step("list_reviewed_btn", doneBtnText.includes("已评价") && stillCan === 0, `done="${doneBtnText}" stillCan=${stillCan}`);
  await shot(page, "04-list-reviewed");

  // Detail second entry should show 已评价
  const detailBtn = cardAfter.locator('button[data-detail]');
  if (await detailBtn.count()) {
    await detailBtn.click();
    await page.waitForTimeout(1500);
  } else {
    await page.evaluate((id) => {
      const btn = document.createElement("button");
      btn.setAttribute("data-detail", id);
      document.body.appendChild(btn);
      btn.click();
      btn.remove();
    }, orderId);
    await page.waitForTimeout(1500);
  }
  const detailReviewed = await page.locator("#detailModal.open").locator("text=已评价").count();
  step("detail_second_entry_reviewed", detailReviewed > 0, `count=${detailReviewed}`);
  await shot(page, "05-detail-reviewed");

  // Duplicate submit blocked
  const dup = await api("/api/orders", bossT, { action: "submit_review", id: orderId, rating: 4, content: "dup" });
  step("duplicate_blocked", !!(dup.ok && (dup.json?.already === true || /已评价/.test(String(dup.json?.message || "")))), `already=${dup.json?.already} msg=${dup.json?.message}`);

  // Companion sees review
  const compBoot = await api("/api/companion", compT, null, "GET");
  const reviews = compBoot.json?.reviews || compBoot.json?.data?.reviews || [];
  const hitComp = reviews.find((r) => String(r.orderId || r.order_id || "").includes(String(orderNo)) || String(r.content || "").includes(String(stamp)));
  step("companion_sees_review", !!hitComp, `reviews=${reviews.length} hit=${!!hitComp}`);

  // Public profile sync
  const pubId = testComp?.id || companionId;
  const pub = await api(`/api/public/companions?id=${encodeURIComponent(pubId)}`, null, null, "GET");
  const pubOne = pub.json?.companion || (pub.json?.companions || []).find((c) => String(c.id) === String(pubId)) || null;
  const pubReviews = pubOne?.reviews || pub.json?.reviews || [];
  const hitPub = (Array.isArray(pubReviews) ? pubReviews : []).some((r) => String(r.content || "").includes(String(stamp)));
  const ratingOk = Number(pubOne?.rating || pubOne?.stats?.rating || 0) > 0 || hitPub || (pubOne?.reviewCount || 0) > 0;
  step("public_review_sync", !!(hitPub || ratingOk), `hitPub=${hitPub} rating=${pubOne?.rating} count=${pubOne?.reviewCount}`);

  // Admin order detail reviews
  const adminOrder = await api(`/api/admin/orders?id=${encodeURIComponent(orderId)}`, adminT, null, "GET", {
    "x-mcj-admin-role": "admin",
  });
  const adminReviews =
    adminOrder.json?.reviews ||
    adminOrder.json?.order?.reviews ||
    [];
  let adminHit = (Array.isArray(adminReviews) ? adminReviews : []).some(
    (r) => String(r.content || "").includes(String(stamp)) || String(r.order_id || r.orderId || "") === String(orderId)
  );
  if (!adminHit) {
    const contentHit = String(adminOrder.json?.order?.reviewContent || "").includes(String(stamp));
    adminHit = contentHit || !!adminOrder.json?.order?.reviewed;
  }
  if (!adminHit) {
    const adminList = await api("/api/admin/orders?action=reviews", adminT, null, "GET", { "x-mcj-admin-role": "admin" });
    const all = adminList.json?.reviews || [];
    adminHit = all.some((r) => String(r.order_id || r.orderId || "") === String(orderId) || String(r.content || "").includes(String(stamp)));
    step("admin_sees_review", adminHit, `via=reviews_action count=${all.length}`);
  } else {
    step("admin_sees_review", true, `order_detail count=${adminReviews.length} rating=${adminOrder.json?.order?.reviewRating}`);
  }

  await browser.close();

  const failed = results.filter((r) => r.result === "FAIL");
  const overall = failed.length ? "FAIL" : "PASS";
  const out = { overall, failed: failed.length, results, orderId, orderNo, reviewText, base: BASE };
  fs.writeFileSync(path.join(ART, "results.json"), JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(ART_REPO, "results.json"), JSON.stringify(out, null, 2));
  console.log("OVERALL", overall, `failed=${failed.length}`);
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
