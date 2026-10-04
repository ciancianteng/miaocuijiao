#!/usr/bin/env node
/**
 * Staging-only E2E: gameplay product order with designated companion + no-taker refund rules.
 *
 *   node scripts/e2e-gameplay-designated-refund-staging.mjs --phase=start
 *   node scripts/e2e-gameplay-designated-refund-staging.mjs --phase=watch
 *
 * A  designated + catfood → companion accepts (UI) → in_progress on all four portals
 * B  designated + catfood → companion rejects → public hall → 30 min no taker → refunded (hold released)
 * C  designated + DuitNow (proof + CS confirm) → companion silent 30 min → hall → 30 min → refunded to 猫粮余额
 *
 * Real-time waits only (no DB backdating). Orders are tagged [E2E-GP-DESIGNATE].
 *
 * Background-trigger verification (no page/session reads drive the timeouts):
 *   --phase=cron-start   D1 designated+catfood left unconfirmed, D2 designated+catfood rejected → hall
 *   --phase=cron-watch   only GET /api/cron/gameplay-no-taker (3 concurrent calls per minute)
 *   --phase=cron-verify  four-end state, wallet, exactly-once transition counts, screenshots
 *   --phase=cleanup      cancel leftover E2E orders, delete E2E product (--reverse-duitnow, --apply)
 *
 * Database-scheduler verification (needs Staging DB credentials; nothing in this script calls the endpoint):
 *   --phase=pgcron-start   pg_cron job + secret enforced; P1 left unconfirmed, P2 rejected → hall
 *   --phase=pgcron-watch   reads the DB only; extra concurrent ticks fired from SQL around each due time
 *   --phase=pgcron-verify  exactly-once status logs / hold release / wallet rows, pg_net responses, four-end
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { assertSmokeTargetAllowed } from "./lib/prod-guard.mjs";

/** Default: fixed Staging alias. --base=<immutable staging deployment> when the shared alias is being re-pointed. */
const STG = (process.argv.find((a) => a.startsWith("--base="))?.slice(7) || "https://meow-cuijiao-homepage-staging.vercel.app").replace(/\/$/, "");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const TAG = "[E2E-GP-DESIGNATE]";
const PASS = "McjTest@12345678";
const COMP_EMAIL = "e2e275.comp.1789912233591@example.com";
const COMP_PASS = "E2eInvite275!1789912233591";
const PRODUCT_NAME = "王者荣耀上分护航（E2E指定陪玩）";
const TIMEOUT_MIN = 30;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "artifacts/gameplay-designated-refund");
const shotDir = path.join(outDir, "screenshots");
const phaseArg = (process.argv.find((a) => a.startsWith("--phase=")) || "--phase=start").slice(8);
const cronMode = phaseArg.startsWith("cron-") || phaseArg === "cleanup";
const pgcronMode = phaseArg.startsWith("pgcron-");
const suffix = pgcronMode ? "-pgcron" : cronMode ? "-cron" : "";
const statePath = path.join(outDir, `state${suffix}.json`);
const reportPath = path.join(outDir, `report${suffix}.json`);
fs.mkdirSync(shotDir, { recursive: true });

const phase = phaseArg;
const freshPhase = phase === "start" || phase === "cron-start" || phase === "pgcron-start";

assertSmokeTargetAllowed({ script: "e2e-gameplay-designated-refund-staging", base: STG });
const publicCfg = await (await fetch(`${STG}/api/public/realtime-config`, { cache: "no-store" })).json();
assertSmokeTargetAllowed({
  script: "e2e-gameplay-designated-refund-staging",
  base: STG,
  supabaseUrl: String(publicCfg.url || ""),
  requireStagingSupabase: true,
});

