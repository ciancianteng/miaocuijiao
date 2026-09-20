const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");

const BASE = process.env.PROTO_BASE || "http://127.0.0.1:5180/";
const OUT = path.join(__dirname, "..", "docs", "mobile-app-proto-screenshots");
fs.mkdirSync(OUT, { recursive: true });

async function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter(Boolean);
  for (const p of candidates) if (fs.existsSync(p)) return p;
  throw new Error("Chrome/Edge not found");
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

  await page.addInitScript(() => {
    // Stay on support.html for UI shots (no redirect to #login).
    window.MCJModal = { openLogin: function () {} };
    window.MCJAuthContinue = { requireLogin: function () {} };
  });

  await page.route("**/portal-early-gate.js*", (route) =>
    route.fulfill({ status: 200, contentType: "application/javascript", body: "/* shot bypass */" })
  );
  await page.route("**/role-gates.js*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: "window.MCJRoleGate={logout:function(){},require:function(){return true;},isLogged:function(){return false;}};",
    })
  );

  await page.goto(BASE.replace(/\/?$/, "/") + "support.html", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForSelector("[data-discord-community-cta]", { timeout: 15000 });
  await page.waitForTimeout(800);

  const report = await page.evaluate(() => {
    const card = document.querySelector("[data-discord-community-cta]");
    const contact = document.querySelector("[data-contact-service]");
    return {
      url: location.href,
      hasDiscordCard: !!card,
      isSoon: !!(card && card.classList.contains("is-soon")),
      title: (card && card.querySelector("strong") && card.querySelector("strong").textContent) || "",
      subtitle:
        (card &&
          card.querySelector(".mcj-discord-cta-copy > span") &&
          card.querySelector(".mcj-discord-cta-copy > span").textContent) ||
        "",
      hint: (card && card.querySelector("em") && card.querySelector("em").textContent) || "",
      hasCsButton: !!contact,
      csText: (contact && contact.textContent.trim()) || "",
    };
  });

  await page.screenshot({ path: path.join(OUT, "discord-390-support-cta.png"), fullPage: false });
  fs.writeFileSync(path.join(OUT, "discord-cta-verify.json"), JSON.stringify({ base: BASE, report }, null, 2));
  console.log(JSON.stringify({ base: BASE, report }, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
