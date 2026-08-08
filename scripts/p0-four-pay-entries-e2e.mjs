/**
 * Real browser E2E: four boss pay entries must follow admin payment SoT.
 * Usage: PREVIEW=https://... node scripts/p0-four-pay-entries-e2e.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.PREVIEW || process.env.MCJ_STAGING_URL || "https://meow-cuijiao-homepage-staging.vercel.app").replace(/\/$/, "");
const PASS = process.env.PASS || process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const ART = path.join(ROOT, "artifacts", "four-pay-entries-e2e");
fs.mkdirSync(ART, { recursive: true });

const results = [];
function step(name, ok, detail) {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "") });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
  return ok;
}

async function api(pathname, token, body, method = null, extra = {}) {
  const m = method || (body == null ? "GET" : "POST");
  const res = await fetch(`${BASE}${pathname}`, {
    method: m,
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body != null ? { "Content-Type": "application/json" } : {}),
      ...extra,
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok && json.ok !== false, status: res.status, json };
}

function tokenOf(login) {
  return (
    login.json?.session?.accessToken ||
    login.json?.session?.token ||
    login.json?.accessToken ||
    login.json?.token ||
    ""
  );
}

async function injectBoss(page, token) {
  await page.addInitScript(({ token }) => {
    localStorage.setItem("mcjAuthAccessToken", token);
    sessionStorage.setItem("mcjAuthAccessToken", token);
    localStorage.setItem("customerAuthToken", token);
    const user = { role: "boss", email: "boss@meow.test", name: "Boss", nickname: "Boss" };
    localStorage.setItem("customerUser", JSON.stringify(user));
    localStorage.setItem("bossUser", JSON.stringify(user));
  }, { token });
}

async function readPayLabels(page) {
  await page.waitForTimeout(1200);
  return page.evaluate(() => {
    const nodes = [
      ...document.querySelectorAll("[data-po-pay], [data-gp-pay], [data-custom-pay], .method, .mcj-po-pay-title, [data-method]"),
    ];
    const labels = nodes
      .map((n) => {
        const id =
          n.getAttribute("data-po-pay") ||
          n.getAttribute("data-gp-pay") ||
          n.getAttribute("data-custom-pay") ||
          n.getAttribute("data-method") ||
          "";
        const text = (n.textContent || "").replace(/\s+/g, " ").trim();
        return id ? `${id}|${text}` : text;
      })
      .filter(Boolean);
    return [...new Set(labels)];
  });
}

function analyzeLabels(labels, expectOpen) {
  const joined = labels.join(" || ").toLowerCase();
  const has = (re) => labels.some((x) => re.test(String(x))) || re.test(joined);
  const hasTng = has(/\btng\b|touch\s*'?n\s*go/);
  const hasDuit = has(/duitnow/);
  const hasAlipay = has(/支付宝|alipay/);
  const hasBank = has(/银行卡|bank-transfer|\bbank\b/);
  const hasCat = has(/猫粮|catfood/);
  const expectTng = expectOpen.includes("tng");
  const expectDuit = expectOpen.includes("duitnow");
  const expectCat = expectOpen.includes("catfood");
  const ok =
    (expectTng ? hasTng : !hasTng) &&
    (expectDuit ? hasDuit : !hasDuit) &&
    !hasAlipay &&
    !hasBank &&
    (expectCat ? hasCat || expectOpen.filter((x) => x !== "catfood").length === 0 : true);
  return { ok, hasTng, hasDuit, hasAlipay, hasBank, hasCat };
}

async function toggleChannel(adminToken, id, enabled) {
  return api(
    "/api/admin/payment-settings",
    adminToken,
    { action: "toggle_channel", channelId: id, enabled },
    "POST",
    { "x-mcj-admin-role": "admin" }
  );
}

async function listChannels(adminToken) {
  return api("/api/admin/payment-settings", adminToken, null, "GET", { "x-mcj-admin-role": "admin" });
}

async function setOnlyExternal(adminToken, bossToken, codes) {
  const ch = await listChannels(adminToken);
  const channels = ch.json?.channels || ch.json?.data?.channels || ch.json?.paymentChannels || [];
  const want = new Set(codes.map((c) => String(c).toLowerCase()));
  for (const c of channels) {
    const code = String(c.code || c.channel_id || c.id || "").toLowerCase();
    if (!code || code === "catfood" || code === "wallet") continue;
    await toggleChannel(adminToken, c.id || c.channel_id || c.code, want.has(code));
  }
  await new Promise((r) => setTimeout(r, 900));
  const pay = await api("/api/recharge", bossToken);
  const order = (pay.json?.orderPayMethods || []).map((m) => m.id || m.code);
  const methods = (pay.json?.methods || []).filter((m) => m.open === true || m.statusText === "可用").map((m) => m.code);
  return { order, methods, pay };
}

(async () => {
  let failed = 0;
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  try {
    // Probe shipped JS for hardcodes (alias regression detector)
    const homeHtml = await fetch(`${BASE}/`).then((r) => r.text());
    const hasClassic = /\/src\/place-order-modal\.js/.test(homeHtml);
    step("homepage loads classic place-order SoT script", hasClassic, hasClassic ? "src/place-order-modal.js" : "missing classic script (stale alias?)");
    if (!hasClassic) failed++;

    const modalJs = await fetch(`${BASE}/src/place-order-modal.js?v=e2e`).then((r) => r.text()).catch(() => "");
    step("shipped modal no hardcoded TNG list", modalJs && !/id:\s*"tng"\s*,\s*label:\s*"TNG"/.test(modalJs), modalJs ? "checked" : "missing js");
    if (!modalJs || /id:\s*"tng"\s*,\s*label:\s*"TNG"/.test(modalJs)) failed++;

    const assetMatch = homeHtml.match(/\/assets\/(index-[A-Za-z0-9_-]+\.js)/);
    if (assetMatch) {
      const bundle = await fetch(`${BASE}/assets/${assetMatch[1]}`).then((r) => r.text());
      const hardcoded = /id:`tng`,label:`TNG`|id:"tng",label:"TNG"|\{id:`tng`,label:`TNG`\}/.test(bundle);
      // Bundle hardcode is FAIL only when classic script is absent (old alias).
      const ok = hasClassic || !hardcoded;
      step("index bundle hardcode gate", ok, hardcoded ? `hardcode in ${assetMatch[1]} classic=${hasClassic}` : `clean ${assetMatch[1]}`);
      if (!ok) failed++;
    }

    const bossLogin = await api("/api/auth", null, { action: "login", email: "boss@meow.test", password: PASS, loginPortal: "boss" });
    const bossToken = tokenOf(bossLogin);
    step("boss login", !!bossToken, bossLogin.json?.message || "ok");
    if (!bossToken) failed++;

    const adminLogin = await api("/api/auth", null, { action: "login", email: "admin@meow.test", password: PASS, loginPortal: "admin" });
    const adminToken = tokenOf(adminLogin);
    step("admin login", !!adminToken, adminLogin.json?.message || "ok");
    if (!adminToken) failed++;

    const chList = await listChannels(adminToken);
    const channels = chList.json?.channels || chList.json?.data?.channels || chList.json?.paymentChannels || [];
    const snapshot = channels.map((c) => ({
      id: c.id || c.channel_id || c.code,
      code: String(c.code || c.channel_id || c.id || "").toLowerCase(),
      enabled: c.enabled !== false && c.config_status !== "已停用",
    }));
    step("admin channels readable", channels.length > 0, `count=${channels.length}`);

    let companionId = "";
    try {
      const pub = await api("/api/public/companions", bossToken);
      companionId = pub.json?.companions?.[0]?.id || pub.json?.companions?.[0]?.uid || "";
    } catch {}
    step("companion available", !!companionId, companionId || "none");

    async function openEntry(page, which) {
      if (which === "立即下单") {
        // Real boss path: companion hall → 立即下单 opens MCJPlaceOrder modal (SoT).
        await page.goto(`${BASE}/companion-center.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForTimeout(2000);
        const orderBtn = page.locator('button:has-text("立即下单"), [data-hall-order], [data-place-order]').first();
        if (await orderBtn.count()) {
          await orderBtn.click({ force: true });
        } else if (companionId) {
          await page.goto(`${BASE}/place-order.html?companionId=${encodeURIComponent(companionId)}`, {
            waitUntil: "domcontentloaded",
            timeout: 60000,
          });
        }
        await page.waitForSelector("[data-po-pay-grid] [data-po-pay], [data-po-pay], .mcj-po-pay-card, .mcj-po-mask", {
          timeout: 20000,
        }).catch(() => {});
        await page.waitForTimeout(1500);
      } else if (which === "自定义订单") {
        await page.goto(`${BASE}/custom-order.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForSelector("#customPayMethods, [data-custom-pay]", { timeout: 20000 }).catch(() => {});
      } else if (which === "更多玩法") {
        await page.goto(`${BASE}/more-gameplays.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForTimeout(1500);
        const link = page.locator('a[href*="gameplay-product"], .gameplay-card a, [data-gameplay] a').first();
        if (await link.count()) {
          await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => null), link.click({ force: true })]);
        } else {
          await page.goto(`${BASE}/gameplay-product.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
        }
        await page.waitForSelector("[data-gp-pay], [data-gp-pay-grid]", { timeout: 20000 }).catch(() => {});
      } else if (which === "充值中心") {
        await page.goto(`${BASE}/recharge.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForSelector(".method, [data-method]", { timeout: 20000 }).catch(() => {});
      }
    }

    async function assertEntry(name, expectOpen, fileSlug) {
      const page = await browser.newPage();
      await injectBoss(page, bossToken);
      try {
        await openEntry(page, name);
        await page.waitForTimeout(1500);
        const labels = await readPayLabels(page);
        const shot = path.join(ART, `${fileSlug}.png`);
        await page.screenshot({ path: shot, fullPage: true });
        // Recharge ignores catfood
        const expect = name === "充值中心" ? expectOpen.filter((x) => x !== "catfood") : expectOpen;
        const a = analyzeLabels(labels, expect);
        const ok = a.ok;
        step(name, ok, `expect=${expect.join(",") || "(none)"} labels=${JSON.stringify(labels).slice(0, 220)} tng=${a.hasTng} duit=${a.hasDuit} ali=${a.hasAlipay} bank=${a.hasBank} shot=${path.basename(shot)}`);
        if (!ok) failed++;
        return ok;
      } finally {
        await page.close();
      }
    }

    // Ensure TNG has QR config so enable can succeed when needed
    await api(
      "/api/admin/payment-settings",
      adminToken,
      {
        action: "save_channel",
        channel: {
          id: "tng",
          channel_id: "tng",
          name: "TNG",
          category: "manual",
          enabled: false,
          visible: false,
          data: {
            publicLabel: "TNG",
            manual: {
              phone: "60123456789",
              qrUrl: "https://jqfaknpmcnqwqvatrwgo.supabase.co/storage/v1/object/public/platform-payment/qr/tng.png",
              receiverName: "MEOW CUI JIAO ENTERPRISE",
            },
          },
        },
      },
      "POST",
      { "x-mcj-admin-role": "admin" }
    );

    // Scenario A: only DuitNow (TNG off) — primary acceptance
    let { order } = await setOnlyExternal(adminToken, bossToken, ["duitnow"]);
    step("API only DuitNow", order.includes("duitnow") && !order.includes("tng"), order.join(","));
    if (!(order.includes("duitnow") && !order.includes("tng"))) failed++;

    await assertEntry("立即下单", order, "01-place-order-duitnow");
    await assertEntry("自定义订单", order, "02-custom-order-duitnow");
    await assertEntry("更多玩法", order, "03-gameplay-duitnow");
    await assertEntry("充值中心", order.filter((x) => x !== "catfood"), "04-recharge-duitnow");

    // Scenario B: TNG off must never show TNG — close all external
    ({ order } = await setOnlyExternal(adminToken, bossToken, []));
    step("API all external off", !order.some((x) => x !== "catfood"), order.join(",") || "(none)");
    await assertEntry("立即下单-all-off", order, "05-place-order-all-off");
    await assertEntry("充值中心-all-off", order.filter((x) => x !== "catfood"), "06-recharge-all-off");

    // Scenario C: only TNG
    ({ order } = await setOnlyExternal(adminToken, bossToken, ["tng"]));
    const tngOk = order.includes("tng") && !order.includes("duitnow");
    step("API only TNG", tngOk, order.join(",") || "TNG not open");
    if (!tngOk) failed++;
    await assertEntry("立即下单-only-tng", order, "07-place-order-tng");
    await assertEntry("充值中心-only-tng", order.filter((x) => x !== "catfood"), "08-recharge-tng");

    // Restore: DuitNow on, others off (human baseline)
    for (const ch of snapshot) {
      await toggleChannel(adminToken, ch.id, !!ch.enabled);
    }
    await setOnlyExternal(adminToken, bossToken, ["duitnow"]);
  } catch (err) {
    step("e2e crashed", false, err.stack || err.message);
    failed++;
  } finally {
    await browser.close();
  }

  const out = { base: BASE, failed, results, at: new Date().toISOString() };
  fs.writeFileSync(path.join(ART, "results.json"), JSON.stringify(out, null, 2));
  console.log(failed ? `FOUR_PAY_ENTRIES_E2E_FAIL ${failed}` : "FOUR_PAY_ENTRIES_E2E_PASS");
  console.log(`ARTIFACTS ${ART}`);
  process.exit(failed ? 1 : 0);
})();
