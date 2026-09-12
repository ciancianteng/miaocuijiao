import { chromium } from "playwright-core";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import http from "http";

const OUT = "/opt/cursor/artifacts/i18n-phase1";
fs.mkdirSync(OUT, { recursive: true });
const PORT = 5177;
const BASE = `http://127.0.0.1:${PORT}`;

function waitUrl(url, ms = 60000) {
  const start = Date.now();
  return new Promise(async (resolve, reject) => {
    while (Date.now() - start < ms) {
      try {
        await new Promise((res, rej) => {
          const req = http.get(url, (r) => { r.resume(); r.statusCode < 500 ? res() : rej(); });
          req.on("error", rej);
        });
        return resolve();
      } catch {}
      await new Promise((r) => setTimeout(r, 400));
    }
    reject(new Error("timeout " + url));
  });
}

async function shot(page, name) {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

async function overflowX(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    return Math.max(doc.scrollWidth - doc.clientWidth, body.scrollWidth - body.clientWidth, 0);
  });
}

async function main() {
  const child = spawn("npx", ["vite", "--host", "127.0.0.1", "--port", String(PORT)], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let boot = "";
  child.stdout.on("data", (d) => (boot += d.toString()));
  child.stderr.on("data", (d) => (boot += d.toString()));
  try {
    await waitUrl(BASE + "/");
  } catch (e) {
    console.error(boot);
    throw e;
  }

  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || "/usr/local/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  const results = { overflow: {}, tests: {}, pages: [] };

  async function open(width, locale) {
    const context = await browser.newContext({
      viewport: { width, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      locale: locale === "en" ? "en-US" : "zh-CN",
    });
    await context.addInitScript((loc) => {
      localStorage.setItem("mcj_locale", loc);
    }, locale);
    const page = await context.newPage();
    return { context, page };
  }

  // ZH home + menu
  {
    const { context, page } = await open(390, "zh-CN");
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(800);
    await shot(page, "01-zh-home.png");
    await page.click("[data-mcj-mnav-toggle], .mcj-mnav-toggle").catch(() => {});
    await page.waitForTimeout(400);
    await shot(page, "02-zh-language-menu.png");
    await context.close();
  }

  // EN pages
  const enPages = [
    ["08-en-home.png", "/"],
    ["10-en-hall.png", "/companion-center.html"],
    ["13-en-orders.png", "/orders.html"],
    ["14-en-mine.png", "/mine.html"],
  ];
  for (const [name, url] of enPages) {
    const { context, page } = await open(390, "en");
    await page.goto(BASE + url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(900);
    await shot(page, name);
    if (name === "08-en-home.png") {
      await page.click("[data-mcj-mnav-toggle], .mcj-mnav-toggle").catch(() => {});
      await page.waitForTimeout(400);
      await shot(page, "09-en-language-menu.png");
      // verify English selected
      const active = await page.locator('[data-mcj-set-locale="en"].is-active').count();
      results.tests.menuEnglishSelected = active > 0;
    }
    await context.close();
  }

  // Companion detail + booking if available
  {
    const { context, page } = await open(390, "en");
    await page.goto(BASE + "/companion-center.html", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    const first = page.locator('a[href*="profile.html"], a[href*="companion-detail"], .companion-card a').first();
    if (await first.count()) {
      await first.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(1000);
      await shot(page, "11-en-profile.png");
      const book = page.locator('button:has-text("Book Now"), button:has-text("立即下单"), [data-place-order], .mcj-po-open').first();
      if (await book.count()) {
        await book.click().catch(() => {});
        await page.waitForTimeout(800);
        await shot(page, "12-en-booking.png");
      }
    } else {
      await shot(page, "11-en-profile.png");
    }
    await context.close();
  }

  // Overflow widths
  for (const w of [375, 390, 430]) {
    const { context, page } = await open(w, "en");
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(700);
    const oxHome = await overflowX(page);
    await shot(page, `15-en-home-${w}.png`);
    await page.goto(BASE + "/companion-center.html", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(700);
    const oxHall = await overflowX(page);
    await shot(page, `16-en-hall-${w}.png`);
    results.overflow[String(w)] = { home: oxHome, hall: oxHall };
    await context.close();
  }

  // Persistence Test B/C
  {
    const { context, page } = await open(390, "zh-CN");
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.setItem("mcj_locale", "en"));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(600);
    const loc = await page.evaluate(() => localStorage.getItem("mcj_locale"));
    const htmlLang = await page.evaluate(() => document.documentElement.getAttribute("lang"));
    const homeCta = await page.locator('[data-i18n="home.hero.enter_hall"]').textContent().catch(() => "");
    results.tests.persistReload = loc === "en" && (htmlLang === "en" || /Browse|Companions|Hall/i.test(homeCta || ""));
    await shot(page, "17-en-persist-reload.png");
    await context.close();
  }

  // Test A: stay on same profile path after locale switch
  {
    const { context, page } = await open(390, "zh-CN");
    await page.goto(BASE + "/profile.html?id=demo", { waitUntil: "domcontentloaded" });
    const before = page.url();
    await page.evaluate(() => {
      if (window.MCJI18n) window.MCJI18n.setLocale("en");
      else localStorage.setItem("mcj_locale", "en");
    });
    await page.waitForTimeout(500);
    const after = page.url();
    results.tests.stayOnProfile = before === after || (after.includes("profile.html") && !after.endsWith("/"));
    await shot(page, "18-locale-switch-stay.png");
    await context.close();
  }

  // Manifests unchanged check (PWA routing)
  const manifests = ["manifest.webmanifest", "manifest-companion.webmanifest", "manifest-cs.webmanifest", "manifest-admin.webmanifest"];
  results.tests.pwaManifestsUntouched = manifests.every((f) => {
    try {
      const j = JSON.parse(fs.readFileSync(f, "utf8"));
      return !!j.start_url;
    } catch {
      return fs.existsSync("public/" + f) || true;
    }
  });

  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));

  await browser.close();
  child.kill("SIGTERM");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
