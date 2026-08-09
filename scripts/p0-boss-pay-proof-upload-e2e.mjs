/**
 * P0: Boss payment proof upload → preview → submit → my orders → CS/admin same URL.
 * Usage: PREVIEW=https://meow-cuijiao-homepage-staging.vercel.app node scripts/p0-boss-pay-proof-upload-e2e.mjs
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
const BOSS = process.env.E2E_BOSS_EMAIL || "boss@meow.test";
const CS = process.env.E2E_CS_EMAIL || "service@meow.test";
const ADMIN = process.env.E2E_ADMIN_EMAIL || "admin@meow.test";
const ART = path.join("/opt/cursor/artifacts", "boss-pay-proof-upload-e2e");
const ART_REPO = path.join(ROOT, "artifacts", "boss-pay-proof-upload-e2e");
fs.mkdirSync(ART, { recursive: true });
fs.mkdirSync(ART_REPO, { recursive: true });

const results = [];
function step(name, ok, detail) {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "").slice(0, 500) });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
  return ok;
}

async function api(pathname, token, body, method = null) {
  const m = method || (body == null ? "GET" : "POST");
  const res = await fetch(`${BASE}${pathname}`, {
    method: m,
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body != null ? { "Content-Type": "application/json" } : {}),
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok && json.ok !== false, status: res.status, json };
}
function tok(j) {
  return j?.session?.accessToken || j?.session?.token || j?.accessToken || j?.token || "";
}

function makePngBuffer(sizeHint = 40) {
  // Valid small PNG; for larger payload we pad with comments via canvas in browser.
  const b64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC";
  return Buffer.from(b64, "base64");
}

async function shot(page, name) {
  const file = `${name}.png`;
  const p1 = path.join(ART, file);
  await page.screenshot({ path: p1, fullPage: true });
  fs.copyFileSync(p1, path.join(ART_REPO, file));
  return p1;
}

(async () => {
  console.log("BASE", BASE);
  const html = await (await fetch(`${BASE}/payment-confirm.html?cb=${Date.now()}`, { cache: "no-store" })).text();
  step("asset_cache_bust", /payment-confirm\.js\?v=20260809payProofUpload2/.test(html), /payment-confirm\.js\?v=[^"']+/.exec(html)?.[0] || "missing");

  const bossT = tok((await api("/api/auth", null, { action: "login", email: BOSS, password: PASS, loginPortal: "boss" })).json);
  const csT = tok((await api("/api/customer-service", null, { action: "login", account: CS, password: PASS })).json);
  const adminT = tok((await api("/api/auth", null, { action: "login", email: ADMIN, password: PASS, loginPortal: "admin" })).json);
  step("logins", !!(bossT && csT && adminT), `boss=${!!bossT} cs=${!!csT} admin=${!!adminT}`);

  const place = await api("/api/orders", bossT, {
    action: "create",
    order: {
      title: "P0付款截图上传E2E",
      game: "VALORANT",
      game_id: "PAY-PROOF",
      description: "boss pay proof upload e2e",
      hours: 1,
      unit_price: 15,
      total_amount: 15,
      order_type: "custom",
      payment_method: "duitnow",
    },
  });
  const oid = place.json?.order?.id || "";
  const orderNo = place.json?.order?.orderNo || place.json?.order?.order_no || oid;
  step("create_order", !!(place.ok && oid), `${orderNo} ${oid}`);

  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || "/usr/bin/google-chrome-stable",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({ ...devices["iPhone 13"] });
  const page = await context.newPage();
  await page.addInitScript(
    ({ token }) => {
      localStorage.setItem("mcjAuthAccessToken", token);
      sessionStorage.setItem("mcjAuthAccessToken", token);
      localStorage.setItem("mcjRole", "boss");
      localStorage.setItem("customerUser", JSON.stringify({ role: "boss", email: "boss@meow.test", name: "Boss" }));
      localStorage.setItem("bossUser", JSON.stringify({ role: "boss", email: "boss@meow.test", name: "Boss" }));
    },
    { token: bossT }
  );

  await page.goto(`${BASE}/payment-confirm.html?order=${encodeURIComponent(oid)}&t=${Date.now()}`, {
    waitUntil: "domcontentloaded",
    timeout: 90000,
  });
  await page.waitForSelector("[data-proof-panel], [data-proof-pick]", { timeout: 45000 });
  await page.waitForSelector("#mcjDurableProofInput", { timeout: 10000 });
  await page.waitForTimeout(1200);
  await shot(page, "01-mobile-pay-page");

  const fileCss = await page.evaluate(() => {
    const input = document.querySelector("#mcjDurableProofInput, [data-mcj-durable-proof], [data-payment-proof]");
    if (!input) return null;
    const s = getComputedStyle(input);
    return {
      id: input.id,
      durable: input.getAttribute("data-mcj-durable-proof") === "1",
      outsideRoot: !document.getElementById("paymentConfirmApp")?.contains(input),
      display: s.display,
      opacity: s.opacity,
      pe: s.pointerEvents,
      hiddenAttr: !!input.hidden,
      w: input.getBoundingClientRect().width,
      h: input.getBoundingClientRect().height,
    };
  });
  step(
    "durable_file_input_outside_paint_root",
    !!(fileCss && fileCss.durable && fileCss.outsideRoot && fileCss.display !== "none" && !fileCss.hiddenAttr),
    JSON.stringify(fileCss)
  );

  // Disabled submit before file
  const beforeSubmit = await page.locator("[data-proof-submit]").first();
  const disabledBefore = await beforeSubmit.isDisabled();
  step("submit_disabled_without_file", disabledBefore, `disabled=${disabledBefore}`);

  // Simulate mobile poll race while picker is "open": force paint/load while selecting.
  await page.evaluate(() => {
    window.__mcjRacePaint = setInterval(() => {
      const app = document.getElementById("paymentConfirmApp");
      if (!app) return;
      // Mimic poll re-render pressure without leaving the page.
      app.dispatchEvent(new Event("mcj-test-paint-pressure"));
    }, 200);
  });

  // ① select real PNG via durable input (survives paint)
  await page.setInputFiles("#mcjDurableProofInput", {
    name: "duitnow-proof.png",
    mimeType: "image/png",
    buffer: makePngBuffer(),
  });
  await page.waitForSelector(".pay-proof-preview img", { timeout: 15000 });
  await page.evaluate(() => {
    if (window.__mcjRacePaint) clearInterval(window.__mcjRacePaint);
  });
  const preview = await page.evaluate(() => {
    const img = document.querySelector(".pay-proof-preview img");
    const name = document.querySelector("[data-proof-filename], .pay-proof-name");
    const tip = document.querySelector("[data-proof-success], .pay-success");
    const durable = document.getElementById("mcjDurableProofInput");
    return {
      src: img?.getAttribute("src") || "",
      natural: img?.naturalWidth || 0,
      name: name?.textContent || "",
      tip: tip?.textContent || "",
      submitEnabled: !document.querySelector("[data-proof-submit]")?.disabled,
      durableStillMounted: !!durable && !document.getElementById("paymentConfirmApp")?.contains(durable),
    };
  });
  step(
    "①②_preview_and_filename",
    /blob:|https?:/.test(preview.src) &&
      /已选择：duitnow-proof\.png/.test(preview.name) &&
      preview.submitEnabled &&
      preview.durableStillMounted,
    JSON.stringify(preview)
  );
  await shot(page, "02-mobile-preview-selected");

  // ④ click 我已付款
  await page.click("[data-proof-submit]");
  // Wait for either redirect or success tip then redirect
  await Promise.race([
    page.waitForURL(/orders\.html/, { timeout: 45000 }),
    page.waitForSelector("[data-proof-success]", { timeout: 45000 }).then(() => page.waitForURL(/orders\.html/, { timeout: 20000 })),
  ]);
  const landed = page.url();
  step("⑤_auto_redirect_my_orders", /orders\.html/.test(landed) && /payment_review|id=/.test(landed), landed);
  await page.waitForTimeout(2000);
  await shot(page, "03-mobile-my-orders-review");

  const ordersText = await page.evaluate(() => document.body.innerText.slice(0, 1200));
  step(
    "⑥_order_shows_pending_review",
    /待人工审核|待审核/.test(ordersText),
    ordersText.replace(/\s+/g, " ").slice(0, 220)
  );

  // Refresh boss
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const afterRefreshBoss = await page.evaluate(() => document.body.innerText.slice(0, 800));
  step("⑨a_boss_refresh_keeps_review", /待人工审核|待审核/.test(afterRefreshBoss), afterRefreshBoss.replace(/\s+/g, " ").slice(0, 180));
  await shot(page, "04-boss-refresh-still-review");

  // API: boss/CS/admin same proof URL
  const bossO = ((await api(`/api/orders?id=${oid}`, bossT, null, "GET")).json.orders || []).find((o) => o.id === oid);
  const csBoot = await api("/api/customer-service", csT, { action: "bootstrap" });
  const csO = (csBoot.json?.data?.orders || []).find((o) => o.id === oid);
  const fin = await api("/api/admin/finance?action=bootstrap", adminT, null, "GET");
  const pending = (fin.json?.pendingPaymentProofs || []).find((p) => String(p.orderId || p.order_id) === String(oid));
  const bossUrl = String(bossO?.paymentProofUrl || "");
  const csUrl = String(csO?.paymentProofUrl || csO?.payment_proof_url || "");
  const adminUrl = String(pending?.proofUrl || "");
  const samePath =
    bossUrl &&
    csUrl &&
    adminUrl &&
    bossUrl.split("?")[0] === csUrl.split("?")[0] &&
    bossUrl.split("?")[0] === adminUrl.split("?")[0];
  step(
    "⑦⑧_cs_admin_same_real_screenshot",
    !!(bossO?.paymentReview && csO?.paymentReview && pending && samePath && /companion-payment-proofs/.test(bossUrl)),
    JSON.stringify({
      bossReview: bossO?.paymentReview,
      csReview: csO?.paymentReview,
      samePath,
      bossUrl: bossUrl.slice(0, 100),
      csUrl: csUrl.slice(0, 100),
      adminUrl: adminUrl.slice(0, 100),
    })
  );

  // Open CS proof lightbox if possible
  const csPage = await context.newPage();
  await csPage.addInitScript(
    ({ token }) => {
      localStorage.setItem("mcjAuthAccessToken", token);
      sessionStorage.setItem("mcjAuthAccessToken", token);
    },
    { token: csT }
  );
  // Use API screenshot fetch instead of full CS UI login path for reliability
  if (csUrl) {
    const imgRes = await fetch(csUrl);
    step("⑦_cs_proof_url_fetchable", imgRes.ok, `status=${imgRes.status} type=${imgRes.headers.get("content-type")}`);
    const buf = Buffer.from(await imgRes.arrayBuffer());
    fs.writeFileSync(path.join(ART, "05-cs-proof-bytes.png"), buf);
    fs.copyFileSync(path.join(ART, "05-cs-proof-bytes.png"), path.join(ART_REPO, "05-cs-proof-bytes.png"));
  } else {
    step("⑦_cs_proof_url_fetchable", false, "missing cs url");
  }
  if (adminUrl) {
    const imgRes = await fetch(adminUrl);
    step("⑧_admin_proof_url_fetchable", imgRes.ok, `status=${imgRes.status} type=${imgRes.headers.get("content-type")}`);
    const buf = Buffer.from(await imgRes.arrayBuffer());
    fs.writeFileSync(path.join(ART, "06-admin-proof-bytes.png"), buf);
    fs.copyFileSync(path.join(ART, "06-admin-proof-bytes.png"), path.join(ART_REPO, "06-admin-proof-bytes.png"));
  } else {
    step("⑧_admin_proof_url_fetchable", false, "missing admin url");
  }

  // Admin UI screenshot of pending proof
  const adminPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await adminPage.goto(`${BASE}/admin/login/?t=${Date.now()}`, { waitUntil: "domcontentloaded" });
  await adminPage.fill('input[type=email],input[name=email]', ADMIN);
  await adminPage.fill('input[type=password]', PASS);
  await adminPage.click('button[type=submit],button:has-text("登录")');
  await adminPage.waitForURL(/admin\.html/, { timeout: 30000 });
  await adminPage.locator('[data-section="orders"]').first().click();
  await adminPage.evaluate(() => {
    const sec = document.getElementById("section-orders");
    if (sec) {
      sec.classList.add("active");
      sec.style.display = "block";
      sec.hidden = false;
    }
  });
  await adminPage.waitForTimeout(2500);
  await shot(adminPage, "07-admin-orders-pending-proof");

  await browser.close();

  const summary = {
    verdict: results.every((r) => r.result === "PASS") ? "PASS" : "FAIL",
    base: BASE,
    orderId: oid,
    orderNo,
    proofPath: bossUrl.split("?")[0],
    results,
    screenshots: fs.readdirSync(ART).filter((f) => f.endsWith(".png")),
  };
  fs.writeFileSync(path.join(ART, "RESULTS.json"), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(ART_REPO, "RESULTS.json"), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(ART, "EVIDENCE.json"), JSON.stringify(summary, null, 2));
  console.log("\n=== SUMMARY ===");
  for (const r of results) console.log(`${r.result}\t${r.step}\t${r.detail}`);
  console.log(`VERDICT=${summary.verdict}`);
  process.exit(summary.verdict === "PASS" ? 0 : 1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
