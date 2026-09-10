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

(async () => {
  const token = fakeJwt();
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const page = await browser.newPage();
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

  await page.route("**/api/auth**", async (route) => {
    const req = route.request();
    const url = req.url();
    if (url.includes("action=me") || req.method() === "GET") {
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
            avatarUrl: "",
            hasPassword: true,
          },
          passwordHint: "",
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
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, orders: [] }),
    })
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(new URL("mine.html", BASE).href, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2800);
  console.log("url", page.url());
  await page.screenshot({ path: path.join(OUT, "accept-390-08-mine-app-layout.png"), fullPage: false });
  await page.setViewportSize({ width: 430, height: 932 });
  await page.screenshot({ path: path.join(OUT, "accept-430-08-mine-app-layout.png"), fullPage: false });
  await browser.close();
  console.log("done");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
