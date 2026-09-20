const path = require("path");
const { chromium } = require("playwright-core");

const BASE = process.env.PROTO_BASE || "http://127.0.0.1:5179/";
const OUT = path.join(__dirname, "..", "docs", "mobile-app-proto-screenshots");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

function fakeJwt() {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ role: "boss", exp: Math.floor(Date.now() / 1000) + 3600, sub: "screenshot-boss" })
  ).toString("base64url");
  return `${header}.${payload}.screenshot-sig`;
}

async function withBossSession(page) {
  const token = fakeJwt();
  await page.addInitScript(
    ({ token, exp }) => {
      try {
        sessionStorage.setItem("mcjAuthAccessToken", token);
        localStorage.setItem("mcjAuthAccessToken", token);
        sessionStorage.setItem("mcjAuthRefreshToken", "screenshot-refresh");
        localStorage.setItem("mcjAuthRefreshToken", "screenshot-refresh");
        sessionStorage.setItem("mcjAuthExpiresAt", String(exp));
        localStorage.setItem("mcjAuthExpiresAt", String(exp));
        sessionStorage.setItem("mcjRole", "boss");
        localStorage.setItem("mcjRole", "boss");
        const user = JSON.stringify({
          role: "boss",
          hasBoss: true,
          displayName: "截图预览老板",
          bossUid: "MCJ-DEMO",
        });
        sessionStorage.setItem("customerUser", user);
        localStorage.setItem("customerUser", user);
      } catch (e) {}
    },
    { token, exp: Date.now() + 3600_000 }
  );
}

(async () => {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });

  // Mine layout
  {
    const page = await browser.newPage();
    await withBossSession(page);
    await page.route("**/api/auth**", async (route) => {
      const req = route.request();
      if (req.url().includes("action=me") || req.method() === "GET") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            user: {
              role: "boss",
              hasBoss: true,
              displayName: "截图预览老板",
              bossUid: "MCJ-DEMO",
              hasPassword: true,
            },
          }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, user: { role: "boss", hasBoss: true, displayName: "截图预览老板", bossUid: "MCJ-DEMO" } }),
      });
    });
    await page.route("**/api/recharge**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, wallet: { totalBalance: 88, paidBalance: 80, bonusBalance: 8 } }),
      })
    );
    await page.route("**/api/points**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, account: { balance: 128, lifetimeEarned: 200 } }),
      })
    );
    await page.route("**/api/boss/direct-companions**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, companions: [{ id: 1 }, { id: 2 }] }),
      })
    );
    await page.route("**/api/orders**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, orders: [] }) })
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(new URL("mine.html", BASE).href, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(2800);
    await page.screenshot({ path: path.join(OUT, "accept-390-08-mine-app-layout.png"), fullPage: false });
    await page.setViewportSize({ width: 430, height: 932 });
    await page.screenshot({ path: path.join(OUT, "accept-430-08-mine-app-layout.png"), fullPage: false });
    await page.close();
  }

  // Support logged-in center
  {
    const page = await browser.newPage();
    await withBossSession(page);
    await page.route("**/api/auth**", async (route) => {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          user: { role: "boss", hasBoss: true, displayName: "截图预览老板", bossUid: "MCJ-DEMO" },
        }),
      });
    });
    await page.route("**/api/**", async (route) => {
      const url = route.request().url();
      if (/support|chat|conversation|customer-service|cs\//i.test(url)) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            serviceOnline: true,
            serviceStatus: "客服已接入",
            totalUnread: 1,
            conversations: [
              {
                id: "c1",
                customerServiceName: "妙脆角客服",
                consultType: "other",
                updatedAt: new Date().toISOString(),
                unread: 1,
                lastMessage: "您好，请问需要什么帮助？",
              },
            ],
            conversation: null,
            messages: [],
            orders: [],
          }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(new URL("support.html", BASE).href, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(3200);
    console.log("support url", page.url());
    await page.screenshot({ path: path.join(OUT, "accept-390-06-support.png"), fullPage: false });
    await page.setViewportSize({ width: 430, height: 932 });
    await page.screenshot({ path: path.join(OUT, "accept-430-06-support.png"), fullPage: false });
    await page.close();
  }

  // Home quick refresh key shots
  {
    const page = await browser.newPage();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(2200);
    await page.screenshot({ path: path.join(OUT, "accept-390-01-hero-stats.png"), fullPage: false });
    const banner = await page.$("[data-mcj-home-hero], .mcj-home-hero--promo");
    if (banner) {
      await banner.scrollIntoViewIfNeeded();
      await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(OUT, "accept-390-02-carousel.png"), fullPage: false });
    }
    const hot = await page.$("#hotCompanionTrack, .companion-hall");
    if (hot) {
      await hot.scrollIntoViewIfNeeded();
      await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(OUT, "accept-390-04-companions.png"), fullPage: false });
    }
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(OUT, "accept-390-05-tabbar.png"), fullPage: false });
    await page.close();
  }

  await browser.close();
  console.log("done");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
