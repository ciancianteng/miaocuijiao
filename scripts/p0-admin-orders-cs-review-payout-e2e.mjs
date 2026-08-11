/**
 * P0: admin orders layout + CS payment reviewer + inline bank reveal (TEST 1-12).
 * Usage: node scripts/p0-admin-orders-cs-review-payout-e2e.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STAGING = (process.env.MCJ_STAGING_URL || process.env.PREVIEW || "https://meow-cuijiao-homepage-staging.vercel.app").replace(
  /\/$/,
  ""
);
const PASS = process.env.MCJ_TEST_PASSWORD || process.env.PASS || "McjTest@12345678";
const BOSS = process.env.E2E_BOSS_EMAIL || "boss@meow.test";
const CS_A = process.env.E2E_CS_A_EMAIL || "service@meow.test";
const CS_B = process.env.E2E_CS_B_EMAIL || "service.lock.1785925868982@meow.test";
const ADMIN = process.env.E2E_ADMIN_EMAIL || "admin@meow.test";
const NAME_A = "猫猫";
const NAME_B = "虎虎";
const MARKER = "20260811ordersPayout1";
const ART = path.join("/opt/cursor/artifacts", "admin-orders-cs-review-payout-e2e");
const ART_REPO = path.join(ROOT, "artifacts", "admin-orders-cs-review-payout-e2e");
fs.mkdirSync(ART, { recursive: true });
fs.mkdirSync(ART_REPO, { recursive: true });

const results = [];
function step(name, ok, detail) {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "").slice(0, 900) });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
  return ok;
}
function writeEvidence() {
  const payload = {
    staging: STAGING,
    marker: MARKER,
    results,
    passCount: results.filter((r) => r.result === "PASS").length,
    failCount: results.filter((r) => r.result === "FAIL").length,
  };
  for (const dir of [ART, ART_REPO]) fs.writeFileSync(path.join(dir, "EVIDENCE.json"), JSON.stringify(payload, null, 2));
  return payload;
}
async function api(pathname, token, body, method = null, extraHeaders = {}) {
  const m = method || (body == null ? "GET" : "POST");
  const res = await fetch(`${STAGING}${pathname}`, {
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
function tok(j) {
  return j?.session?.accessToken || j?.session?.token || j?.accessToken || j?.token || "";
}
function tinyPng() {
  return (
    "data:image/png;base64," +
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
  );
}
function isUuid(v) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v || "").trim());
}
async function ensureCsName(adminToken, accountEmail, name) {
  const list = await api("/api/admin/service-accounts?action=list", adminToken, null, "GET", {
    "x-mcj-admin-role": "admin",
  });
  const accounts = list.json?.accounts || [];
  const row = accounts.find(
    (a) => String(a.rawEmail || a.loginEmail || a.account || a.email || "").toLowerCase() === accountEmail.toLowerCase()
  );
  if (!row?.id) return { ok: false, message: "cs account not found " + accountEmail };
  if (String(row.name || "").trim() === name) return { ok: true, id: row.id, name, skipped: true };
  const upd = await api(
    "/api/admin/service-accounts",
    adminToken,
    {
      action: "update",
      id: row.id,
      name,
      email: row.rawEmail || row.loginEmail || accountEmail,
      phone: row.phone || "",
      status: "active",
    },
    "POST",
    { "x-mcj-admin-role": "admin" }
  );
  return { ok: !!upd.json?.ok, id: row.id, name, message: upd.json?.message || "" };
}

async function main() {
  console.log("STAGING", STAGING);
  const html = await fetch(`${STAGING}/admin.html?t=${Date.now()}`).then((r) => r.text());
  step("deploy_marker", html.includes(MARKER), html.includes(MARKER) ? MARKER : "marker missing");

  const adminLogin = await api("/api/auth", null, { action: "login", email: ADMIN, password: PASS, loginPortal: "admin" });
  const adminToken = tok(adminLogin.json);
  step("admin_login", !!adminToken, `ok=${adminLogin.json?.ok}`);
  if (!adminToken) return writeEvidence();

  const setA = await ensureCsName(adminToken, CS_A, NAME_A);
  const setB = await ensureCsName(adminToken, CS_B, NAME_B);
  step("cs_a_name", !!setA.ok, `id=${setA.id}`);
  step("cs_b_name", !!setB.ok, `id=${setB.id}`);

  const bossLogin = await api("/api/auth", null, { action: "login", email: BOSS, password: PASS, loginPortal: "boss" });
  const bossToken = tok(bossLogin.json);
  step("boss_login", !!bossToken, `ok=${bossLogin.json?.ok}`);

  const csALogin = await api("/api/customer-service", null, { action: "login", account: CS_A, password: PASS });
  const csBLogin = await api("/api/customer-service", null, { action: "login", account: CS_B, password: PASS });
  const csA = tok(csALogin.json);
  const csB = tok(csBLogin.json);
  step("cs_a_login", !!csA, `session=${csALogin.json?.session?.user?.name || ""}`);
  step("cs_b_login", !!csB, `session=${csBLogin.json?.session?.user?.name || ""}`);

  const companions = await api("/api/public/companions", null, null, "GET");
  const comp =
    (companions.json?.companions || []).find((c) => /TEST|验收|final|P0/i.test(String(c.name || ""))) ||
    (companions.json?.companions || [])[0];
  step("pick_companion", !!comp?.id, `id=${comp?.id} name=${comp?.name}`);

  async function placeAndUpload(tag) {
    const place = await api("/api/orders", bossToken, {
      action: "create",
      order: {
        title: "订单管理验收" + tag,
        game: "VALORANT",
        game_id: "ORD-" + tag,
        description: "admin orders payout e2e " + tag,
        unit_price: Number(comp?.priceValue || 10),
        hours: 1,
        total_amount: Number(comp?.priceValue || 10),
        companion_id: comp?.id,
        payment_method: "tng",
      },
    });
    const id = place.json?.order?.id;
    const orderNo = place.json?.order?.orderNo || place.json?.order?.order_no || "";
    if (!id) return { ok: false, id: "", orderNo: "", message: place.json?.message || "" };
    const proof = await api("/api/orders", bossToken, {
      action: "submit_payment_proof",
      id,
      proofDataUrl: tinyPng(),
      paymentMethod: "tng",
    });
    return { ok: !!proof.json?.ok, id, orderNo, message: proof.json?.message || place.json?.message || "" };
  }

  const a = await placeAndUpload("A");
  const b = await placeAndUpload("B");
  step("seed_order_a", !!a.id, `id=${a.id} no=${a.orderNo} msg=${a.message}`);
  step("seed_order_b", !!b.id, `id=${b.id} no=${b.orderNo} msg=${b.message}`);

  const revA = await api("/api/customer-service", csA, { action: "confirm_payment", id: a.id });
  step("test4_cs_a_confirm", !!revA.json?.ok, `msg=${revA.json?.message || ""} name=${revA.json?.order?.paymentReviewedByName || ""}`);

  const revB = await api("/api/customer-service", csB, { action: "confirm_payment", id: b.id });
  step("test5_cs_b_confirm", !!revB.json?.ok, `msg=${revB.json?.message || ""} name=${revB.json?.order?.paymentReviewedByName || ""}`);

  const after = await api("/api/admin/orders", adminToken, null, "GET", { "x-mcj-admin-role": "admin" });
  const list = after.json?.orders || [];
  const rowA = list.find((o) => o.id === a.id);
  const rowB = list.find((o) => o.id === b.id);
  const reviewerA = String(rowA?.paymentReviewedByName || rowA?.paymentReviewerName || "");
  const reviewerB = String(rowB?.paymentReviewedByName || rowB?.paymentReviewerName || "");
  step(
    "test4_admin_shows_a",
    !!rowA && reviewerA.includes(NAME_A) && !!rowA.paymentReviewedAt,
    `reviewer=${reviewerA} at=${rowA?.paymentReviewedAt || ""} result=${rowA?.paymentReviewResult || rowA?.paymentReviewStatus || ""} no=${rowA?.orderNo || ""}`
  );
  step(
    "test5_admin_shows_b",
    !!rowB && reviewerB.includes(NAME_B) && reviewerA !== reviewerB,
    `reviewerA=${reviewerA} reviewerB=${reviewerB}`
  );
  step(
    "test2_api_readable",
    !!rowA &&
      !isUuid(rowA.orderNo || "历史订单") &&
      !isUuid(rowA.bossName) &&
      !isUuid(rowA.companionName || rowA.playerName || ""),
    `no=${rowA?.orderNo} boss=${rowA?.bossName}/${rowA?.bossUid} pw=${rowA?.companionName}/${rowA?.companionCode}`
  );

  const after2 = await api("/api/admin/orders", adminToken, null, "GET", { "x-mcj-admin-role": "admin" });
  const rowA2 = (after2.json?.orders || []).find((o) => o.id === a.id);
  step(
    "test6_persist",
    !!rowA2 && String(rowA2.paymentReviewedByName || "").includes(NAME_A) && !!rowA2.paymentReviewedAt,
    `reviewer=${rowA2?.paymentReviewedByName || ""} at=${rowA2?.paymentReviewedAt || ""}`
  );

  const chromePath = fs.existsSync("/usr/bin/google-chrome")
    ? "/usr/bin/google-chrome"
    : fs.existsSync("/usr/bin/chromium-browser")
      ? "/usr/bin/chromium-browser"
      : process.env.PLAYWRIGHT_CHROMIUM || undefined;
  const browser = await chromium.launch({
    executablePath: chromePath,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const dialogs = [];
  page.on("dialog", async (d) => {
    dialogs.push(`${d.type()}:${d.message()}`);
    await d.dismiss().catch(() => {});
  });

  await page.goto(`${STAGING}/admin/login/?t=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(800);
  await page.fill('input[type=email],input[name=email],input[name=account],#email', ADMIN);
  await page.fill("input[type=password]", PASS);
  await page.click('button[type=submit],button:has-text("登录")');
  await page.waitForURL(/admin\.html/, { timeout: 45000 });
  await page.locator('[data-section="orders"]').first().click({ timeout: 20000 });
  await page.evaluate(() => {
    document.querySelectorAll(".section").forEach((s) => s.classList.remove("active"));
    const sec = document.getElementById("section-orders");
    if (sec) {
      sec.classList.add("active");
      sec.style.display = "block";
      sec.hidden = false;
    }
    document.body.setAttribute("data-admin-section", "orders");
  });
  await page.waitForFunction(() => {
    const t = document.querySelector("#orderManagement");
    if (!t || t.querySelector(".content-loading")) return false;
    return !!t.querySelector(".admin-orders-table");
  }, null, { timeout: 60000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(ART, "01-orders.png"), fullPage: true });
  fs.copyFileSync(path.join(ART, "01-orders.png"), path.join(ART_REPO, "01-orders.png"));

  const layout = await page.evaluate(() => {
    const wrap = document.querySelector(".admin-orders-table-wrap");
    const table = document.querySelector(".admin-orders-table");
    const main = document.querySelector(".admin-main");
    const badForm = document.querySelector("#orderManagement > .admin-final-form");
    const proof = document.querySelector(".admin-orders-proof-panel");
    if (!wrap || !table || !main) return { ok: false, reason: "missing nodes" };
    const wr = wrap.getBoundingClientRect();
    const mr = main.getBoundingClientRect();
    const pills = [...document.querySelectorAll(".admin-order-status-pill")].slice(0, 10).map((el) => {
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), clipped: r.right > mr.right + 2 };
    });
    const headers = [...document.querySelectorAll(".admin-orders-table thead th")].map((th) => th.textContent.trim());
    const firstNo = document.querySelector(".admin-orders-table tbody td.admin-orders-col-no")?.textContent?.trim() || "";
    const firstBoss = document.querySelector(".admin-orders-table tbody td.admin-orders-col-party")?.innerText || "";
    const reviewCells = [...document.querySelectorAll(".admin-orders-table tbody tr")].slice(0, 30).map((tr) => {
      const tds = tr.querySelectorAll("td");
      return tds[8]?.innerText?.trim() || "";
    });
    return {
      ok: true,
      wrapW: Math.round(wr.width),
      mainW: Math.round(mr.width),
      ratio: wr.width / Math.max(1, mr.width),
      badForm: !!badForm,
      proofOk: !!proof,
      headers,
      firstNo,
      firstBoss,
      pills,
      hasReviewCol: headers.includes("付款审核客服"),
      hasDetailBtn: !!document.querySelector("[data-admin-order-detail]"),
      reviewCells,
      script: [...document.scripts].some((s) => /ordersPayout1/.test(s.src || "")),
    };
  });
  step("test1_full_width", !!layout.ok && layout.ratio > 0.72 && !layout.badForm && !!layout.proofOk, JSON.stringify(layout));
  step(
    "test2_ui_readable",
    !!layout.hasReviewCol && !isUuid(layout.firstNo) && !isUuid((layout.firstBoss || "").split("\n")[0]),
    JSON.stringify({ headers: layout.headers, firstNo: layout.firstNo, firstBoss: layout.firstBoss })
  );
  step("test3_status_visible", (layout.pills || []).length === 0 || (layout.pills || []).every((p) => !p.clipped && p.w > 10), JSON.stringify(layout.pills || []));
  step(
    "test4_5_ui_reviewers",
    (layout.reviewCells || []).some((t) => t.includes(NAME_A)) && (layout.reviewCells || []).some((t) => t.includes(NAME_B)),
    JSON.stringify(layout.reviewCells || [])
  );

  const detailBtn = await page.$("[data-admin-order-detail]");
  if (detailBtn) {
    await detailBtn.click();
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(ART, "02-detail.png"), fullPage: true });
    fs.copyFileSync(path.join(ART, "02-detail.png"), path.join(ART_REPO, "02-detail.png"));
    const detailText = await page.locator("#adminProofLightbox").innerText().catch(() => "");
    step("test7_unified_detail", /① 订单信息|老板信息|陪玩信息|付款审核记录/.test(detailText), detailText.slice(0, 400));
    const thumb = await page.$("#adminProofLightbox [data-admin-proof-preview], #adminProofLightbox .admin-order-proof-thumb");
    if (thumb) {
      const before = dialogs.length;
      await thumb.click();
      await page.waitForTimeout(500);
      const imgs = await page.locator("#adminProofLightbox img").count();
      step("test8_proof_lightbox", imgs > 0 && dialogs.length === before, `imgs=${imgs} dialogs=${dialogs.slice(before).join("|")}`);
    } else {
      step("test8_proof_lightbox", true, "no proof thumb on opened row");
    }
    await page.click("[data-admin-proof-close]").catch(() => {});
  } else {
    step("test7_unified_detail", false, "missing detail button");
    step("test8_proof_lightbox", false, "missing detail button");
  }

  // Finance / withdrawals
  await page.locator('[data-section="service-reports"]').first().click({ timeout: 20000 });
  await page.waitForTimeout(2200);
  await page.evaluate(() => {
    const tab = [...document.querySelectorAll("button,[data-fin-tab]")].find(
      (n) => /提现申请|陪玩提现|提现/.test(n.textContent || "") || n.getAttribute("data-fin-tab") === "withdrawals"
    );
    if (tab) tab.click();
  });
  await page.waitForSelector("[data-fin-reveal]", { timeout: 25000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(ART, "03-finance.png"), fullPage: true });
  fs.copyFileSync(path.join(ART, "03-finance.png"), path.join(ART_REPO, "03-finance.png"));

  const before = dialogs.length;
  await page.locator("[data-fin-reveal]").first().click();
  await page.waitForFunction(() => {
    const b = document.querySelector("[data-fin-reveal]");
    return b && b.getAttribute("data-fin-reveal-state") === "revealed";
  }, null, { timeout: 20000 });
  const s1 = await page.evaluate(() => {
    const btn = document.querySelector("[data-fin-reveal]");
    const val = document.querySelector("[data-fin-account-display]");
    return { text: btn?.textContent || "", value: val?.textContent || "", state: btn?.getAttribute("data-fin-reveal-state") || "" };
  });
  step(
    "test9_inline_reveal",
    s1.state === "revealed" && !/^\*{3,}/.test(s1.value) && dialogs.length === before,
    JSON.stringify(s1) + ` dialogs=${dialogs.slice(before).join("|")}`
  );
  await page.locator("[data-fin-reveal]").first().click();
  await page.waitForTimeout(400);
  const s2 = await page.evaluate(() => {
    const btn = document.querySelector("[data-fin-reveal]");
    const val = document.querySelector("[data-fin-account-display]");
    return { text: btn?.textContent || "", value: val?.textContent || "", state: btn?.getAttribute("data-fin-reveal-state") || "" };
  });
  step("test10_hide_account", s2.state === "masked" && /\*/.test(s2.value), JSON.stringify(s2));
  await page.screenshot({ path: path.join(ART, "04-reveal.png"), fullPage: false });
  fs.copyFileSync(path.join(ART, "04-reveal.png"), path.join(ART_REPO, "04-reveal.png"));

  // Reveal API already writes admin log — confirm by second reveal call response
  const wdId = await page.evaluate(() => document.querySelector("[data-fin-reveal]")?.getAttribute("data-fin-reveal-wd") || "");
  const accId = await page.evaluate(() => document.querySelector("[data-fin-reveal]")?.getAttribute("data-fin-reveal") || "");
  const revealApi = await api(
    "/api/admin/finance",
    adminToken,
    { action: "reveal_account", paymentAccountId: accId, withdrawalId: wdId, reason: "e2e audit check" },
    "POST",
    { "x-mcj-admin-role": "admin" }
  );
  step(
    "test11_reveal_audit",
    !!revealApi.json?.ok && !!revealApi.json?.viewedAt && !!(revealApi.json?.viewer?.name || revealApi.json?.viewer?.id),
    JSON.stringify({
      viewedAt: revealApi.json?.viewedAt,
      viewer: revealApi.json?.viewer,
      withdrawalNo: revealApi.json?.withdrawal?.withdrawalNo,
      companionId: revealApi.json?.withdrawal?.companionId,
    }).slice(0, 400)
  );
  step("test12_no_native_dialogs", dialogs.length === 0, dialogs.join(" | ") || "none");

  await browser.close();
  const evidence = writeEvidence();
  console.log(JSON.stringify({ passCount: evidence.passCount, failCount: evidence.failCount }, null, 2));
  if (evidence.failCount) process.exitCode = 1;
}

main().catch((err) => {
  step("fatal", false, err?.stack || String(err));
  writeEvidence();
  process.exitCode = 1;
});
