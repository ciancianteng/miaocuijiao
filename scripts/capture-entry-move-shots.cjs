/**
 * Capture entry-move verification shots for PR #214.
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");

const BASE = process.env.PROTO_BASE || "http://127.0.0.1:5179/";
const OUT = path.join(__dirname, "..", "docs", "mobile-app-proto-screenshots");
fs.mkdirSync(OUT, { recursive: true });

async function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter(Boolean);
  for (const p of candidates) if (fs.existsSync(p)) return p;
  throw new Error("Chrome/Edge not found");
}

async function go(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1600);
  // Dismiss forced login modal if present so page entries are visible.
  const closed = await page.evaluate(() => {
    const close = document.querySelector('.modal.open .close, .dialog .close, [data-close], button[aria-label="关闭"]');
    if (close) {
      close.click();
      return true;
    }
    document.querySelectorAll(".modal.open").forEach((m) => {
      m.classList.remove("open");
      m.setAttribute("aria-hidden", "true");
    });
    return false;
  });
  if (closed) await page.waitForTimeout(400);
}

async function shot(page, name) {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

(async () => {
  const chrome = await findChrome();
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  // Acceptance shots only: do not run early-gate redirect so orders CTA is visible.
  await page.route("**/portal-early-gate.js*", (route) =>
    route.fulfill({ status: 200, contentType: "application/javascript", body: "/* shot bypass */" })
  );
  await page.route("**/role-gates.js*", (route) =>
    route.fulfill({ status: 200, contentType: "application/javascript", body: "/* shot bypass */" })
  );

  const report = { base: BASE, checks: {} };

  await go(page, BASE);
  await page.evaluate(() => window.scrollTo(0, Math.min(520, document.body.scrollHeight)));
  await page.waitForTimeout(400);
  await shot(page, "entry-390-01-home-no-quick.png");
  report.checks.home = await page.evaluate(() => {
    const text = document.body.innerText || "";
    return {
      hasQuickTitle: /快速入口|QUICK ACCESS/.test(text),
      hasFourCards:
        /陪玩大厅/.test(text) &&
        /自定义订单/.test(text) &&
        /组队大厅/.test(text) &&
        /更多玩法/.test(text) &&
        !!document.querySelector(".quick-entry-grid, .quick-entry-section"),
      clubLevel: !!document.querySelector(".club-level-entry-card"),
      quickCards: document.querySelectorAll(".quick-entry-card").length,
    };
  });

  await go(page, BASE.replace(/\/?$/, "/") + "companion-center.html");
  await shot(page, "entry-390-02-hall-secondary.png");
  report.checks.hall = await page.evaluate(() => ({
    team: !!document.querySelector('a[href="team-lobby.html"]'),
    more: !!document.querySelector('a[href="more-gameplays.html"]'),
    teamText: (document.querySelector('[data-hall-entry="team-lobby"] strong') || {}).textContent || "",
    moreText: (document.querySelector('[data-hall-entry="more-gameplays"] strong') || {}).textContent || "",
  }));

  // Verify navigation targets resolve (status)
  for (const rel of ["team-lobby.html", "more-gameplays.html", "custom-order.html", "companion-center.html"]) {
    const res = await page.request.get(BASE.replace(/\/?$/, "/") + rel);
    report.checks["http_" + rel] = res.status();
  }

  await page.goto(BASE.replace(/\/?$/, "/") + "team-lobby.html", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  await shot(page, "entry-390-03-team-lobby.png");

  await page.goto(BASE.replace(/\/?$/, "/") + "more-gameplays.html", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  await shot(page, "entry-390-04-more-gameplays.png");

  await go(page, BASE.replace(/\/?$/, "/") + "orders.html");
  await shot(page, "entry-390-05-orders-custom-cta.png");
  report.checks.orders = await page.evaluate(() => ({
    createCta: !!document.querySelector('a.orders-create-custom[href="custom-order.html"]'),
    createText: (document.querySelector(".orders-create-custom strong") || {}).textContent || "",
  }));

  await page.goto(BASE.replace(/\/?$/, "/") + "custom-order.html", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  await shot(page, "entry-390-06-custom-order.png");

  fs.writeFileSync(path.join(OUT, "entry-move-verify.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
