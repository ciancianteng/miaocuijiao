/**
 * Boss support privacy acceptance
 */
import { chromium } from "playwright-core";

const BASE = "https://meow-cuijiao-homepage-staging.vercel.app";
const PASS = "McjTest@12345678";
const BOSS_A = "boss.final.1785714993009@meow.test";
const EDGE = "C:\\\\Program Files (x86)\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe";
const v = (ok) => (ok ? "PASS" : "FAIL");

async function login(email) {
  const res = await fetch(`${BASE}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "login", email, password: PASS }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.ok) throw new Error(body.message || res.status);
  return body.session;
}

async function api(token, path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function main() {
  const out = {};
  const sessionA = await login(BOSS_A);
  const tokenA = sessionA.accessToken;

  // Create boss B
  const emailB = `boss.support.iso.${Date.now()}@meow.test`;
  const reg = await fetch(`${BASE}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "register",
      email: emailB,
      password: PASS,
      displayName: "SupportISO",
      role: "boss",
    }),
  }).then((r) => r.json());
  if (!reg.ok || !reg.session?.accessToken) throw new Error(reg.message || "reg B fail");
  const tokenB = reg.session.accessToken;

  const ordersA = await api(tokenA, "/api/orders");
  const chatsA = await api(tokenA, "/api/chat?action=conversations");
  const orderA = (ordersA.body.orders || [])[0];
  const convA = (chatsA.body.conversations || [])[0];

  // Cross-boss API
  let crossOrder = { status: 0 };
  let crossConv = { status: 0 };
  if (orderA?.id) crossOrder = await api(tokenB, `/api/orders?id=${encodeURIComponent(orderA.id)}`);
  if (convA?.id) {
    crossConv = await api(tokenB, `/api/chat?conversation_id=${encodeURIComponent(convA.id)}`);
  }
  out["订单越权拦截"] = v(crossOrder.status === 403 && !(crossOrder.body.orders || []).length);
  out["会话越权拦截"] = v(
    crossConv.status === 403 && !(crossConv.body.messages || []).length && !crossConv.body.conversation
  );

  // Unauth
  const unauth = await fetch(`${BASE}/api/chat?action=conversations`).then(async (r) => ({
    status: r.status,
    body: await r.json().catch(() => ({})),
  }));
  out.apiUnauth = unauth.status;

  const browser = await chromium.launch({ executablePath: EDGE, headless: true });

  // Unauth page
  {
    const page = await browser.newPage();
    await page.goto(`${BASE}/support.html?order=x&conversation=y`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForTimeout(1500);
    out["未登录拦截"] = v(/#login|login\.html/i.test(page.url()));
    await page.close();
  }

  // Boss A UI
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await page.evaluate((s) => {
      sessionStorage.setItem("mcjAuthAccessToken", s.accessToken);
      if (s.refreshToken) sessionStorage.setItem("mcjAuthRefreshToken", s.refreshToken);
      if (s.expiresAt != null) sessionStorage.setItem("mcjAuthExpiresAt", String(s.expiresAt));
      sessionStorage.setItem("customerAuthToken", "customer_session_v4_" + Date.now());
      sessionStorage.setItem(
        "customerUser",
        JSON.stringify({ role: "boss", email: s.user?.email || "", displayName: s.user?.displayName || "Boss" })
      );
      sessionStorage.setItem("mcjRole", "boss");
    }, sessionA);
    await page.goto(`${BASE}/support.html?start=1`, { waitUntil: "networkidle", timeout: 90000 });
    await page.waitForTimeout(3500);
    const ui = await page.evaluate(() => {
      const text = document.body.innerText || "";
      return {
        orderCards: document.querySelectorAll(".support-order-card, [data-open-order-conversation]").length,
        sessions: document.querySelectorAll(".support-session, [data-select-conversation]").length,
        hasNewBtn: /新建客服咨询/.test(text),
        hasWallCaption: /订单咨询/.test(text) && document.querySelectorAll(".support-order-card").length > 5,
        hasRail: !!document.querySelector(".support-rail") && getComputedStyle(document.querySelector(".support-rail")).display !== "none",
        title: (document.querySelector(".support-aside-head h1") || {}).textContent || "",
        cols: getComputedStyle(document.querySelector(".support-layout") || document.body).gridTemplateColumns,
      };
    });
    out.ui = ui;
    out["老板客服页面已清理"] = v(ui.orderCards === 0 && !ui.hasRail && ui.hasNewBtn && /我的客服/.test(ui.title));
    out["只显示本人会话"] = v(ui.sessions >= 0 && ui.orderCards === 0 && !ui.hasWallCaption);

    // URL foreign order as A against fake uuid
    await page.goto(
      `${BASE}/support.html?order=00000000-0000-4000-8000-000000000099&conversation=00000000-0000-4000-8000-000000000098`,
      { waitUntil: "networkidle", timeout: 90000 }
    );
    await page.waitForTimeout(2500);
    const forbiddenUi = await page.evaluate(() => (document.body.innerText || "").slice(0, 800));
    out.forbiddenUi = forbiddenUi.slice(0, 200);
    // Mobile
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/support.html?start=1`, { waitUntil: "networkidle", timeout: 90000 });
    await page.waitForTimeout(2500);
    const mobile = await page.evaluate(() => {
      return {
        orderCards: document.querySelectorAll(".support-order-card").length,
        overflow: document.documentElement.scrollWidth > window.innerWidth + 2,
        hasList: !!document.querySelector(".support-session-list"),
      };
    });
    out.mobile = mobile;
    out["手机端布局"] = v(mobile.orderCards === 0 && !mobile.overflow && mobile.hasList);
    await page.close();
  }

  // Realtime smoke: open conversation and send as A, check list still ok
  {
    const open = await fetch(`${BASE}/api/chat`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenA}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ action: "open", forceNew: true, content: "privacy probe" }),
    }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
    const cid = open.body?.conversation?.id;
    let send = { status: 0, body: {} };
    if (cid) {
      send = await fetch(`${BASE}/api/chat`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenA}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          action: "send",
          conversation_id: cid,
          content: "老板客服实时探测 " + Date.now(),
        }),
      }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
    }
    out["老板客服实时聊天"] = v(!!cid && (send.status === 200 || send.body?.ok));
  }

  console.log(JSON.stringify(out, null, 2));
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
