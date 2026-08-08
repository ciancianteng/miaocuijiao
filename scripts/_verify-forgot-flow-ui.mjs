import { chromium } from "playwright";

const STAGING = "https://meow-cuijiao-homepage-staging.vercel.app";
const PASS = "McjTest@12345678";
const CS = "service.final.1785714993009@meow.test";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

await page.goto(`${STAGING}/customer-service/login/`, { waitUntil: "networkidle" });
await page.click("[data-forgot-password]");
await page.waitForSelector(".mcj-forgot-card h2");

await page.fill('.mcj-forgot-card input[name="phone"]', CS);
const [sendResp] = await Promise.all([
  page.waitForResponse((r) => r.url().includes("/api/auth") && r.request().method() === "POST"),
  page.click('.mcj-forgot-card [data-forgot-submit]'),
]);
const sendJson = await sendResp.json();
if (!sendJson.ok || !sendJson.devCode) {
  console.log(JSON.stringify({ ok: false, step: "send", sendJson }, null, 2));
  await browser.close();
  process.exit(1);
}

await page.waitForSelector('.mcj-forgot-card input[name="code"]');
const countdownDisabled = await page.locator("[data-forgot-resend]").isDisabled();
await page.fill('.mcj-forgot-card input[name="code"]', sendJson.devCode);
await page.click('.mcj-forgot-card [data-forgot-submit]');
await page.waitForSelector('.mcj-forgot-card input[name="new_password"]');

await page.fill('.mcj-forgot-card input[name="new_password"]', PASS);
await page.fill('.mcj-forgot-card input[name="confirm_password"]', PASS);
const [resetResp] = await Promise.all([
  page.waitForResponse((r) => r.url().includes("/api/auth") && r.request().method() === "POST"),
  page.click('.mcj-forgot-card [data-forgot-submit]'),
]);
const resetJson = await resetResp.json();
await page.waitForTimeout(800);

const modalGone = await page.evaluate(() => {
  const host = document.querySelector("[data-mcj-forgot-host]");
  if (!host) return true;
  const closed =
    host.hidden === true ||
    host.getAttribute("hidden") !== null ||
    getComputedStyle(host).display === "none";
  return closed && !host.querySelector(".mcj-forgot-card");
});
const toastText = await page.locator(".mcj-forgot-toast").textContent().catch(() => "");

const login = await fetch(`${STAGING}/api/customer-service`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ action: "login", account: CS, password: PASS }),
}).then((r) => r.json());

console.log(
  JSON.stringify(
    {
      ok: !!(resetJson.ok && modalGone && login.ok && login.session?.token && /密码修改成功/.test(toastText || "")),
      countdownDisabled,
      channel: sendJson.channel,
      toast: (toastText || "").trim(),
      modalGone,
      loginOk: !!(login.ok && login.session?.token),
      resetJson,
    },
    null,
    2
  )
);

await browser.close();