const state = fs.existsSync(statePath) && !freshPhase ? JSON.parse(fs.readFileSync(statePath, "utf8")) : { orders: {} };
const report = fs.existsSync(reportPath) && !freshPhase ? JSON.parse(fs.readFileSync(reportPath, "utf8")) : { staging: STG, steps: [] };
function save() {
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  report.updated_at = new Date().toISOString();
  report.summary = {
    PASS: report.steps.filter((s) => s.result === "PASS").length,
    FAIL: report.steps.filter((s) => s.result === "FAIL").length,
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
}
function step(id, ok, evidence, extra = {}) {
  const result = ok ? "PASS" : "FAIL";
  report.steps.push({ id, result, at: new Date().toISOString(), evidence: String(evidence).slice(0, 800), ...extra });
  console.log(`[${result}] ${id} :: ${evidence}`);
  save();
  return ok;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const money = (v) => Math.round(Number(v || 0) * 100) / 100;

async function api(pathname, token, body, method, extra = {}) {
  const m = method || (body == null ? "GET" : "POST");
  const res = await fetch(`${STG}${pathname}`, {
    method: m,
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}`, "x-mcj-access-token": token } : {}),
      ...(body != null ? { "Content-Type": "application/json" } : {}),
      ...extra,
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}
async function login(email, password, role) {
  const r = await api("/api/auth", null, { action: "login", email, password, role });
  const s = r.json?.session || {};
  if (!s.accessToken) throw new Error(`login ${role} ${email}: ${r.status} ${r.json?.message || ""}`);
  return { token: s.accessToken, refresh: s.refreshToken || "", expiresAt: s.expiresAt || "", user: s.user || r.json?.user || {}, id: (s.user || r.json?.user || {}).id };
}
async function loginCs() {
  const r = await api("/api/customer-service", null, { action: "login", account: "service@meow.test", password: PASS });
  const s = r.json?.session || {};
  const token = s.token || s.accessToken;
  if (!token) throw new Error(`CS login: ${r.status} ${r.json?.message || ""}`);
  return { token, session: s };
}
async function actors() {
  const [boss, comp, admin, cs] = await Promise.all([
    login("boss@meow.test", PASS, "boss"),
    login(COMP_EMAIL, COMP_PASS, "companion"),
    login("admin@meow.test", PASS, "admin"),
    loginCs(),
  ]);
  return { boss, comp, admin, cs };
}
const adminHeaders = { "x-mcj-admin-role": "admin" };

/** Order objects carry the order id in `id`; conversations reference it via `orderId` and must not win. */
function deepFind(node, id, key = "id", seen = new Set()) {
  if (!node || typeof node !== "object" || seen.has(node)) return null;
  seen.add(node);
  if (!Array.isArray(node) && String(node[key] || "") === id && (node.status || node.statusKey || node.rawStatus)) return node;
  for (const v of Array.isArray(node) ? node : Object.values(node)) {
    const hit = deepFind(v, id, key, seen);
    if (hit) return hit;
  }
  return null;
}
const pickStatus = (o) => (o ? String(o.rawStatus || o.status_raw || o.status || o.statusKey || "") : "absent");
const pickCompanion = (o) => (o ? String(o.companionId || o.companion_id || o.playerId || "") : "");

async function wallet(t) {
  const r = await api("/api/recharge", t.boss.token);
  return r.json?.wallet || {};
}
async function bossOrder(t, id) {
  const r = await api(`/api/orders?id=${encodeURIComponent(id)}`, t.boss.token);
  return (r.json?.orders || []).find((o) => String(o.id) === id) || deepFind(r.json, id);
}
/** The scheduler's only entry point: unauthenticated-by-session cron tick, no page or order reads. */
async function cronTick(secret = process.env.GAMEPLAY_CRON_SECRET || "") {
  const r = await api("/api/cron/gameplay-no-taker", null, null, "GET", secret ? { "x-cron-secret": secret } : {});
  return { at: new Date().toISOString(), status: r.status, ok: r.json?.ok === true, actions: r.json?.actions || [], error: r.json?.error };
}
async function fourEnd(t, id) {
  const [b, c, s, a] = await Promise.all([
    bossOrder(t, id),
    api("/api/companion?action=bootstrap", t.comp.token).then((r) => deepFind(r.json, id)),
    api("/api/customer-service", t.cs.token).then((r) => deepFind(r.json, id)),
    api(`/api/admin/orders?id=${encodeURIComponent(id)}`, t.admin.token, null, "GET", adminHeaders).then((r) => deepFind(r.json, id)),
  ]);
  return {
    boss: pickStatus(b),
    companion: pickStatus(c),
    cs: pickStatus(s),
    admin: pickStatus(a),
    companionId: { boss: pickCompanion(b), admin: pickCompanion(a) },
    bossOrder: b,
  };
}
const fourEndText = (f) => `boss=${f.boss} companion=${f.companion} cs=${f.cs} admin=${f.admin}`;

async function ensureProduct(t) {
  const list = await api("/api/platform/gameplay-products");
  let product = (list.json?.products || []).find((p) => p.name === PRODUCT_NAME);
  if (!product) {
    const saved = await api(
      "/api/admin/gameplay-products",
      t.admin.token,
      {
        action: "save",
        product: {
          name: PRODUCT_NAME,
          shortDescription: `${TAG} Staging 指定陪玩 / 无人接单退款验证`,
          description: `${TAG} Staging 临时商品，验证完成后下架`,
          category: "其他",
          gameIds: ["王者荣耀"],
          gamesText: "王者荣耀",
          price: 30,
          pricingUnit: "每单",
          packages: [{ id: "e2e-gp-std", name: "标准护航", price: 30, unit: "每单" }],
          commissionRate: 20,
          status: "published",
        },
      },
      "POST",
      adminHeaders
    );
    if (saved.status >= 300 || saved.json?.ok === false) throw new Error(`seed product: ${saved.status} ${saved.json?.message}`);
    state.seededProductId = saved.json?.product?.id || "";
    const again = await api("/api/platform/gameplay-products");
    product = (again.json?.products || []).find((p) => p.name === PRODUCT_NAME);
  }
  if (!product) throw new Error("product not orderable on Staging");
  return product;
}

function productOrderBody(product, companion, paymentMethod, label) {
  const pkg = product.packages[0];
  const start = new Date(Date.now() + 3600 * 1000).toISOString().slice(0, 16);
  const gameId = `E2E-GP-${label}-${Date.now() % 100000}`;
  return {
    action: "create",
    order: {
      order_type: "gameplay_product",
      title: product.name,
      game: product.gamesText,
      serviceType: pkg.name,
      service_type: pkg.name,
      description: [
        `更多玩法商品：${product.name}`,
        `商品ID：${product.id}`,
        `套餐：${pkg.name}`,
        `分类：${product.category || ""}`,
        `游戏：${product.gamesText}`,
        `游戏ID：${gameId}`,
        `数量：1 × ${pkg.unit || "每单"}`,
        `开始时间：${start}`,
        `备注：${TAG} 场景${label}`,
      ].join("\n"),
      notes: `${TAG} 场景${label}`,
      gameId,
      game_id: gameId,
      hours: 1,
      quantity: 1,
      unit_price: Number(pkg.price),
      unitPrice: Number(pkg.price),
      total_amount: Number(pkg.price),
      totalAmount: Number(pkg.price),
      pricingUnit: pkg.unit || "每单",
      gameplay_product_id: product.id,
      productId: product.id,
      packageId: pkg.id,
      packageName: pkg.name,
      discountAmount: 0,
      paymentMethod,
      startTime: start,
      companionId: companion.id,
      companionName: companion.name,
    },
  };
}

// ——— browser helpers ———
let browser;
async function openBrowser() {
  browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
}
async function shot(page, name, fullPage = true) {
  await page.screenshot({ path: path.join(shotDir, `${name}.png`), fullPage });
  console.log(`  screenshot ${name}.png`);
  return `screenshots/${name}.png`;
}
async function bossPage(t, viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript(({ token, user }) => {
    localStorage.setItem("mcjAuthAccessToken", token);
    sessionStorage.setItem("mcjAuthAccessToken", token);
    localStorage.setItem("customerUser", JSON.stringify(Object.assign({}, user, { role: "boss" })));
    localStorage.setItem("mcjRole", "boss");
  }, { token: t.boss.token, user: t.boss.user });
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept().catch(() => {}));
  return page;
}
async function companionPage(t) {
  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 } });
  await ctx.addInitScript(({ token, refresh, expiresAt, user }) => {
    const u = Object.assign({ role: "companion" }, user);
    const session = { token, accessToken: token, refreshToken: refresh, expiresAt, user: u, remember: true, portal: "companion", portalLoginAt: Date.now() };
    for (const s of [localStorage, sessionStorage]) {
      s.setItem("mcjCompanionSession", JSON.stringify(session));
      s.setItem("companionAuthToken", "companion_session_v4_" + Date.now());
      s.setItem("companionUser", JSON.stringify(u));
    }
  }, { token: t.comp.token, refresh: t.comp.refresh, expiresAt: t.comp.expiresAt, user: t.comp.user });
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept().catch(() => {}));
  return page;
}
async function csPage(t) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(({ session }) => {
    const user = Object.assign({ role: "customer_service", roles: ["customer_service"] }, session.user || {});
    const s2 = Object.assign({}, session, { token: session.token || session.accessToken, accessToken: session.accessToken || session.token, user, remember: true, portal: "customer_service" });
    for (const s of [localStorage, sessionStorage]) {
      s.setItem("mcjServiceSession", JSON.stringify(s2));
      s.setItem("customerServiceAuthToken", "customer_service_session_v4_" + Date.now());
      s.setItem("customerServiceUser", JSON.stringify(user));
    }
  }, { session: t.cs.session });
  return ctx.newPage();
}
async function adminPage(t) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(({ token, refresh, expiresAt }) => {
    const user = { email: "admin@meow.test", account: "admin@meow.test", role: "admin", adminRole: "admin", roles: ["admin"], permissions: ["admin"], name: "管理员", status: "active" };
    const kv = [
      ["adminAuthToken", "admin_session_v4_" + Date.now()],
      ["adminUser", JSON.stringify(user)],
      ["mcjRole", "admin"],
      ["mcjAdminAccessToken", token],
      ["mcjAdminRefreshToken", refresh],
      ["mcjAdminExpiresAt", String(expiresAt || "")],
      ["mcjAuthAccessToken", token],
      ["mcjAuthRefreshToken", refresh],
      ["mcjAuthExpiresAt", String(expiresAt || "")],
    ];
    for (const [k, v] of kv) {
      if (!v) continue;
      localStorage.setItem(k, v);
      sessionStorage.setItem(k, v);
    }
  }, { token: t.admin.token, refresh: t.admin.refresh, expiresAt: t.admin.expiresAt });
  return ctx.newPage();
}
async function highlightText(page, text) {
  await page
    .evaluate((needle) => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = walker.nextNode())) {
        if (n.nodeValue && n.nodeValue.includes(needle)) {
          const el = n.parentElement;
          el.scrollIntoView({ block: "center" });
          el.style.outline = "3px solid #ff3b30";
          return true;
        }
      }
      return false;
    }, text)
    .catch(() => false);
}
async function bossOrderShot(t, id, orderNo, name) {
  const page = await bossPage(t);
  await page.goto(`${STG}/orders.html?id=${encodeURIComponent(id)}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(4500);
  if (orderNo) await highlightText(page, orderNo);
  const file = await shot(page, name, false);
  const text = await page.locator("body").innerText().catch(() => "");
  await page.context().close();
  return { file, text };
}
async function csShot(t, orderNo, name) {
  const page = await csPage(t);
  await page.goto(`${STG}/customer-service/orders/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(6000);
  const search = page.locator('input[type="search"], input[placeholder*="搜索"], input[placeholder*="订单"]').first();
  if (orderNo && (await search.count())) {
    await search.fill(orderNo).catch(() => {});
    await search.press("Enter").catch(() => {});
    await page.waitForTimeout(2000);
  }
  if (orderNo) await highlightText(page, orderNo);
  const file = await shot(page, name, false);
  await page.context().close();
  return file;
}
async function adminShot(t, orderNo, name) {
  const page = await adminPage(t);
  await page.goto(`${STG}/admin.html#orders`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(5000);
  const search = page.locator('input[type="search"], input[placeholder*="搜索"], input[placeholder*="订单"]').first();
  if (orderNo && (await search.count())) {
    await search.fill(orderNo).catch(() => {});
    await search.press("Enter").catch(() => {});
    await page.waitForTimeout(2500);
  }
  if (orderNo) await highlightText(page, orderNo);
  const file = await shot(page, name, false);
  await page.context().close();
  return file;
}
async function companionShot(t, route, orderNo, name) {
  const cp = await companionPage(t);
  await cp.goto(`${STG}${route}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await cp.waitForTimeout(6000);
  if (orderNo) await highlightText(cp, orderNo);
  const file = await shot(cp, name, false);
  await cp.context().close();
  return file;
}

/** The fixed alias is shared; make sure it still serves this branch's build. */
async function deployedHasFix() {
  const r = await fetch(`${STG}/src/gameplay-product.js?probe=${Date.now()}`, { cache: "no-store" });
  return (await r.text()).includes("data-gp-companion");
}

// ——— phase: start ———
async function startPhase() {
  report.started_at = new Date().toISOString();
  if (!(await deployedHasFix())) throw new Error("Staging alias does not serve this branch's build — run deploy-staging.mjs first");
  const t = await actors();
  state.actors = { bossId: t.boss.id, companionId: t.comp.id };
  const online = await api("/api/companion", t.comp.token, { action: "set_online_status", online_status: "online" });
  const pub = await api(`/api/public/companions?id=${t.comp.id}`);
  const pubC = pub.json?.companions?.[0] || {};
  step("00_companion_orderable", online.status < 300 && pubC.canAcceptBossOrder === true, `online=${online.status} canAccept=${pubC.canAcceptBossOrder} name=${pubC.name}`);
  const companion = { id: t.comp.id, name: pubC.name || pubC.nickname || "CompA" };

  const product = await ensureProduct(t);
  state.product = { id: product.id, name: product.name, price: product.packages[0].price };
  step("01_product_published", !!product.id, `product=${product.id} ${product.name} price=${product.packages[0].price}`);
  state.wallet0 = await wallet(t);
  save();

  // ── C: designated + DuitNow → proof → CS confirm → claimed ──
  {
    const r = await api("/api/orders", t.boss.token, productOrderBody(product, companion, "duitnow", "C"));
    const o = r.json?.order || {};
    state.orders.C = { id: o.id, orderNo: o.orderNo || o.order_no, amount: money(o.totalAmount) };
    const desc = String(o.description || "");
    step(
      "C1_create_designated_duitnow",
      r.status === 200 && pickCompanion(o) === companion.id && /指定陪玩30分钟内未确认或拒单/.test(desc),
      `http=${r.status} order=${state.orders.C.orderNo} status=${o.status} companion=${pickCompanion(o)} ruleLine=${/接单规则/.test(desc)} ${r.json?.message || ""}`
    );
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const proof = await api("/api/orders", t.boss.token, { action: "submit_payment_proof", id: o.id, paymentMethod: "duitnow", proofDataUrl: png });
    step("C2_submit_duitnow_proof", proof.status < 300 && proof.json?.ok !== false, `http=${proof.status} ${proof.json?.message || ""}`);
    const conf = await api("/api/customer-service", t.cs.token, { action: "confirm_payment", id: o.id });
    const after = await bossOrder(t, o.id);
    state.orders.C.claimedAt = new Date().toISOString();
    step(
      "C3_cs_confirm_payment_claimed",
      conf.status < 300 && pickStatus(after) === "claimed" && pickCompanion(after) === companion.id,
      `http=${conf.status} status=${pickStatus(after)} companion=${pickCompanion(after)} ${conf.json?.message || ""}`
    );
  }

  // ── B: designated + catfood → pay → claimed ──
  {
    const r = await api("/api/orders", t.boss.token, productOrderBody(product, companion, "catfood", "B"));
    const o = r.json?.order || {};
    state.orders.B = { id: o.id, orderNo: o.orderNo || o.order_no, amount: money(o.totalAmount) };
    step("B1_create_designated_catfood", r.status === 200 && pickCompanion(o) === companion.id, `http=${r.status} order=${state.orders.B.orderNo} companion=${pickCompanion(o)} ${r.json?.message || ""}`);
    state.orders.B.walletBeforePay = await wallet(t);
    const pay = await api("/api/orders", t.boss.token, { action: "pay_order", id: o.id, paymentMethod: "catfood" });
    state.orders.B.walletAfterPay = await wallet(t);
    const after = await bossOrder(t, o.id);
    step(
      "B2_pay_catfood_claimed_hold",
      pay.status < 300 && pickStatus(after) === "claimed" &&
        money(state.orders.B.walletAfterPay.heldBalance) - money(state.orders.B.walletBeforePay.heldBalance) === state.orders.B.amount,
      `http=${pay.status} status=${pickStatus(after)} held ${state.orders.B.walletBeforePay.heldBalance}→${state.orders.B.walletAfterPay.heldBalance} ${pay.json?.message || ""}`
    );
  }
  save();

  // ── A: browser UI — product page → pick companion → catfood → payment-confirm → pay ──
  await openBrowser();
  try {
    const page = await bossPage(t, { width: 1280, height: 1000 });
    await page.goto(`${STG}/gameplay-product.html?id=${encodeURIComponent(product.id)}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector("[data-gp-companion]", { timeout: 30000 });
    await page.waitForFunction(() => document.querySelectorAll("[data-gp-companion] option").length > 1, null, { timeout: 30000 });
    await page.waitForTimeout(800);
    const options = await page.locator("[data-gp-companion] option").allInnerTexts();
    await shot(page, "A1-product-page-companion-picker-default");
    await page.selectOption("[data-gp-companion]", companion.id);
    await page.waitForTimeout(600);
    await page.fill("#gpGameId", `E2E-GP-A-${Date.now() % 100000}`);
    await page.fill('textarea[name="remark"]', `${TAG} 场景A UI 下单`);
    await page.locator('[data-gp-pay="catfood"]').click().catch(() => {});
    await page.waitForTimeout(500);
    const hint = await page.locator("[data-gp-companion]").locator("xpath=following::small[1]").innerText().catch(() => "");
    await page.locator("[data-gp-companion]").scrollIntoViewIfNeeded();
    await shot(page, "A2-product-page-designated-selected");
    step("A1_ui_companion_picker", options.length >= 2 && options.some((x) => x.includes(companion.name)) && /30\s*分钟/.test(hint), `options=${options.join(" | ")} hint=${hint}`, {
      screenshot: ["screenshots/A1-product-page-companion-picker-default.png", "screenshots/A2-product-page-designated-selected.png"],
    });
    await page.locator("[data-gp-submit]").click();
    await page.waitForURL(/payment-confirm\.html\?order=/, { timeout: 30000 });
    const orderId = new URL(page.url()).searchParams.get("order");
    await page.waitForSelector("[data-pay-order]", { timeout: 30000 });
    await page.waitForTimeout(1200);
    await shot(page, "A3-payment-confirm-catfood");
    await page.locator(".pay-btn.primary[data-pay-order], [data-pay-order]").first().click();
    await page.waitForTimeout(5000);
    await shot(page, "A4-after-catfood-pay");
    await page.context().close();
    const a = await bossOrder(t, orderId);
    state.orders.A = { id: orderId, orderNo: a?.orderNo || a?.order_no || "", amount: money(a?.totalAmount) };
    step("A2_ui_order_paid_waiting_companion", pickStatus(a) === "claimed" && pickCompanion(a) === companion.id, `order=${state.orders.A.orderNo} status=${pickStatus(a)} companion=${pickCompanion(a)}`);
    save();

    // Companion portal: designated orders waiting confirm
    const cp = await companionPage(t);
    await cp.goto(`${STG}/companion/orders?filter=waiting_confirm`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await cp.waitForTimeout(6000);
    await highlightText(cp, state.orders.A.orderNo);
    await shot(cp, "A5-companion-waiting-confirm", false);

    // ── B: companion rejects → public hall ──
    const rej = await api("/api/companion", t.comp.token, { action: "reject_direct_order", id: state.orders.B.id, reason: "时间无法配合" });
    state.orders.B.rejectedAt = new Date().toISOString();
    const fB = await fourEnd(t, state.orders.B.id);
    step(
      "B3_reject_to_public_hall",
      rej.status < 300 && fB.boss === "pending" && !fB.companionId.boss && /抢单大厅/.test(String(rej.json?.message || "")),
      `http=${rej.status} msg=${rej.json?.message} ${fourEndText(fB)}`
    );
    const shotB = await bossOrderShot(t, state.orders.B.id, state.orders.B.orderNo, "B1-boss-after-reject-hall");
    step("B4_boss_sees_hall_state", /抢单|待接单|大厅|等待/.test(shotB.text), "boss orders page after reject", { screenshot: shotB.file });

    // ── A: companion accepts via UI ──
    let acceptVia = "ui";
    const btn = cp.locator(`[data-order-action="accept_direct_order"][data-order-id="${state.orders.A.id}"]`);
    if (await btn.count()) {
      await btn.first().scrollIntoViewIfNeeded();
      await btn.first().click();
      await cp.waitForTimeout(5000);
    }
    let aAfter = await bossOrder(t, state.orders.A.id);
    if (pickStatus(aAfter) !== "in_progress") {
      acceptVia = "api";
      const acc = await api("/api/companion", t.comp.token, { action: "accept_direct_order", id: state.orders.A.id });
      console.log(`  UI accept did not land (status=${pickStatus(aAfter)}); API accept http=${acc.status} ${acc.json?.message || ""}`);
      aAfter = await bossOrder(t, state.orders.A.id);
    }
    await cp.goto(`${STG}/companion/orders?filter=running`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await cp.waitForTimeout(5000);
    await highlightText(cp, state.orders.A.orderNo);
    await shot(cp, "A6-companion-running-after-accept", false);
    await cp.context().close();
    const fA = await fourEnd(t, state.orders.A.id);
    step(
      "A3_companion_accept_in_progress_four_end",
      [fA.boss, fA.cs, fA.admin].every((s) => s === "in_progress") && fA.companion === "in_progress",
      `via=${acceptVia} ${fourEndText(fA)}`
    );
    const shotA = await bossOrderShot(t, state.orders.A.id, state.orders.A.orderNo, "A7-boss-order-in-progress");
    step("A4_boss_sees_in_progress", /进行中|服务中/.test(shotA.text), "boss orders page", { screenshot: shotA.file });
    await csShot(t, state.orders.A.orderNo, "A8-cs-order-in-progress");
    await adminShot(t, state.orders.A.orderNo, "A9-admin-order-in-progress");
    const fC = await fourEnd(t, state.orders.C.id);
    step("C4_waiting_companion_confirm_four_end", [fC.boss, fC.cs, fC.admin].every((s) => s === "claimed"), fourEndText(fC));
  } finally {
    await browser.close();
  }
  state.startedAt = report.started_at;
  save();
  console.log(`\nSTART DONE. B rejected at ${state.orders.B.rejectedAt}, C claimed at ${state.orders.C.claimedAt}. Run --phase=watch.`);
}

// ——— phase: watch ———
async function watchPhase() {
  const deadline = Date.now() + 80 * 60 * 1000;
  const B = state.orders.B;
  const C = state.orders.C;
  let t = await actors();
  let tokenAt = Date.now();
  let lastWallet = await wallet(t);
  await openBrowser();
  try {
    while (Date.now() < deadline) {
      if (Date.now() - tokenAt > 25 * 60 * 1000) {
        t = await actors();
        tokenAt = Date.now();
      }
      if (!(await deployedHasFix().catch(() => true))) {
        step("alias_drift", false, "fixed Staging alias no longer serves this branch's build");
      }
      await cronTick().catch(() => {});
      const [b, c] = await Promise.all([bossOrder(t, B.id), bossOrder(t, C.id)]);
      const w = await wallet(t);
      const sB = pickStatus(b);
      const sC = pickStatus(c);
      const minsB = ((Date.now() - Date.parse(B.rejectedAt)) / 60000).toFixed(1);
      const minsC = ((Date.now() - Date.parse(C.claimedAt)) / 60000).toFixed(1);
      console.log(`${new Date().toISOString()} B=${sB} (+${minsB}m) C=${sC} (+${minsC}m) wallet paid=${w.paidBalance} held=${w.heldBalance}`);

      if (!B.refundedAt && sB === "refunded") {
        B.refundedAt = new Date().toISOString();
        const f = await fourEnd(t, B.id);
        const heldDrop = money(lastWallet.heldBalance) - money(w.heldBalance);
        step(
          "B5_hall_no_taker_auto_refund",
          Number(minsB) >= TIMEOUT_MIN - 0.5 && [f.boss, f.cs, f.admin].every((s) => s === "refunded") && heldDrop === B.amount,
          `after ${minsB}m ${fourEndText(f)} held ${lastWallet.heldBalance}→${w.heldBalance} (release ${heldDrop}, expected ${B.amount})`,
          { walletBefore: lastWallet, walletAfter: w }
        );
        const s = await bossOrderShot(t, B.id, B.orderNo, "B2-boss-order-refunded");
        step("B6_boss_sees_refunded", /已退款|退款/.test(s.text), "boss orders page", { screenshot: s.file });
        await csShot(t, B.orderNo, "B3-cs-order-refunded");
        await adminShot(t, B.orderNo, "B4-admin-order-refunded");
      } else if (!B.refundedAt && sB !== "pending") {
        step("B_unexpected_status", false, `B=${sB} after ${minsB}m`);
      }

      if (!C.hallAt && sC === "pending") {
        C.hallAt = new Date().toISOString();
        const f = await fourEnd(t, C.id);
        step(
          "C5_companion_timeout_to_hall",
          Number(minsC) >= TIMEOUT_MIN - 0.5 && [f.boss, f.cs, f.admin].every((s) => s === "pending") && !f.companionId.boss,
          `after ${minsC}m ${fourEndText(f)} companion=${f.companionId.boss || "none"}`
        );
        const s = await bossOrderShot(t, C.id, C.orderNo, "C1-boss-after-confirm-timeout-hall");
        step("C6_boss_sees_hall_state", /抢单|待接单|大厅|等待/.test(s.text), "boss orders page", { screenshot: s.file });
        await companionShot(t, "/companion/order-hall", C.orderNo, "C1b-companion-hall-after-timeout");
        await csShot(t, C.orderNo, "C1c-cs-order-hall");
        await adminShot(t, C.orderNo, "C1d-admin-order-hall");
      }
      if (!C.refundedAt && sC === "refunded") {
        C.refundedAt = new Date().toISOString();
        const f = await fourEnd(t, C.id);
        const minsHall = C.hallAt ? ((Date.now() - Date.parse(C.hallAt)) / 60000).toFixed(1) : "?";
        const paidGain = money(w.paidBalance) - money(lastWallet.paidBalance);
        const fin = await api("/api/admin/finance", t.admin.token, null, "GET", adminHeaders);
        const refundRow = (fin.json?.bossRefunds || fin.json?.data?.bossRefunds || []).find(
          (r) => String(r.orderId || r.order_id || "") === C.id || String(r.orderNo || r.order_no || "") === C.orderNo
        );
        step(
          "C7_hall_no_taker_refund_to_catfood",
          [f.boss, f.cs, f.admin].every((s) => s === "refunded") && paidGain === C.amount && (!refundRow || /paid|completed|已/.test(String(refundRow.status))),
          `hall +${minsHall}m ${fourEndText(f)} paid ${lastWallet.paidBalance}→${w.paidBalance} (+${paidGain}, expected ${C.amount}) refundRow=${refundRow ? refundRow.status : "not in finance list"}`,
          { walletBefore: lastWallet, walletAfter: w, refundRow: refundRow || null }
        );
        const s = await bossOrderShot(t, C.id, C.orderNo, "C2-boss-order-refunded");
        step("C8_boss_sees_refunded", /已退款|退款/.test(s.text), "boss orders page", { screenshot: s.file });
        await csShot(t, C.orderNo, "C3-cs-order-refunded");
        await adminShot(t, C.orderNo, "C4-admin-order-refunded");
        const wp = await bossPage(t);
        await wp.goto(`${STG}/recharge.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
        await wp.waitForTimeout(4000);
        await shot(wp, "C5-boss-wallet-after-refunds");
        await wp.context().close();
      }
      lastWallet = w;
      save();
      if (B.refundedAt && C.refundedAt) break;
      await sleep(60 * 1000);
    }
  } finally {
    await browser.close();
  }
  if (!B.refundedAt) step("B5_hall_no_taker_auto_refund", false, "B not refunded before watch deadline");
  if (!C.refundedAt) step("C7_hall_no_taker_refund_to_catfood", false, "C not refunded before watch deadline");
  const fA = await fourEnd(t, state.orders.A.id);
  step("A5_accepted_order_untouched_by_sweep", fA.boss === "in_progress", fourEndText(fA));
  console.log(`\nWATCH DONE ${JSON.stringify(report.summary)}`);
}

// ——— phase: shots (focused current-state evidence, no writes) ———
async function shotsPhase() {
  const t = await actors();
  const { A, B, C } = state.orders;
  await openBrowser();
  try {
    const page = await bossPage(t, { width: 1280, height: 1000 });
    await page.goto(`${STG}/gameplay-product.html?id=${encodeURIComponent(state.product.id)}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => document.querySelectorAll("[data-gp-companion] option").length > 1, null, { timeout: 30000 });
    await page.evaluate(() => {
      const sel = document.querySelector("[data-gp-companion]");
      sel.setAttribute("size", "8");
      sel.style.height = "auto";
      sel.scrollIntoView({ block: "center" });
    });
    await page.waitForTimeout(500);
    await shot(page, "A0-product-companion-picker-options", false);
    await page.context().close();

    await companionShot(t, "/companion/orders?filter=running", A.orderNo, "S-A-companion-running");
    await companionShot(t, "/companion/order-hall", B.orderNo, "S-B-companion-hall");
    await companionShot(t, "/companion/orders?filter=waiting_confirm", C.orderNo, "S-C-companion-waiting-confirm");
    for (const [k, o] of Object.entries({ A, B, C })) {
      await bossOrderShot(t, o.id, o.orderNo, `S-${k}-boss-order`);
      await csShot(t, o.orderNo, `S-${k}-cs-order`);
    }
  } finally {
    await browser.close();
  }
}

// ——— background-trigger verification ———
const minsSince = (iso, at = Date.now()) => (iso ? ((at - Date.parse(iso)) / 60000).toFixed(1) : "?");
const labelOf = (id) => Object.entries(state.orders).find(([, o]) => o.id === id)?.[0] || id;

async function createPaidDesignated(t, product, companion, label) {
  const r = await api("/api/orders", t.boss.token, productOrderBody(product, companion, "catfood", label));
  const o = r.json?.order || {};
  const rec = { id: o.id, orderNo: o.orderNo || o.order_no, amount: money(o.totalAmount), events: {}, fourEnd: {} };
  state.orders[label] = rec;
  const before = await wallet(t);
  const pay = await api("/api/orders", t.boss.token, { action: "pay_order", id: o.id, paymentMethod: "catfood" });
  const after = await wallet(t);
  const row = await bossOrder(t, o.id);
  rec.claimedAt = new Date().toISOString();
  step(
    `${label}_create_pay_designated_catfood`,
    r.status === 200 && pay.status < 300 && pickStatus(row) === "claimed" && pickCompanion(row) === companion.id &&
      /指定陪玩30分钟内未确认或拒单/.test(String(o.description || "")) &&
      money(after.heldBalance) - money(before.heldBalance) === rec.amount,
    `order=${rec.orderNo} status=${pickStatus(row)} companion=${pickCompanion(row)} held ${before.heldBalance}→${after.heldBalance}`
  );
  save();
  return rec;
}

async function cronStartPhase() {
  report.started_at = new Date().toISOString();
  if (!(await deployedHasFix())) throw new Error("Staging alias does not serve this branch's build — run deploy-staging.mjs first");
  const probe = await cronTick();
  step("D0_cron_endpoint_live", probe.status === 200 && probe.ok, `GET /api/cron/gameplay-no-taker http=${probe.status} actions=${probe.actions.length}`);
  const t = await actors();
  state.actors = { bossId: t.boss.id, companionId: t.comp.id };
  await api("/api/companion", t.comp.token, { action: "set_online_status", online_status: "online" });
  const pubC = (await api(`/api/public/companions?id=${t.comp.id}`)).json?.companions?.[0] || {};
  const companion = { id: t.comp.id, name: pubC.name || pubC.nickname || "CompA" };
  const product = await ensureProduct(t);
  state.product = { id: product.id, name: product.name, price: product.packages[0].price };
  state.wallet0 = await wallet(t);
  save();

  const D1 = await createPaidDesignated(t, product, companion, "D1");
  const D2 = await createPaidDesignated(t, product, companion, "D2");
  const rej = await api("/api/companion", t.comp.token, { action: "reject_direct_order", id: D2.id, reason: "时间无法配合" });
  D2.hallAt = new Date().toISOString();
  const fD2 = await fourEnd(t, D2.id);
  step("D2_companion_reject_to_hall", rej.status < 300 && fD2.boss === "pending" && !fD2.companionId.boss, `http=${rej.status} ${fourEndText(fD2)}`);

  const early = await cronTick();
  step(
    "D3_cron_does_not_act_before_30min",
    early.ok && !early.actions.some((a) => a.id === D1.id || a.id === D2.id),
    `actions=${JSON.stringify(early.actions)}`
  );
  state.startedAt = report.started_at;
  save();
  console.log(`\nCRON START DONE. D1 claimed ${D1.claimedAt}, D2 in hall ${D2.hallAt}. Run --phase=cron-watch now.`);
}

async function cronWatchPhase() {
  const { D1, D2 } = state.orders;
  const ids = new Set([D1.id, D2.id]);
  state.cronLog = state.cronLog || [];
  state.cronCounts = state.cronCounts || {};
  const deadline = Date.parse(D1.claimedAt) + 75 * 60 * 1000;
  let doneAt = 0;
  while (Date.now() < deadline) {
    const burst = await Promise.all([cronTick(), cronTick(), cronTick()].map((p) => p.catch((e) => ({ ok: false, status: 0, actions: [], error: String(e) }))));
    const at = new Date().toISOString();
    const mine = burst.flatMap((b) => b.actions.filter((a) => ids.has(a.id)));
    for (const a of mine) {
      const key = `${a.id}:${a.action}`;
      state.cronCounts[key] = (state.cronCounts[key] || 0) + 1;
      const rec = state.orders[labelOf(a.id)];
      if (!rec.events[a.action]) rec.events[a.action] = at;
    }
    const entry = {
      at,
      d1Mins: minsSince(D1.claimedAt),
      d2HallMins: minsSince(D2.hallAt),
      http: burst.map((b) => b.status),
      actions: mine.map((a) => `${labelOf(a.id)}:${a.action}${a.mode ? `(${a.mode})` : ""}`),
    };
    state.cronLog.push(entry);
    console.log(JSON.stringify(entry));
    if (mine.length) {
      const t = await actors();
      await openBrowser();
      try {
        for (const a of mine) {
          const label = labelOf(a.id);
          const rec = state.orders[label];
          const f = await fourEnd(t, a.id);
          rec.fourEnd[a.action] = fourEndText(f);
          if (a.action === "reopened_in_hall") {
            await companionShot(t, "/companion/order-hall", rec.orderNo, `${label}-companion-hall-after-cron`);
            await bossOrderShot(t, rec.id, rec.orderNo, `${label}-boss-hall-after-cron`);
          }
        }
      } finally {
        await browser.close();
      }
    }
    save();
    if (!doneAt && D1.events.refunded && D2.events.refunded) doneAt = Date.now();
    if (doneAt && Date.now() - doneAt >= 3 * 60 * 1000) break;
    await sleep(60 * 1000);
  }
  console.log(`\nCRON WATCH DONE counts=${JSON.stringify(state.cronCounts)}`);
}

async function cronVerifyPhase() {
  const { D1, D2 } = state.orders;
  const n = (id, action) => state.cronCounts?.[`${id}:${action}`] || 0;
  const minsBetween = (a, b) => (a && b ? (Date.parse(b) - Date.parse(a)) / 60000 : NaN);
  const bad = Object.keys(state.cronCounts || {}).filter((k) => /:(error|refund_pending_retry)$/.test(k));
  const ticks = (state.cronLog || []).length * 3;
  step("D4_no_errors_or_retries", bad.length === 0, `ticks=${ticks} bad=${JSON.stringify(bad)}`);
  const d2Mins = minsBetween(D2.hallAt, D2.events.refunded);
  step(
    "D5_D2_hall_30min_refund_exactly_once",
    n(D2.id, "refunded") === 1 && n(D2.id, "reopened_in_hall") === 0 && d2Mins >= 29.5,
    `refunded×${n(D2.id, "refunded")} after ${d2Mins.toFixed(1)}m in hall (cron at ${D2.events.refunded}) four-end: ${D2.fourEnd.refunded || "?"}`
  );
  const d1Hall = minsBetween(D1.claimedAt, D1.events.reopened_in_hall);
  step(
    "D6_D1_confirm_timeout_hall_exactly_once",
    n(D1.id, "reopened_in_hall") === 1 && d1Hall >= 29.5,
    `reopened_in_hall×${n(D1.id, "reopened_in_hall")} after ${d1Hall.toFixed(1)}m unconfirmed four-end: ${D1.fourEnd.reopened_in_hall || "?"}`,
    { screenshot: ["screenshots/D1-companion-hall-after-cron.png", "screenshots/D1-boss-hall-after-cron.png"] }
  );
  const d1Refund = minsBetween(D1.events.reopened_in_hall, D1.events.refunded);
  step(
    "D7_D1_hall_30min_refund_exactly_once",
    n(D1.id, "refunded") === 1 && d1Refund >= 29.5,
    `refunded×${n(D1.id, "refunded")} after ${d1Refund.toFixed(1)}m in hall four-end: ${D1.fourEnd.refunded || "?"}`
  );

  const extra = await Promise.all([cronTick(), cronTick(), cronTick()]);
  const repeat = extra.flatMap((b) => b.actions).filter((a) => a.id === D1.id || a.id === D2.id);
  step("D8_repeat_ticks_are_noops", extra.every((b) => b.ok) && repeat.length === 0, `3 more ticks, actions on D1/D2: ${JSON.stringify(repeat)}`);

  const t = await actors();
  const w = await wallet(t);
  step(
    "D9_wallet_hold_released_once_no_double_credit",
    money(w.paidBalance) === money(state.wallet0.paidBalance) && money(w.heldBalance) === money(state.wallet0.heldBalance),
    `before D-orders paid=${state.wallet0.paidBalance} held=${state.wallet0.heldBalance} → now paid=${w.paidBalance} held=${w.heldBalance}`,
    { walletBefore: state.wallet0, walletAfter: w }
  );
  for (const [label, rec] of Object.entries({ D1, D2 })) {
    const f = await fourEnd(t, rec.id);
    step(`${label}_four_end_refunded`, [f.boss, f.cs, f.admin].every((s) => s === "refunded"), fourEndText(f));
  }
  await openBrowser();
  try {
    for (const [label, rec] of Object.entries({ D1, D2 })) {
      await bossOrderShot(t, rec.id, rec.orderNo, `${label}-boss-refunded`);
      await csShot(t, rec.orderNo, `${label}-cs-refunded`);
      await adminShot(t, rec.orderNo, `${label}-admin-refunded`);
    }
    const wp = await bossPage(t);
    await wp.goto(`${STG}/recharge.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await wp.waitForTimeout(4000);
    await shot(wp, "D-boss-wallet-after-cron", false);
    await wp.context().close();
  } finally {
    await browser.close();
  }
  console.log(`\nCRON VERIFY DONE ${JSON.stringify(report.summary)}`);
}

// ——— database-scheduler verification (pg_cron + pg_net) ———
let dbTarget = null;
let dbQuery = null;
async function sql(text, params = []) {
  if (!dbTarget) {
    const mod = await import("./apply-gameplay-no-taker-cron-staging.mjs");
    const target = mod.stagingDbTarget();
    if (!target) throw new Error("Staging DB credentials required (STAGING_DATABASE_URL / STAGING_DB_PASSWORD / SUPABASE_ACCESS_TOKEN)");
    const fingerprint = process.argv.find((a) => a.startsWith("--fingerprint-order="))?.slice(20) || "";
    await mod.assertStagingIdentity(target, fingerprint);
    dbTarget = target;
    dbQuery = mod.stagingQuery;
  }
  return dbQuery(dbTarget, text, params);
}
const uuidList = (ids) => {
  if (!ids.every((id) => /^[0-9a-f-]{36}$/i.test(id))) throw new Error("bad uuid");
  return ids.map((id) => `'${id}'`).join(",");
};
const pgIds = () => [state.orders.P1.id, state.orders.P2.id];

async function cronJob() {
  return (await sql("select jobid, schedule, active from cron.job where jobname = 'gameplay-no-taker-sweep'"))[0] || null;
}
async function cronRunsSince(iso) {
  return (
    await sql(
      `select count(*)::int as total, count(*) filter (where d.status = 'succeeded')::int as succeeded, max(d.start_time) as last
         from cron.job_run_details d join cron.job j using (jobid)
        where j.jobname = 'gameplay-no-taker-sweep' and d.start_time >= $1`,
      [iso]
    )
  )[0];
}
/** Responses pg_net stored for our endpoint (body always carries "reopened" or our auth messages). */
async function httpCodesSince(iso) {
  const rows = await sql(
    `select coalesce(status_code, 0)::int as code, timed_out, count(*)::int as n from net._http_response
      where created >= $1 and (content like '%"reopened":%' or content like '%Unauthorized cron%' or content like '%GAMEPLAY_CRON_SECRET%')
      group by 1, 2 order by 1`,
    [iso]
  );
  return Object.fromEntries(rows.map((r) => [`${r.code}${r.timed_out ? "-timeout" : ""}`, r.n]));
}
async function actingResponses(id, action) {
  return sql(
    `select created, status_code, content from net._http_response
      where created >= $1 and content ~ $2 order by created`,
    [state.startedAt, `"id":"${id}","orderNo":"[^"]*","action":"${action}"`]
  );
}
async function pgOrders() {
  const rows = await sql(`select id, order_no, status, companion_id from public.orders where id in (${uuidList(pgIds())})`);
  return Object.fromEntries(rows.map((r) => [r.id, r]));
}
async function fireSqlTicks(n = 3) {
  const rows = await sql(`select public.mcj_gameplay_no_taker_tick() as request_id from generate_series(1, ${Number(n) | 0})`);
  return rows.map((r) => r.request_id);
}

async function pgcronStartPhase() {
  report.started_at = new Date().toISOString();
  report.mode = "pg_cron";
  if (!(await deployedHasFix())) throw new Error("Staging target does not serve this branch's build — run deploy-staging.mjs first");
  const noSecret = await cronTick("");
  const wrongSecret = await cronTick("wrong-secret");
  step(
    "P0a_endpoint_rejects_missing_or_wrong_secret",
    noSecret.status === 401 && wrongSecret.status === 401,
    `no secret http=${noSecret.status}, wrong secret http=${wrongSecret.status} (503 would mean no secret configured)`
  );
  const job = await cronJob();
  const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const runs = await cronRunsSince(since);
  const codes = await httpCodesSince(since);
  step(
    "P0b_pg_cron_job_every_minute_authorized",
    job?.active === true && job.schedule === "* * * * *" && runs.succeeded >= 3 && (codes["200"] || 0) >= 3 && !codes["401"] && !codes["503"],
    `job=${JSON.stringify(job)} last5min runs=${runs.succeeded}/${runs.total} http=${JSON.stringify(codes)}`
  );
  const t = await actors();
  state.actors = { bossId: t.boss.id, companionId: t.comp.id };
  await api("/api/companion", t.comp.token, { action: "set_online_status", online_status: "online" });
  const pubC = (await api(`/api/public/companions?id=${t.comp.id}`)).json?.companions?.[0] || {};
  const companion = { id: t.comp.id, name: pubC.name || pubC.nickname || "CompA" };
  const product = await ensureProduct(t);
  state.product = { id: product.id, name: product.name, price: product.packages[0].price };
  state.wallet0 = await wallet(t);
  state.startedAt = report.started_at;
  save();

  await createPaidDesignated(t, product, companion, "P1");
  const P2 = await createPaidDesignated(t, product, companion, "P2");
  const rej = await api("/api/companion", t.comp.token, { action: "reject_direct_order", id: P2.id, reason: "时间无法配合" });
  P2.hallAt = new Date().toISOString();
  const fP2 = await fourEnd(t, P2.id);
  step("P2_companion_reject_to_hall", rej.status < 300 && fP2.boss === "pending" && !fP2.companionId.boss, `http=${rej.status} ${fourEndText(fP2)}`);
  save();
  console.log(`\nPGCRON START DONE. P1 claimed ${state.orders.P1.claimedAt}, P2 in hall ${P2.hallAt}. Run --phase=pgcron-watch now.`);
}

async function pgcronWatchPhase() {
  const { P1, P2 } = state.orders;
  const untilHall = process.argv.includes("--until=hall");
  state.pgLog = state.pgLog || [];
  state.sqlBursts = state.sqlBursts || [];
  const deadline = Date.parse(P1.claimedAt) + 70 * 60 * 1000;
  const label = { [P1.id]: "P1", [P2.id]: "P2" };
  let doneAt = 0;
  while (Date.now() < deadline) {
    const rows = await pgOrders();
    const at = new Date().toISOString();
    const p1 = rows[P1.id] || {};
    const p2 = rows[P2.id] || {};
    const transitions = [];
    if (p1.status === "pending" && !P1.events.reopened_in_hall) transitions.push([P1, "reopened_in_hall"]);
    if (p1.status === "refunded" && !P1.events.refunded) transitions.push([P1, "refunded"]);
    if (p2.status === "refunded" && !P2.events.refunded) transitions.push([P2, "refunded"]);
    for (const [rec, ev] of transitions) {
      rec.events[ev] = at;
      if (ev === "reopened_in_hall") rec.hallAt = at;
    }
    // Overlap the scheduled tick with 3 extra concurrent ticks while an order is due.
    const p1Due = p1.status === "claimed" ? Number(minsSince(P1.claimedAt)) : p1.status === "pending" ? Number(minsSince(P1.hallAt)) : -1;
    const p2Due = p2.status === "pending" ? Number(minsSince(P2.hallAt)) : -1;
    const inWindow = (m) => m >= 29.3 && m <= 32;
    let burst = null;
    if (inWindow(p1Due) || inWindow(p2Due)) {
      burst = await fireSqlTicks(3).catch((e) => `error: ${e.message}`);
      state.sqlBursts.push({ at, requestIds: burst });
    }
    const runs = await cronRunsSince(state.startedAt);
    const entry = {
      at,
      p1: `${p1.status}${p1.companion_id ? "+companion" : ""} ${minsSince(P1.claimedAt)}m`,
      p2: `${p2.status} ${minsSince(P2.hallAt)}m in hall`,
      cronRuns: `${runs.succeeded}/${runs.total}`,
      http: await httpCodesSince(state.startedAt),
      sqlBurst: burst ? "3 extra ticks" : "",
      transitions: transitions.map(([rec, ev]) => `${label[rec.id]}:${ev}`),
    };
    state.pgLog.push(entry);
    console.log(JSON.stringify(entry));
    save();
    if (transitions.length) {
      // Pages are opened only after the DB already shows the transition, so they cannot have caused it.
      const t = await actors();
      await openBrowser();
      try {
        for (const [rec, ev] of transitions) {
          const name = label[rec.id];
          rec.fourEnd[ev] = fourEndText(await fourEnd(t, rec.id));
          if (ev === "reopened_in_hall") {
            await companionShot(t, "/companion/order-hall", rec.orderNo, `${name}-pgcron-companion-hall`);
            await bossOrderShot(t, rec.id, rec.orderNo, `${name}-pgcron-boss-hall`);
          } else {
            await bossOrderShot(t, rec.id, rec.orderNo, `${name}-pgcron-boss-refunded`);
          }
        }
      } finally {
        await browser.close();
      }
      save();
    }
    const finished = untilHall ? P1.events.reopened_in_hall && P2.events.refunded : P1.events.refunded && P2.events.refunded;
    if (!doneAt && finished) doneAt = Date.now();
    if (doneAt && Date.now() - doneAt >= 3 * 60 * 1000) break;
    await sleep(60 * 1000);
  }
  console.log(`\nPGCRON WATCH DONE bursts=${state.sqlBursts.length}`);
}

async function pgcronVerifyPhase() {
  const { P1, P2 } = state.orders;
  const ids = uuidList(pgIds());
  const logs = await sql(
    `select order_id, from_status, to_status, count(*)::int as n, min(created_at) as first_at, string_agg(distinct coalesce(operator_role, ''), ',') as roles
       from public.order_status_logs where order_id in (${ids}) and created_at >= $1 group by 1, 2, 3`,
    [state.startedAt]
  );
  const logOf = (id, from, to) => logs.find((l) => l.order_id === id && l.from_status === from && l.to_status === to);
  const mins = (a, b) => (Date.parse(b) - Date.parse(a)) / 60000;
  state.statusLogs = logs;

  const p1Hall = logOf(P1.id, "claimed", "pending");
  step(
    "P3_P1_unconfirmed_30min_to_hall_exactly_once_by_cron",
    p1Hall?.n === 1 && p1Hall.roles === "system" && mins(P1.claimedAt, p1Hall.first_at) >= 29.5,
    `claimed→pending ×${p1Hall?.n || 0} at ${p1Hall?.first_at} (${p1Hall ? mins(P1.claimedAt, p1Hall.first_at).toFixed(1) : "?"}m after pay) operator=${p1Hall?.roles}`,
    { screenshot: ["screenshots/P1-pgcron-companion-hall.png", "screenshots/P1-pgcron-boss-hall.png"] }
  );
  const p2Ref = logOf(P2.id, "refund_requested", "refunded");
  const p2Lock = logOf(P2.id, "pending", "refund_requested");
  step(
    "P4_P2_hall_30min_refund_exactly_once_by_cron",
    p2Ref?.n === 1 && p2Lock?.n === 1 && mins(P2.hallAt, p2Ref.first_at) >= 29.5,
    `pending→refund_requested ×${p2Lock?.n || 0}, →refunded ×${p2Ref?.n || 0} at ${p2Ref?.first_at} (${p2Ref ? mins(P2.hallAt, p2Ref.first_at).toFixed(1) : "?"}m in hall)`,
    { screenshot: ["screenshots/P2-pgcron-boss-refunded.png"] }
  );
  const p1Ref = logOf(P1.id, "refund_requested", "refunded");
  if (P1.events.refunded) {
    step(
      "P5_P1_hall_30min_refund_exactly_once_by_cron",
      p1Ref?.n === 1 && mins(p1Hall.first_at, p1Ref.first_at) >= 29.5,
      `→refunded ×${p1Ref?.n || 0} at ${p1Ref?.first_at} (${p1Ref ? mins(p1Hall.first_at, p1Ref.first_at).toFixed(1) : "?"}m in hall)`
    );
  }

  const holds = await sql(`select order_id, status, release_idempotency_key from public.wallet_order_holds where order_id in (${ids})`);
  const txs = await sql(
    `select related_order_id, transaction_type, direction, count(*)::int as n, sum(amount)::numeric as amount
       from public.wallet_transactions where related_order_id in (${ids}) group by 1, 2, 3 order by 1, 2`
  );
  state.holds = holds;
  state.walletTxs = txs;
  const refundedIds = [P2.id, ...(P1.events.refunded ? [P1.id] : [])];
  step(
    "P6_hold_released_once_no_duplicate_wallet_rows",
    refundedIds.every((id) => holds.filter((h) => h.order_id === id).length === 1 && holds.find((h) => h.order_id === id)?.status === "released") &&
      txs.every((r) => r.n === 1 || r.transaction_type === "order_hold"),
    `holds=${JSON.stringify(holds.map((h) => [label(h.order_id), h.status, h.release_idempotency_key]))} walletTxs=${JSON.stringify(txs.map((r) => [label(r.related_order_id), r.transaction_type, r.direction, r.n, r.amount]))}`
  );
  function label(id) {
    return id === P1.id ? "P1" : id === P2.id ? "P2" : id;
  }

  const actsP1 = await actingResponses(P1.id, "reopened_in_hall");
  const actsP2 = await actingResponses(P2.id, "refunded");
  const actsP1r = P1.events.refunded ? await actingResponses(P1.id, "refunded") : [];
  state.actingResponses = { P1_reopened: actsP1, P2_refunded: actsP2, P1_refunded: actsP1r };
  const runs = await cronRunsSince(state.startedAt);
  const codes = await httpCodesSince(state.startedAt);
  state.cronSummary = { runs, codes, sqlBursts: (state.sqlBursts || []).length };
  step(
    "P7_transitions_came_from_pg_net_responses_exactly_once",
    actsP1.length === 1 && actsP2.length === 1 && (!P1.events.refunded || actsP1r.length === 1),
    `pg_net responses acting: P1 reopened×${actsP1.length} at ${actsP1[0]?.created}, P2 refunded×${actsP2.length} at ${actsP2[0]?.created}${
      P1.events.refunded ? `, P1 refunded×${actsP1r.length} at ${actsP1r[0]?.created}` : ""
    }`
  );
  step(
    "P8_scheduler_ran_every_minute_with_extra_concurrent_ticks",
    runs.succeeded >= 30 && (codes["200"] || 0) >= runs.succeeded && !codes["401"] && !codes["503"] && (state.sqlBursts || []).length >= 2,
    `pg_cron runs ${runs.succeeded}/${runs.total} since start, pg_net http=${JSON.stringify(codes)}, SQL bursts=${(state.sqlBursts || []).length}×3 extra ticks`
  );

  const t = await actors();
  for (const [name, rec] of Object.entries({ P1, P2 })) {
    const f = await fourEnd(t, rec.id);
    rec.fourEnd.final = fourEndText(f);
    step(`${name}_four_end_final`, rec.events.refunded ? [f.boss, f.cs, f.admin].every((s) => s === "refunded") : f.boss === "pending", fourEndText(f));
  }
  if (P1.events.refunded) {
    const w = await wallet(t);
    step(
      "P9_wallet_back_to_baseline",
      money(w.paidBalance) === money(state.wallet0.paidBalance) && money(w.heldBalance) === money(state.wallet0.heldBalance),
      `before P-orders paid=${state.wallet0.paidBalance} held=${state.wallet0.heldBalance} → now paid=${w.paidBalance} held=${w.heldBalance}`,
      { walletBefore: state.wallet0, walletAfter: w }
    );
  }
  await openBrowser();
  try {
    await csShot(t, P2.orderNo, "P2-pgcron-cs-refunded");
    await adminShot(t, P2.orderNo, "P2-pgcron-admin-refunded");
  } finally {
    await browser.close();
  }
  save();
  console.log(`\nPGCRON VERIFY DONE ${JSON.stringify(report.summary)}`);
}

/**
 * Dry-run by default; pass --apply to write. Only touches [E2E-GP-DESIGNATE] orders and the E2E product.
 * --reverse-duitnow debits refunds of fake-proof DuitNow orders; run it once per order.
 */
async function cleanupPhase() {
  const apply = process.argv.includes("--apply");
  const t = await actors();
  const before = await wallet(t);
  const list = await api("/api/orders?limit=500", t.boss.token);
  const mine = (list.json?.orders || []).filter((o) => JSON.stringify(o).includes(TAG));
  const open = mine.filter((o) => !["refunded", "cancelled", "completed"].includes(pickStatus(o)));
  const fakeRefunds = process.argv.includes("--reverse-duitnow")
    ? mine.filter((o) => pickStatus(o) === "refunded" && /duitnow/i.test(String(o.paymentMethod || o.payment_method || "")))
    : [];
  console.log(`wallet paid=${before.paidBalance} held=${before.heldBalance}`);
  console.log(`tagged orders: ${mine.map((o) => `${o.orderNo || o.order_no}:${pickStatus(o)}:${o.paymentMethod || o.payment_method || ""}`).join(", ")}`);
  console.log(`cancel: ${open.map((o) => o.orderNo || o.order_no).join(", ") || "-"}`);
  console.log(`reverse fake DuitNow refunds: ${fakeRefunds.map((o) => `${o.orderNo || o.order_no}=${money(o.totalAmount)}`).join(", ") || "-"}`);
  const products = ((await api("/api/platform/gameplay-products")).json?.products || []).filter((p) => p.name === PRODUCT_NAME);
  console.log(`delete products: ${products.map((p) => p.id).join(", ") || "-"}`);
  if (!apply) return console.log("\n(dry run — pass --apply to execute)");

  for (const o of open) {
    const r = await api("/api/admin/orders", t.admin.token, { action: "cancel", id: o.id, reason: `${TAG} Staging 测试数据清理` }, "POST", adminHeaders);
    step(`cleanup_cancel_${o.orderNo || o.order_no}`, r.status < 300 && r.json?.ok !== false, `http=${r.status} ${r.json?.message || ""}`);
  }
  for (const o of fakeRefunds) {
    const no = o.orderNo || o.order_no;
    const r = await api(
      "/api/admin/wallet",
      t.admin.token,
      {
        action: "deduct",
        bossId: t.boss.id,
        amount: money(o.totalAmount),
        reason: `${TAG} Staging 清理：冲回测试 DuitNow 假凭证订单 ${no} 的退款入账`,
        idempotencyKey: `e2e-gp-cleanup-duitnow:${no}`,
        preferBalanceType: "paid",
      },
      "POST",
      adminHeaders
    );
    step(`cleanup_reverse_${no}`, r.status < 300 && r.json?.ok !== false, `http=${r.status} ${r.json?.message || ""}`);
  }
  for (const p of products) {
    const r = await api("/api/admin/gameplay-products", t.admin.token, { action: "delete", id: p.id }, "POST", adminHeaders);
    step(`cleanup_delete_product_${p.id}`, r.status < 300 && r.json?.ok !== false, `http=${r.status} ${r.json?.message || ""}`);
  }
  const after = await wallet(t);
  step("cleanup_wallet", true, `paid ${before.paidBalance}→${after.paidBalance} held ${before.heldBalance}→${after.heldBalance}`, { walletBefore: before, walletAfter: after });
}

try {
  if (phase === "start") await startPhase();
  else if (phase === "watch") await watchPhase();
  else if (phase === "shots") await shotsPhase();
  else if (phase === "cron-start") await cronStartPhase();
  else if (phase === "cron-watch") await cronWatchPhase();
  else if (phase === "cron-verify") await cronVerifyPhase();
  else if (phase === "pgcron-start") await pgcronStartPhase();
  else if (phase === "pgcron-watch") await pgcronWatchPhase();
  else if (phase === "pgcron-verify") await pgcronVerifyPhase();
  else if (phase === "cleanup") await cleanupPhase();
  else throw new Error(`unknown phase ${phase}`);
} catch (e) {
  console.error(e);
  step(`${phase}_crash`, false, e.message || String(e));
  process.exitCode = 1;
}
