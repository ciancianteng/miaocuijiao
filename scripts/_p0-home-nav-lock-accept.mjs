/**
 * P0 home auth + nav lock acceptance
 */
import { chromium } from "playwright-core";

const BASE = "https://meow-cuijiao-homepage-staging.vercel.app";
const PASS = "McjTest@12345678";
const BOSS = "boss.final.1785714993009@meow.test";
const EDGE = "C:\\\\Program Files (x86)\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe";
const v = (ok) => (ok ? "PASS" : "FAIL");

async function loginApi() {
  const res = await fetch(`${BASE}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ action: "login", email: BOSS, password: PASS }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.ok || !body.session?.accessToken) throw new Error(body.message || res.status);
  return body.session;
}

async function main() {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const out = {};

  // Test 1: clean + leftover localStorage acceptance junk
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage({ viewport: { width: 1366, height: 900 } });
    await page.goto(`${BASE}/?t=${Date.now()}`, { waitUntil: "networkidle", timeout: 90000 });
    await page.evaluate(() => {
      localStorage.setItem("mcjAuthAccessToken", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.x");
      localStorage.setItem("mcjAuthRefreshToken", "stale-refresh");
      localStorage.setItem("customerAuthToken", "customer_session_v4_fake");
      localStorage.setItem(
        "customerUser",
        JSON.stringify({
          role: "boss",
          email: "boss.final.1785714993009@meow.test",
          displayName: "验收账号",
        })
      );
      localStorage.setItem("mcjCurrentUser", JSON.stringify({ name: "Demo Boss" }));
      localStorage.setItem("mcjRole", "boss");
    });
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(2200);
    const guest = await page.evaluate(() => {
      const desk = (document.querySelector(".mcj-desk-nav") || {}).innerText || "";
      const body = document.body.innerText || "";
      return {
        desk: desk.replace(/\s+/g, " ").trim(),
        hasLogin: /登录/.test(desk),
        hasCenter: /个人中心/.test(desk),
        auth: document.body.getAttribute("data-mcj-auth"),
        hasBossFinal: /boss\.final|验收账号|老板 UID|Demo Boss/i.test(body),
        lsAccess: !!localStorage.getItem("mcjAuthAccessToken"),
        ssAccess: !!sessionStorage.getItem("mcjAuthAccessToken"),
        href: location.href,
      };
    });
    out.guest = guest;
    out["首页默认未登录"] = v(guest.hasLogin && !guest.hasCenter && guest.auth === "out" && !guest.hasBossFinal && /\/($|\?)/.test(guest.href.replace(BASE, "")));
    out["自动登录验收账号已删除"] = v(!guest.lsAccess && !guest.ssAccess && guest.hasLogin && !guest.hasCenter);

    // nav 1366
    const nav1366 = await page.evaluate(() => {
      const nav = document.querySelector(".mcj-desk-nav");
      const links = [...nav.querySelectorAll("a")];
      const tops = links.map((a) => Math.round(a.getBoundingClientRect().top));
      const heights = links.map((a) => Math.round(a.getBoundingClientRect().height));
      return {
        labels: links.map((a) => a.textContent.trim()),
        sameRow: tops.every((t) => Math.abs(t - tops[0]) <= 2),
        heights,
        maxH: Math.max(...heights),
        overflow: document.documentElement.scrollWidth > window.innerWidth + 2,
      };
    });
    out.nav1366 = nav1366;
    out["电脑端导航单排"] = v(
      nav1366.sameRow &&
        nav1366.labels.length === 5 &&
        nav1366.labels.includes("登录") &&
        nav1366.maxH <= 44 &&
        !nav1366.overflow
    );

    // 125% zoom via CDP
    const client = await page.context().newCDPSession(page);
    await client.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1.25 });
    await page.waitForTimeout(500);
    const navZoom = await page.evaluate(() => {
      const nav = document.querySelector(".mcj-desk-nav");
      const links = [...nav.querySelectorAll("a")];
      const tops = links.map((a) => Math.round(a.getBoundingClientRect().top));
      return {
        sameRow: tops.every((t) => Math.abs(t - tops[0]) <= 3),
        count: links.length,
        overflow: document.documentElement.scrollWidth > window.innerWidth + 4,
      };
    });
    out.navZoom = navZoom;
    out["125%缩放不换行"] = v(navZoom.sameRow && navZoom.count === 5 && !navZoom.overflow);
    await client.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1 });

    // private pages
    await page.goto(`${BASE}/orders.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1200);
    const ordersUrl = page.url();
    await page.goto(`${BASE}/support.html?order=x&conversation=y`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1200);
    const supportUrl = page.url();
    const supportBiz = await page.evaluate(() => /订单号|会话列表|历史咨询/i.test(document.body.innerText || ""));
    out["未登录私有页面拦截"] = v(/#login|login\.html/i.test(ordersUrl) && /#login|login\.html/i.test(supportUrl) && !supportBiz);

    // mobile
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/?m=${Date.now()}`, { waitUntil: "networkidle", timeout: 90000 });
    await page.waitForTimeout(1500);
    const mobileBefore = await page.evaluate(() => {
      const desk = document.querySelector(".mcj-desk-nav");
      const toggle = document.querySelector("[data-mcj-mnav-toggle]");
      return {
        deskHidden: !desk || getComputedStyle(desk).display === "none",
        hasToggle: !!toggle,
        overflow: document.documentElement.scrollWidth > window.innerWidth + 2,
      };
    });
    await page.click("[data-mcj-mnav-toggle]");
    await page.waitForTimeout(400);
    const mobileOpen = await page.evaluate(() => {
      const text = (document.querySelector("[data-mcj-mnav-links]") || {}).innerText || "";
      return {
        text: text.replace(/\s+/g, " ").trim(),
        hasLogin: /登录/.test(text),
        hasLogout: /退出登录/.test(text),
        open: !!(document.querySelector(".mcj-mnav-sheet.open") || document.body.classList.contains("mcj-mnav-open")),
      };
    });
    out.mobile = { ...mobileBefore, ...mobileOpen };
    out["手机端菜单"] = v(
      mobileBefore.deskHidden &&
        mobileBefore.hasToggle &&
        !mobileBefore.overflow &&
        mobileOpen.hasLogin &&
        !mobileOpen.hasLogout &&
        mobileOpen.open
    );

    await ctx.close();
  }

  // login + logout
  {
    const session = await loginApi();
    const ctx = await browser.newContext();
    const page = await ctx.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.evaluate((s) => {
      [
        "mcjAuthAccessToken",
        "mcjAuthRefreshToken",
        "mcjAuthExpiresAt",
        "customerAuthToken",
        "customerUser",
        "mcjRole",
        "mcjCurrentUser",
      ].forEach((k) => localStorage.removeItem(k));
      sessionStorage.setItem("mcjAuthAccessToken", s.accessToken);
      if (s.refreshToken) sessionStorage.setItem("mcjAuthRefreshToken", s.refreshToken);
      if (s.expiresAt != null) sessionStorage.setItem("mcjAuthExpiresAt", String(s.expiresAt));
      sessionStorage.setItem("customerAuthToken", "customer_session_v4_" + Date.now());
      sessionStorage.setItem(
        "customerUser",
        JSON.stringify({ role: "boss", email: s.user?.email || "", displayName: s.user?.displayName || "Boss" })
      );
      sessionStorage.setItem("mcjRole", "boss");
    }, session);
    await page.goto(`${BASE}/mine.html`, { waitUntil: "networkidle", timeout: 90000 });
    await page.waitForTimeout(2000);
    const onMine = /mine\.html/i.test(page.url());
    await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 90000 });
    await page.waitForTimeout(1500);
    const logged = await page.evaluate(() => {
      const desk = (document.querySelector(".mcj-desk-nav") || {}).innerText || "";
      return { desk: desk.replace(/\s+/g, " ").trim(), hasCenter: /个人中心/.test(desk), hasLogin: /登录/.test(desk) };
    });
    out["登录后进入个人中心"] = v(onMine && logged.hasCenter && !logged.hasLogin);

    await page.evaluate(() => {
      if (window.MCJBossHeader?.clearSession) window.MCJBossHeader.clearSession();
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
    await page.goto(`${BASE}/?afterLogout=${Date.now()}`, { waitUntil: "networkidle", timeout: 90000 });
    await page.waitForTimeout(1500);
    const after = await page.evaluate(() => {
      const desk = (document.querySelector(".mcj-desk-nav") || {}).innerText || "";
      return {
        desk: desk.replace(/\s+/g, " ").trim(),
        hasLogin: /登录/.test(desk),
        hasCenter: /个人中心/.test(desk),
        ls: !!localStorage.getItem("mcjAuthAccessToken"),
        ss: !!sessionStorage.getItem("mcjAuthAccessToken"),
      };
    });
    out.after = after;
    out["退出后保持未登录"] = v(after.hasLogin && !after.hasCenter && !after.ls && !after.ss);
    await ctx.close();
  }

  console.log(JSON.stringify(out, null, 2));
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
