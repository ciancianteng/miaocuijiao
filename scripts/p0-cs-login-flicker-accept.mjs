/**
 * CS login anti-flicker accept on fixed Staging (Playwright).
 * Usage: node scripts/p0-cs-login-flicker-accept.mjs
 */
import { chromium } from "playwright";

const STAGING = (process.env.MCJ_STAGING_URL || "https://meow-cuijiao-homepage-staging.vercel.app").replace(
  /\/$/,
  ""
);
const PASS = process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const CS = process.env.E2E_CS_EMAIL || "service.final.1785714993009@meow.test";
const LOGIN = `${STAGING}/customer-service/login/`;
const DASH = `${STAGING}/customer-service/dashboard/`;

const results = [];
function step(name, ok, detail) {
  results.push({ name, ok, detail: String(detail || "") });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
  return ok;
}

async function main() {
  console.log("STAGING", STAGING);
  const browser = await chromium.launch({ headless: true });
  const resultsMobile = [];
  try {
    for (const mode of ["pc", "mobile"]) {
      const context = await browser.newContext(
        mode === "mobile"
          ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
          : { viewport: { width: 1280, height: 800 } }
      );
      const page = await context.newPage();
      const navigations = [];
      page.on("framenavigated", (frame) => {
        if (frame === page.mainFrame()) navigations.push(frame.url());
      });

      // Seed a broken half-session that previously caused login↔dashboard flicker.
      await page.goto(LOGIN, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.evaluate(() => {
        localStorage.setItem(
          "mcjServiceSession",
          JSON.stringify({
            token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.invalid",
            refreshToken: "stale-refresh",
            user: { role: "customer_service", email: "x@test" },
          })
        );
        localStorage.setItem("mcjRole", "customer_service");
        localStorage.removeItem("customerServiceAuthToken");
      });
      navigations.length = 0;
      await page.goto(LOGIN, { waitUntil: "networkidle", timeout: 60000 });
      await page.waitForTimeout(3500);
      const bounce = navigations.filter((u) => /customer-service\/(login|dashboard)/i.test(u)).length;
      const onLogin = /\/customer-service\/login/i.test(page.url());
      const accountVisible = await page.locator('input[name="account"]').isVisible().catch(() => false);
      step(`${mode} no redirect loop after half-session`, onLogin && bounce <= 2, `url=${page.url()} navs=${bounce}`);
      step(`${mode} login form visible`, accountVisible, `visible=${accountVisible}`);

      // Clear and type credentials.
      await page.evaluate(() => {
        try {
          localStorage.clear();
          sessionStorage.clear();
        } catch (e) {}
      });
      await page.goto(LOGIN, { waitUntil: "networkidle", timeout: 60000 });
      await page.waitForTimeout(1200);
      const beforeType = page.url();
      await page.fill('input[name="account"]', CS);
      await page.fill('input[name="password"]', PASS);
      const typedAccount = await page.inputValue('input[name="account"]');
      const typedPass = await page.inputValue('input[name="password"]');
      await page.waitForTimeout(1500);
      const stillTyped =
        (await page.inputValue('input[name="account"]')) === typedAccount &&
        (await page.inputValue('input[name="password"]')) === typedPass;
      const urlStable = page.url() === beforeType || /\/customer-service\/login/i.test(page.url());
      step(`${mode} can type without flicker wipe`, stillTyped && urlStable, `account=${typedAccount} url=${page.url()}`);

      navigations.length = 0;
      await Promise.all([
        page.waitForURL(/\/customer-service\/dashboard/i, { timeout: 45000 }).catch(() => null),
        page.click('button[type="submit"]'),
      ]);
      await page.waitForTimeout(2000);
      const loggedIn = /\/customer-service\/dashboard/i.test(page.url());
      step(`${mode} login enters workbench`, loggedIn, `url=${page.url()}`);

      if (loggedIn) {
        await page.reload({ waitUntil: "networkidle", timeout: 60000 });
        await page.waitForTimeout(2000);
        const stayed = /\/customer-service\/dashboard/i.test(page.url());
        step(`${mode} refresh keeps session`, stayed, `url=${page.url()}`);
        // Ensure not bounced back to login after settle
        await page.waitForTimeout(2500);
        step(
          `${mode} no auto return to login`,
          /\/customer-service\/dashboard/i.test(page.url()),
          `url=${page.url()}`
        );
      } else {
        step(`${mode} refresh keeps session`, false, "skipped — login failed");
        step(`${mode} no auto return to login`, false, "skipped — login failed");
      }

      await context.close();
      resultsMobile.push(mode);
    }
  } finally {
    await browser.close();
  }

  const passed = results.every((r) => r.ok);
  console.log(`CS_LOGIN_FLICKER_${passed ? "PASS" : "FAIL"} ${results.filter((r) => r.ok).length}/${results.length}`);
  process.exit(passed ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
