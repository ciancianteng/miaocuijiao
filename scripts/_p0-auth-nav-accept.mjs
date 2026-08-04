/**
 * P0 auth+nav acceptance for Staging.
 * Usage: node scripts/_p0-auth-nav-accept.mjs
 */
import fs from "node:fs";
import { chromium } from "playwright-core";

const BASE = "https://meow-cuijiao-homepage-staging.vercel.app";
const PASS = "McjTest@12345678";
const BOSS = "boss.final.1785714993009@meow.test";
const EDGE =
  "C:\\\\Program Files (x86)\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe";

function verdict(ok) {
  return ok ? "PASS" : "FAIL";
}

async function loginApi() {
  const res = await fetch(`${BASE}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ action: "login", email: BOSS, password: PASS }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.ok || !body.session?.accessToken) {
    throw new Error(body.message || String(res.status));
  }
  return body.session;
}

async function main() {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const out = {};

  // Test 1+2: clean storage / incognito guest
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${BASE}/?t=${Date.now()}`, { waitUntil: "networkidle", timeout: 90000 });
    await page.waitForTimeout(2000);
    // Inject soft-only + refresh leftovers — must still show 登录
    await page.evaluate(() => {
      localStorage.setItem("customerAuthToken", "customer_session_v4_fake");
      localStorage.setItem(
        "customerUser",
        JSON.stringify({
          role: "boss",
          email: "boss.final.1785714993009@meow.test",
          displayName: "验收账号",
        })
      );
      localStorage.setItem("mcjCurrentUser", JSON.stringify({ user_id: "user_demo_001", name: "Demo Boss" }));
      localStorage.setItem("mcjAuthRefreshToken", "stale-refresh-only");
      localStorage.removeItem("mcjAuthAccessToken");
    });
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    const guest = await page.evaluate(() => {
      const desk = (document.querySelector(".mcj-desk-nav") || {}).innerText || "";
      return {
        desk: desk.replace(/\s+/g, " ").trim(),
        hasLogin: /登录/.test(desk),
        hasCenter: /个人中心/.test(desk),
        auth: document.body.getAttribute("data-mcj-auth") || "",
        lsKeys: Object.keys(localStorage),
        hasAccess: !!(localStorage.getItem("mcjAuthAccessToken") || sessionStorage.getItem("mcjAuthAccessToken")),
      };
    });
    // Soft leftovers should be purged → 登录
    out.guestNav = guest;
    out["无痕窗口未登录"] = verdict(guest.hasLogin && !guest.hasCenter && guest.auth !== "in");
    out["自动进入验收账号已删除"] = verdict(
      guest.hasLogin && !guest.hasCenter && !guest.hasAccess
    );

    // Nav layout desktop: single row, 5 links
    const navGeom = await page.evaluate(() => {
      const nav = document.querySelector(".mcj-desk-nav");
      if (!nav) return null;
      const links = [...nav.querySelectorAll("a")];
      const tops = links.map((a) => Math.round(a.getBoundingClientRect().top));
      const sameRow = tops.every((t) => Math.abs(t - tops[0]) <= 2);
      const wrap = nav.scrollWidth > nav.clientWidth + 2;
      return {
        count: links.length,
        labels: links.map((a) => a.textContent.trim()),
        tops,
        sameRow,
        wrap,
        overflowX: document.documentElement.scrollWidth > window.innerWidth + 2,
      };
    });
    out.navGeom = navGeom;
    out["电脑端导航"] = verdict(
      navGeom &&
        navGeom.count === 5 &&
        navGeom.sameRow &&
        !navGeom.wrap &&
        !navGeom.overflowX &&
        navGeom.labels.includes("登录")
    );

    // Private pages
    await page.goto(`${BASE}/mine.html?t=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1500);
    const mineUrl = page.url();
    const mineBiz = await page.evaluate(() => /订单号|会话|余额|老板 UID|验收/i.test(document.body.innerText || ""));
    await page.goto(`${BASE}/support.html?order=x&conversation=y&t=${Date.now()}`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForTimeout(1500);
    const supportUrl = page.url();
    const supportBiz = await page.evaluate(() =>
      /订单号|会话列表|历史咨询|陪玩信息/i.test(document.body.innerText || "")
    );
    out.mineUrl = mineUrl;
    out.supportUrl = supportUrl;
    out["私有页面未登录拦截"] = verdict(
      /#login|login\.html/i.test(mineUrl) &&
        /#login|login\.html/i.test(supportUrl) &&
        !mineBiz &&
        !supportBiz
    );

    // Mobile nav
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/?m=${Date.now()}`, { waitUntil: "networkidle", timeout: 90000 });
    await page.waitForTimeout(1500);
    await page.click("[data-mcj-mnav-toggle], .mcj-mnav-toggle");
    await page.waitForTimeout(400);
    const mobile = await page.evaluate(() => {
      const links = document.querySelector("[data-mcj-mnav-links]");
      const text = (links && links.innerText) || "";
      return {
        text: text.replace(/\s+/g, " ").trim(),
        hasLogin: /登录/.test(text),
        overflowX: document.documentElement.scrollWidth > window.innerWidth + 2,
        deskHidden: getComputedStyle(document.querySelector(".mcj-desk-nav") || document.body).display === "none",
      };
    });
    out.mobile = mobile;
    out["手机端导航"] = verdict(mobile.hasLogin && !mobile.overflowX && mobile.deskHidden);

    await ctx.close();
  }

  // Test 5+6: real login then logout
  {
    const session = await loginApi();
    const ctx = await browser.newContext();
    const page = await ctx.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.evaluate((s) => {
      localStorage.setItem("mcjAuthAccessToken", s.accessToken);
      if (s.refreshToken) localStorage.setItem("mcjAuthRefreshToken", s.refreshToken);
      if (s.expiresAt != null) localStorage.setItem("mcjAuthExpiresAt", String(s.expiresAt));
      localStorage.setItem("customerAuthToken", "customer_session_v4_" + Date.now());
      localStorage.setItem(
        "customerUser",
        JSON.stringify({ role: "boss", email: s.user?.email || "", displayName: s.user?.displayName || "Boss" })
      );
      localStorage.setItem("mcjRole", "boss");
    }, session);
    await page.goto(`${BASE}/mine.html?t=${Date.now()}`, { waitUntil: "networkidle", timeout: 90000 });
    await page.waitForTimeout(2500);
    const loggedMine = page.url();
    const mineOk = /mine\.html/i.test(loggedMine) && !(await page.evaluate(() => /请先登录|#login/i.test(location.href)));
    const centerOnHome = await page.evaluate(async (base) => {
      location.href = base + "/?t=" + Date.now();
    }, BASE);
    await page.waitForTimeout(2500);
    await page.waitForLoadState("networkidle").catch(() => {});
    const deskIn = await page.evaluate(() => {
      const desk = (document.querySelector(".mcj-desk-nav") || {}).innerText || "";
      return { desk: desk.replace(/\s+/g, " ").trim(), hasCenter: /个人中心/.test(desk), hasLogin: /登录/.test(desk) };
    });
    out.loggedNav = deskIn;
    out["登录后进入个人中心"] = verdict(mineOk && deskIn.hasCenter && !deskIn.hasLogin);

    // Logout
    await page.evaluate(() => {
      if (window.MCJBossHeader && window.MCJBossHeader.clearSession) window.MCJBossHeader.clearSession();
      else if (window.MCJRoleGate) {
        window.MCJRoleGate.logout("customer");
        window.MCJRoleGate.logout("boss");
      }
      [
        "customerAuthToken",
        "customerUser",
        "mcjCurrentUser",
        "mcjAuthAccessToken",
        "mcjAuthRefreshToken",
        "mcjAuthExpiresAt",
        "mcjRole",
      ].forEach((k) => {
        localStorage.removeItem(k);
        sessionStorage.removeItem(k);
      });
    });
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    const afterLogout = await page.evaluate(() => {
      const desk = (document.querySelector(".mcj-desk-nav") || {}).innerText || "";
      return {
        desk: desk.replace(/\s+/g, " ").trim(),
        hasLogin: /登录/.test(desk),
        hasCenter: /个人中心/.test(desk),
        hasAccess: !!localStorage.getItem("mcjAuthAccessToken"),
        soft: !!localStorage.getItem("customerAuthToken"),
      };
    });
    out.afterLogout = afterLogout;
    out["退出登录后不自动登录"] = verdict(
      afterLogout.hasLogin && !afterLogout.hasCenter && !afterLogout.hasAccess && !afterLogout.soft
    );
    await ctx.close();
  }

  console.log(JSON.stringify(out, null, 2));
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
