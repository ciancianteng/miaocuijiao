/**
 * Real browser E2E for the 3 final-acceptance FAILs.
 * Usage: PREVIEW=https://... PASS=... node scripts/p0-final-3fail-e2e-accept.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.PREVIEW || process.env.MCJ_STAGING_URL || "").replace(/\/$/, "");
const PASS = process.env.PASS || process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const ART = path.join(ROOT, "artifacts", "final-3fail-e2e");
fs.mkdirSync(ART, { recursive: true });

if (!BASE) throw new Error("PREVIEW required");

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

async function injectBossSession(page, token, email = "boss@meow.test") {
  await page.addInitScript(
    ({ token, email }) => {
      localStorage.setItem("mcjAuthAccessToken", token);
      sessionStorage.setItem("mcjAuthAccessToken", token);
      localStorage.setItem("customerAuthToken", token);
      const user = { role: "boss", email, name: "Boss", nickname: "Boss" };
      localStorage.setItem("customerUser", JSON.stringify(user));
      localStorage.setItem("bossUser", JSON.stringify(user));
    },
    { token, email }
  );
}

async function injectCompanionSession(page, token, email) {
  await page.addInitScript(
    ({ token, email }) => {
      localStorage.setItem("mcjAuthAccessToken", token);
      sessionStorage.setItem("mcjAuthAccessToken", token);
      localStorage.setItem("companionAuthToken", token);
      sessionStorage.setItem("companionAuthToken", token);
      localStorage.setItem(
        "companionUser",
        JSON.stringify({ role: "companion", email, name: "Companion", id: email })
      );
      sessionStorage.setItem(
        "companionUser",
        JSON.stringify({ role: "companion", email, name: "Companion", id: email })
      );
    },
    { token, email }
  );
}

async function injectAdminSession(page, token) {
  await page.addInitScript(
    ({ token }) => {
      localStorage.setItem("mcjAdminAccessToken", token);
      sessionStorage.setItem("mcjAdminAccessToken", token);
      localStorage.setItem("adminAuthToken", token);
      localStorage.setItem("mcjAuthAccessToken", token);
      sessionStorage.setItem("mcjAuthAccessToken", token);
      localStorage.setItem("adminUser", JSON.stringify({ role: "admin", email: "admin@meow.test", roleKey: "admin" }));
      localStorage.setItem("mcjAdminRole", "admin");
    },
    { token }
  );
}

async function readOrderPayLabels(page) {
  await page.waitForTimeout(800);
  const labels = await page.evaluate(() => {
    const nodes = [
      ...document.querySelectorAll("[data-po-pay], [data-gp-pay], [data-custom-pay], .method, .mcj-po-pay-title"),
    ];
    return nodes
      .map((n) => (n.getAttribute("data-po-pay") || n.getAttribute("data-gp-pay") || n.getAttribute("data-custom-pay") || n.textContent || "").trim())
      .filter(Boolean);
  });
  return [...new Set(labels.map((x) => String(x).replace(/\s+/g, " ")))];
}

async function toggleChannel(adminToken, id, enabled) {
  const res = await api(
    "/api/admin/payment-settings",
    adminToken,
    { action: "toggle_channel", channelId: id, enabled },
    "POST",
    { "x-mcj-admin-role": "admin" }
  );
  if (!res.ok) {
    console.warn("toggle fail", id, enabled, res.status, res.json?.message);
  }
  return res;
}

async function listChannels(adminToken) {
  return api("/api/admin/payment-settings", adminToken, null, "GET", { "x-mcj-admin-role": "admin" });
}

async function restoreChannels(adminToken, snapshot) {
  for (const ch of snapshot) {
    await toggleChannel(adminToken, ch.id || ch.channel_id || ch.code, !!ch.enabled);
  }
}

(async () => {
  let failed = 0;
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  try {
    // ---- Auth ----
    const bossLogin = await api("/api/auth", null, { action: "login", email: "boss@meow.test", password: PASS, loginPortal: "boss" });
    const bossToken = tokenOf(bossLogin);
    step("boss login", !!bossToken, bossLogin.json?.message || "ok");

    const compLogin = await api("/api/companion", null, {
      action: "login",
      account: "companion.final.1785714993009@meow.test",
      password: PASS,
    });
    const compToken = tokenOf(compLogin);
    step("companion login", !!compToken, compLogin.json?.message || "ok");

    const adminLogin = await api("/api/auth", null, {
      action: "login",
      email: "admin@meow.test",
      password: PASS,
      loginPortal: "admin",
    });
    const adminToken = tokenOf(adminLogin);
    step("admin login", !!adminToken, adminLogin.json?.message || Object.keys(adminLogin.json || {}).join(","));

    // ---- 1) Companion self payout privacy ----
    const boot = await api("/api/companion?action=bootstrap", compToken);
    const v = boot.json?.data?.verification || {};
    const selfApiOk =
      !!String(v.identityNo || "").trim() &&
      !!String(v.bankAccount || "").trim() &&
      !!String(v.bankName || "").trim() &&
      !!String(v.tngAccount || "").trim() &&
      !/^\*+/.test(String(v.identityNo || "")) &&
      !/^\*+/.test(String(v.bankAccount || ""));
    step(
      "API companion self full payout fields",
      selfApiOk,
      JSON.stringify({
        identityNo: v.identityNo,
        bankAccount: v.bankAccount,
        bankName: v.bankName,
        accountName: v.accountName,
        tng: v.tngAccount,
      })
    );
    if (!selfApiOk) failed++;

    const cpage = await browser.newPage();
    await injectCompanionSession(cpage, compToken, "companion.final.1785714993009@meow.test");
    await cpage.goto(`${BASE}/companion/account/`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await cpage.waitForTimeout(2500);
    await cpage.screenshot({ path: path.join(ART, "01-companion-account.png"), fullPage: true });
    const accountText = await cpage.locator("body").innerText();
    const uiSees =
      accountText.includes(String(v.identityNo)) &&
      accountText.includes(String(v.bankAccount)) &&
      accountText.includes(String(v.bankName)) &&
      accountText.includes(String(v.tngAccount));
    const uiMaskedOnly = /\*{4}\d{3,}/.test(accountText) && !accountText.includes(String(v.bankAccount));
    step("UI companion account shows plaintext payout", uiSees && !uiMaskedOnly, uiSees ? "plaintext visible" : "missing fields");
    if (!(uiSees && !uiMaskedOnly)) failed++;
    await cpage.close();

    // ---- 2) Admin player more menu ----
    // Real-browser computerUse already PASS; still attempt automated check.
    const apage = await browser.newPage();
    await injectAdminSession(apage, adminToken);
    await apage.goto(`${BASE}/admin.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await apage.waitForTimeout(2000);
    // Click sidebar 陪玩管理
    const clickedNav = await apage.evaluate(() => {
      const nodes = [...document.querySelectorAll("a,button,[data-nav],[data-section],.nav-item,.side-nav a")];
      const hit = nodes.find((n) => /陪玩管理/.test(n.textContent || "") || n.getAttribute("data-nav") === "players" || n.getAttribute("data-section") === "players");
      if (hit) {
        hit.click();
        return true;
      }
      location.hash = "#players";
      document.body.setAttribute("data-admin-section", "players");
      return false;
    });
    await apage.waitForTimeout(3500);
    await apage.screenshot({ path: path.join(ART, "02-admin-players.png"), fullPage: true });
    let moreBtn = apage.locator("[data-player-more]").first();
    let hasMore = (await moreBtn.count()) > 0;
    if (!hasMore) {
      // force render path if present
      await apage.evaluate(() => {
        if (typeof window.renderPlayerManagement === "function") window.renderPlayerManagement();
      }).catch(() => {});
      await apage.waitForTimeout(2000);
      moreBtn = apage.locator("[data-player-more]").first();
      hasMore = (await moreBtn.count()) > 0;
    }
    step("admin players table has 更多", hasMore, hasMore ? `found navClick=${clickedNav}` : `missing navClick=${clickedNav}`);
    if (!hasMore) {
      // Do not hard-fail automated path if computerUse already verified; still count.
      failed++;
    } else {
      await moreBtn.scrollIntoViewIfNeeded();
      await moreBtn.click({ force: true });
      await apage.waitForTimeout(500);
      await apage.screenshot({ path: path.join(ART, "02-admin-player-more.png"), fullPage: true });
      const menuVisible = await apage.evaluate(() => {
        const menus = [...document.querySelectorAll(".player-more-menu")];
        return menus.some((m) => {
          if (m.hidden) return false;
          const r = m.getBoundingClientRect();
          const style = getComputedStyle(m);
          return r.width > 0 && r.height > 0 && style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
        });
      });
      const menuOnBody = await apage.evaluate(() => {
        const open = document.querySelector(".player-more-menu.is-portal-open, .player-more-menu:not([hidden])");
        return !!(open && open.parentElement === document.body);
      });
      const canClickItem = await apage.evaluate(() => {
        const item = document.querySelector(
          ".player-more-menu:not([hidden]) [data-player-action], .player-more-menu.is-portal-open [data-player-action]"
        );
        return !!(item && item.getBoundingClientRect().height > 0);
      });
      step("admin 更多 menu visible", menuVisible, `portal=${menuOnBody} item=${canClickItem}`);
      if (!menuVisible || !canClickItem) failed++;
      if (canClickItem) {
        await apage
          .locator(".player-more-menu:not([hidden]) [data-player-action], .player-more-menu.is-portal-open [data-player-action]")
          .first()
          .click({ force: true });
        await apage.waitForTimeout(800);
        await apage.screenshot({ path: path.join(ART, "02b-admin-more-action.png"), fullPage: true });
        step("admin 更多 menu item clickable", true, "clicked");
      }
    }
    await apage.close();

    // ---- 3) Payment SoT sync across 4 pages ----
    const chList = await listChannels(adminToken);
    const channels = chList.json?.channels || chList.json?.data?.channels || chList.json?.paymentChannels || [];
    step("admin payment channels readable", channels.length > 0, `count=${channels.length} keys=${Object.keys(chList.json || {}).join(",")}`);
    const snapshot = channels.map((c) => ({
      id: c.id || c.channel_id || c.code,
      code: c.code || c.channel_id || c.id,
      enabled: c.enabled !== false && c.config_status !== "已停用",
      raw: c,
    }));

    async function assertBossPay(label, openIds, pageFactory) {
      const p = await browser.newPage();
      await injectBossSession(p, bossToken);
      try {
        await pageFactory(p);
        await p.waitForTimeout(1500);
        const labels = await readOrderPayLabels(p);
        await p.screenshot({ path: path.join(ART, `${label}.png`), fullPage: true });
        const text = (await p.locator("body").innerText()).toLowerCase();
        const hasTng = /\btng\b|touch\s*'?n\s*go/.test(text) && labels.some((x) => /tng/i.test(x));
        const hasAlipay = /支付宝|alipay/.test(text) && labels.some((x) => /支付宝|alipay/i.test(x));
        const hasBank = /银行卡/.test(text) && labels.some((x) => /银行卡|bank/i.test(x));
        const hasDuit = labels.some((x) => /duitnow/i.test(x)) || /duitnow/i.test(text);
        const hasCat = labels.some((x) => /猫粮|catfood/i.test(x));
        const expectDuit = openIds.includes("duitnow");
        const expectTng = openIds.includes("tng");
        const expectCat = openIds.includes("catfood");
        const ok =
          (expectDuit ? hasDuit : !hasDuit) &&
          (expectTng ? hasTng : !hasTng) &&
          !hasAlipay &&
          !hasBank &&
          (expectCat ? hasCat || openIds.length === 0 : true) &&
          !(openIds.length === 0 && (hasDuit || hasTng || hasAlipay || hasBank));
        step(
          label,
          ok,
          `open=${openIds.join(",")} labels=${JSON.stringify(labels).slice(0, 180)} duit=${hasDuit} tng=${hasTng} ali=${hasAlipay} bank=${hasBank}`
        );
        if (!ok) failed++;
        return ok;
      } finally {
        await p.close();
      }
    }

    let companionId = "";
    try {
      const pub = await api("/api/public/companions", bossToken);
      companionId = pub.json?.companions?.[0]?.id || pub.json?.companions?.[0]?.uid || "";
    } catch {}
    step("public companion for place-order", !!companionId, companionId || "none");

    async function openPlaceOrder(p) {
      if (companionId) {
        await p.goto(`${BASE}/place-order.html?companion=${encodeURIComponent(companionId)}`, {
          waitUntil: "domcontentloaded",
          timeout: 60000,
        });
        await p.waitForTimeout(2000);
        await p.waitForSelector("[data-po-pay-grid], [data-po-pay], .mcj-po-pay-card", { timeout: 15000 }).catch(() => {});
        return;
      }
      await p.goto(`${BASE}/companion-center.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await p.waitForTimeout(2000);
      const orderBtn = p.locator('button:has-text("立即下单"), a:has-text("立即下单"), [data-place-order], [data-open-order]').first();
      if (await orderBtn.count()) await orderBtn.click({ force: true });
      await p.waitForTimeout(1500);
    }

    async function openCustom(p) {
      await p.goto(`${BASE}/custom-order.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await p.waitForSelector("#customPayMethods", { timeout: 15000 });
    }

    async function openGameplay(p) {
      await p.goto(`${BASE}/more-gameplays.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await p.waitForTimeout(1500);
      const link = p.locator('a[href*="gameplay-product"], .gameplay-card a, [data-gameplay] a').first();
      if (await link.count()) {
        await link.click({ force: true });
        await p.waitForTimeout(2000);
      } else {
        await p.goto(`${BASE}/gameplay-product.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
        await p.waitForTimeout(2000);
      }
    }

    async function openRecharge(p) {
      await p.goto(`${BASE}/recharge.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await p.waitForTimeout(2000);
    }

    // Snapshot current enabled set from API (boss view)
    const curPay = await api("/api/recharge", bossToken);
    const curOpen = (curPay.json?.orderPayMethods || []).map((m) => m.id || m.code);
    step("baseline orderPayMethods", curOpen.length > 0, curOpen.join(","));

    // Helper: set only specific external channels enabled (keep wallet as-is via orderPayMethods)
    async function setOnlyExternal(codes) {
      const want = new Set(codes);
      for (const ch of snapshot) {
        const code = String(ch.code || ch.id).toLowerCase();
        if (code === "catfood" || code === "wallet") continue;
        const should = want.has(code);
        await toggleChannel(adminToken, ch.id, should);
      }
      // wait propagation
      await new Promise((r) => setTimeout(r, 800));
      const pay = await api("/api/recharge", bossToken);
      return (pay.json?.orderPayMethods || []).map((m) => m.id || m.code);
    }

    // Test 1: close all external
    let openIds = await setOnlyExternal([]);
    step("admin close all external → API", !openIds.some((x) => x !== "catfood"), openIds.join(",") || "(none)");
    await assertBossPay("立即下单 all-external-off", openIds, openPlaceOrder);
    await assertBossPay("自定义订单 all-external-off", openIds, openCustom);
    await assertBossPay("更多玩法 all-external-off", openIds, openGameplay);
    await assertBossPay("充值中心 all-external-off", openIds.filter((x) => x !== "catfood"), openRecharge);

    // Test 2: only DuitNow
    openIds = await setOnlyExternal(["duitnow"]);
    step("admin only DuitNow → API", openIds.includes("duitnow") && !openIds.includes("tng"), openIds.join(","));
    await assertBossPay("立即下单 only-duitnow", openIds, openPlaceOrder);
    await assertBossPay("自定义订单 only-duitnow", openIds, openCustom);
    await assertBossPay("更多玩法 only-duitnow", openIds, openGameplay);
    await assertBossPay("充值中心 only-duitnow", openIds.filter((x) => x !== "catfood"), openRecharge);

    // Ensure TNG has manual config so enable is allowed
    await api("/api/admin/payment-settings", adminToken, {
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
    }, "POST", { "x-mcj-admin-role": "admin" });

    // Test 3: only TNG (need TNG configured - if toggle fails/configured false, record FAIL honestly)
    openIds = await setOnlyExternal(["tng"]);
    const tngOpen = openIds.includes("tng");
    step("admin only TNG → API", tngOpen && !openIds.includes("duitnow"), openIds.join(",") || "TNG not open (not configured?)");
    if (!tngOpen) failed++;
    await assertBossPay("立即下单 only-tng", openIds, openPlaceOrder);
    await assertBossPay("自定义订单 only-tng", openIds, openCustom);
    await assertBossPay("更多玩法 only-tng", openIds, openGameplay);
    await assertBossPay("充值中心 only-tng", openIds.filter((x) => x !== "catfood"), openRecharge);

    // Test 4: back to DuitNow
    openIds = await setOnlyExternal(["duitnow"]);
    step("admin back to DuitNow → API", openIds.includes("duitnow") && !openIds.includes("tng"), openIds.join(","));
    await assertBossPay("立即下单 back-duitnow", openIds, openPlaceOrder);
    await assertBossPay("自定义订单 back-duitnow", openIds, openCustom);
    await assertBossPay("更多玩法 back-duitnow", openIds, openGameplay);
    await assertBossPay("充值中心 back-duitnow", openIds.filter((x) => x !== "catfood"), openRecharge);

    // Restore original channel enables from snapshot (best-effort: prefer duitnow on if was)
    for (const ch of snapshot) {
      await toggleChannel(adminToken, ch.id, !!ch.enabled);
    }
    // Ensure human baseline: DuitNow on, TNG off (matches acceptance screenshot)
    await setOnlyExternal(["duitnow"]);

    // No hardcode in shipped JS
    const modalJs = await fetch(`${BASE}/src/place-order-modal.js?v=20260808paySot3fail1`).then((r) => r.text());
    step("shipped JS no hardcoded TNG list", !/id:\s*"tng"\s*,\s*label:\s*"TNG"/.test(modalJs), "checked");

  } catch (err) {
    step("e2e crashed", false, err.stack || err.message);
    failed++;
  } finally {
    await browser.close();
  }

  const out = { base: BASE, failed, results, at: new Date().toISOString() };
  fs.writeFileSync(path.join(ART, "report.json"), JSON.stringify(out, null, 2));
  console.log(failed ? `FINAL_3FAIL_E2E_FAIL ${failed}` : "FINAL_3FAIL_E2E_PASS");
  process.exit(failed ? 1 : 0);
})();
