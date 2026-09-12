import fs from "node:fs";
import { chromium } from "playwright-core";

function resolveChrome() {
  for (const p of [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ]) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const BASE = "http://127.0.0.1:4173";
const API = "https://meow-cuijiao-homepage-staging.vercel.app";
const PASS = "McjTest@12345678";

async function loginApi(email) {
  const res = await fetch(`${API}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ action: "login", email, password: PASS }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.ok || !body.session?.accessToken) {
    throw new Error(`${email}: ${body.message || res.status}`);
  }
  return body.session;
}

async function main() {
  const browser = await chromium.launch({ executablePath: resolveChrome(), headless: true });
  const out = {};

  async function unauth(path, expectRe) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(BASE + path, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(700);
    out[path] = expectRe.test(page.url()) ? "PASS" : "FAIL:" + page.url();
    await ctx.close();
  }

  await unauth("/admin.html", /\/admin\/login/i);
  await unauth("/companion/index.html", /\/companion\/login/i);
  await unauth("/customer-service/index.html", /\/customer-service\/login/i);
  await unauth("/mine.html", /\/login\.html/i);
  await unauth("/orders.html", /\/login\.html/i);

  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(BASE + "/login.html", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      localStorage.setItem("adminAuthToken", "admin_session_v4_fake");
      localStorage.setItem(
        "adminUser",
        JSON.stringify({ role: "admin", adminRole: "admin", permissions: ["admin"] })
      );
      localStorage.setItem("mcjRole", "admin");
      localStorage.setItem("companionAuthToken", "companion_session_v4_fake");
      localStorage.setItem("companionUser", JSON.stringify({ role: "companion" }));
      localStorage.setItem(
        "mcjCompanionSession",
        JSON.stringify({ token: "not-a-jwt", user: { role: "companion" } })
      );
      localStorage.setItem("customerServiceAuthToken", "customer_service_session_v4_fake");
      localStorage.setItem(
        "mcjServiceSession",
        JSON.stringify({ token: "not-a-jwt", user: { role: "customer_service" } })
      );
      localStorage.setItem("customerAuthToken", "customer_session_v4_fake");
      localStorage.setItem("customerUser", JSON.stringify({ role: "boss" }));
    });
    const soft = [];
    for (const [p, re] of [
      ["/admin.html", /\/admin\/login/i],
      ["/companion/index.html", /\/companion\/login/i],
      ["/customer-service/index.html", /\/customer-service\/login/i],
      ["/mine.html", /\/login\.html/i],
    ]) {
      await page.goto(BASE + p, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(500);
      soft.push(re.test(page.url()));
    }
    out.softTokenDenied = soft.every(Boolean) ? "PASS" : "FAIL";
    await ctx.close();
  }

  {
    const res = await fetch(`${API}/api/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "login", email: "admin@meow.test", password: "wrong-password-xxx" }),
    });
    const body = await res.json().catch(() => ({}));
    out.wrongPassword = !res.ok || body.ok === false ? "PASS" : "FAIL";
  }

  async function loginFlow(role, email, home, loginRe) {
    const session = await loginApi(email);
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(BASE + "/login.html", { waitUntil: "domcontentloaded" });
    await page.evaluate(
      ({ role, session }) => {
        [
          "customerAuthToken",
          "customerUser",
          "customerServiceAuthToken",
          "customerServiceUser",
          "mcjServiceSession",
          "companionAuthToken",
          "companionUser",
          "mcjCompanionSession",
          "adminAuthToken",
          "adminUser",
          "mcjAuthAccessToken",
          "mcjAuthRefreshToken",
          "mcjAuthExpiresAt",
          "mcjRole",
        ].forEach((k) => {
          localStorage.removeItem(k);
          sessionStorage.removeItem(k);
        });
        const user = Object.assign({}, session.user || {}, { role: session.user?.role || role });
        localStorage.setItem("mcjRole", user.role);
        localStorage.setItem("mcjAuthAccessToken", session.accessToken || "");
        if (session.refreshToken) localStorage.setItem("mcjAuthRefreshToken", session.refreshToken);
        if (session.expiresAt) localStorage.setItem("mcjAuthExpiresAt", String(session.expiresAt));
        if (role === "admin") {
          localStorage.setItem("adminAuthToken", "admin_session_v4_" + Date.now());
          localStorage.setItem(
            "adminUser",
            JSON.stringify(
              Object.assign({}, user, {
                adminRole: user.role === "super_admin" ? "super_admin" : "admin",
                permissions: [user.role === "super_admin" ? "super_admin" : "admin"],
              })
            )
          );
        } else if (role === "companion") {
          localStorage.setItem("companionAuthToken", "companion_session_v4_" + Date.now());
          localStorage.setItem("companionUser", JSON.stringify(user));
          localStorage.setItem(
            "mcjCompanionSession",
            JSON.stringify({
              token: session.accessToken,
              accessToken: session.accessToken,
              refreshToken: session.refreshToken || "",
              expiresAt: session.expiresAt || "",
              user,
            })
          );
        } else if (role === "customer_service") {
          localStorage.setItem("customerServiceAuthToken", "customer_service_session_v4_" + Date.now());
          localStorage.setItem("customerServiceUser", JSON.stringify(user));
          localStorage.setItem(
            "mcjServiceSession",
            JSON.stringify({
              token: session.accessToken,
              accessToken: session.accessToken,
              refreshToken: session.refreshToken || "",
              expiresAt: session.expiresAt || "",
              user,
            })
          );
        } else {
          localStorage.setItem("customerAuthToken", "customer_session_v4_" + Date.now());
          localStorage.setItem("customerUser", JSON.stringify(user));
        }
      },
      { role, session }
    );
    await page.goto(BASE + home, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(900);
    const entered = !loginRe.test(page.url());
    await page.evaluate(() => {
      [
        "customerAuthToken",
        "customerUser",
        "customerServiceAuthToken",
        "customerServiceUser",
        "mcjServiceSession",
        "companionAuthToken",
        "companionUser",
        "mcjCompanionSession",
        "adminAuthToken",
        "adminUser",
        "mcjAuthAccessToken",
        "mcjAuthRefreshToken",
        "mcjAuthExpiresAt",
        "mcjRole",
      ].forEach((k) => {
        localStorage.removeItem(k);
        sessionStorage.removeItem(k);
      });
    });
    await page.goto(BASE + home, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(700);
    const blocked = loginRe.test(page.url());
    await ctx.close();
    return entered && blocked;
  }

  try {
    out.admin = (await loginFlow("admin", "admin@meow.test", "/admin.html", /\/admin\/login/i))
      ? "PASS"
      : "FAIL";
  } catch (e) {
    out.admin = "FAIL:" + e.message;
  }
  try {
    out.companion = (await loginFlow(
      "companion",
      "companion@meow.test",
      "/companion/index.html",
      /\/companion\/login/i
    ))
      ? "PASS"
      : "FAIL";
  } catch (e) {
    out.companion = "FAIL:" + e.message;
  }
  try {
    out.customer_service = (await loginFlow(
      "customer_service",
      "service@meow.test",
      "/customer-service/index.html",
      /\/customer-service\/login/i
    ))
      ? "PASS"
      : "FAIL";
  } catch (e) {
    out.customer_service = "FAIL:" + e.message;
  }
  try {
    out.boss = (await loginFlow("boss", "boss@meow.test", "/mine.html", /\/login\.html/i))
      ? "PASS"
      : "FAIL";
  } catch (e) {
    out.boss = "FAIL:" + e.message;
  }

  await browser.close();
  console.log(JSON.stringify(out, null, 2));
  const keys = ["admin", "companion", "customer_service", "boss", "softTokenDenied", "wrongPassword"];
  const all = keys.every((k) => out[k] === "PASS") &&
    ["/admin.html", "/companion/index.html", "/customer-service/index.html", "/mine.html", "/orders.html"].every(
      (k) => out[k] === "PASS"
    );
  process.exit(all ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
