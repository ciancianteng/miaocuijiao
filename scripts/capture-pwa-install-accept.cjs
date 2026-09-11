/**
 * PWA install prompt acceptance — local Vite + Playwright.
 */
const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const http = require("http");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "docs", "pwa-install-accept");
const PORT = 5188;
const BASE = `http://127.0.0.1:${PORT}`;

fs.mkdirSync(OUT, { recursive: true });

function httpGet(urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.get(BASE + urlPath, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks),
        });
      });
    });
    req.on("error", reject);
    req.setTimeout(15000, () => {
      req.destroy(new Error("timeout " + urlPath));
    });
  });
}

async function waitReady(ms = 90000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const r = await httpGet("/");
      if (r.status && r.status < 500) return;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("vite not ready");
}

function findChrome() {
  const local = process.env.LOCALAPPDATA || "";
  const candidates = [
    process.env.CHROME_PATH,
    path.join(local, "ms-playwright", "chromium-1148", "chrome-win", "chrome.exe"),
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  const root = path.join(local, "ms-playwright");
  if (!fs.existsSync(root)) return null;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      let st;
      try {
        st = fs.statSync(full);
      } catch (_) {
        continue;
      }
      if (st.isDirectory()) stack.push(full);
      else if (/^chrome\.exe$/i.test(name)) return full;
    }
  }
  return null;
}

async function shot(page, name) {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, fullPage: false });
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

async function openForce(page) {
  await page.waitForFunction(() => !!(window.MCJPwaInstall && window.MCJPwaInstall.open), null, {
    timeout: 20000,
  });
  await page.evaluate(() => window.MCJPwaInstall.open({ force: true }));
  await page.waitForSelector(".mcj-pwa-root.is-open", { timeout: 10000 });
}

async function main() {
  const chrome = findChrome();
  if (!chrome) throw new Error("Chrome not found");
  console.log("chrome", chrome);

  const viteBin = path.join(ROOT, "node_modules", "vite", "bin", "vite.js");
  const vite = spawn(process.execPath, [viteBin, "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, BROWSER: "none" },
  });
  let viteLog = "";
  vite.stdout.on("data", (d) => {
    viteLog += d.toString();
    process.stdout.write(d);
  });
  vite.stderr.on("data", (d) => {
    viteLog += d.toString();
    process.stderr.write(d);
  });

  const results = {
    ok: false,
    base: BASE,
    pr: 219,
    previewUrl: "https://meow-cuijiao-homepage-git-fe-0957cc-ciancianteng-4581s-projects.vercel.app",
    checks: {},
    screenshots: {},
    manifest: null,
    errors: [],
  };

  const cleanup = () => {
    try {
      vite.kill("SIGTERM");
    } catch (_) {}
  };
  process.on("exit", cleanup);

  try {
    await waitReady();

    const man = await httpGet("/manifest.webmanifest");
    results.checks.manifestStatus = man.status;
    const manText = man.body.toString("utf8");
    try {
      results.manifest = JSON.parse(manText);
    } catch (e) {
      results.errors.push("manifest parse: " + manText.slice(0, 200));
      throw e;
    }
    fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(results.manifest, null, 2));

    results.checks.swStatus = (await httpGet("/sw-mcj.js")).status;
    results.checks.icon192 = (await httpGet("/icons/icon-192.png")).status;
    results.checks.icon512 = (await httpGet("/icons/icon-512.png")).status;
    results.checks.appleIcon = (await httpGet("/icons/apple-touch-icon.png")).status;

    const browser = await chromium.launch({ executablePath: chrome, headless: true });

    // iOS
    const iosCtx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      hasTouch: true,
      isMobile: true,
      locale: "zh-CN",
    });
    const ios = await iosCtx.newPage();

    async function iosForce(urlPath, file) {
      await ios.goto(BASE + urlPath, { waitUntil: "domcontentloaded", timeout: 60000 });
      await openForce(ios);
      results.screenshots[file] = await shot(ios, file);
      return await ios.locator(".mcj-pwa-sheet").innerText();
    }

    results.checks.iosHomeTeach = /分享|主屏幕|Safari/.test(await iosForce("/", "ios-home-teach.png"));
    results.checks.iosHallTeach = /分享|主屏幕/.test(
      await iosForce("/companion-center.html", "ios-hall-teach.png")
    );
    results.checks.iosProfileTeach = /分享|主屏幕/.test(
      await iosForce("/profile.html?id=1", "ios-profile-teach.png")
    );

    await ios.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    await ios.evaluate(() => {
      localStorage.removeItem("mcj_pwa_installed");
      localStorage.setItem("mcj_pwa_prompt_dismissed_at", String(Date.now()));
      localStorage.setItem("mcj_pwa_prompt_count", "1");
    });
    await ios.reload({ waitUntil: "domcontentloaded" });
    await ios.waitForTimeout(4200);
    results.checks.dismissNoAutoWithin7d = !(await ios.evaluate(
      () => !!document.querySelector(".mcj-pwa-root.is-open")
    ));
    results.screenshots["ios-dismiss-no-auto.png"] = await shot(ios, "ios-dismiss-no-auto.png");

    await ios.evaluate(() => {
      localStorage.setItem("mcj_pwa_installed", "1");
      localStorage.removeItem("mcj_pwa_prompt_dismissed_at");
    });
    await ios.reload({ waitUntil: "domcontentloaded" });
    await ios.waitForTimeout(4200);
    results.checks.installedNoAuto = !(await ios.evaluate(
      () => !!document.querySelector(".mcj-pwa-root.is-open")
    ));
    results.screenshots["ios-installed-no-auto.png"] = await shot(ios, "ios-installed-no-auto.png");

    const standaloneMark = await ios.evaluate(() => {
      const real = window.matchMedia.bind(window);
      window.matchMedia = function (q) {
        if (String(q).includes("display-mode: standalone")) {
          return {
            matches: true,
            media: q,
            addListener() {},
            removeListener() {},
            addEventListener() {},
            removeEventListener() {},
            onchange: null,
            dispatchEvent() {
              return false;
            },
          };
        }
        return real(q);
      };
      const standalone = window.MCJPwaInstall.isStandalone();
      if (standalone) window.MCJPwaInstall.markInstalled();
      return { isStandalone: standalone, installed: localStorage.getItem("mcj_pwa_installed") };
    });
    results.checks.standaloneSetsInstalled =
      standaloneMark.isStandalone === true && standaloneMark.installed === "1";
    results.screenshots["ios-standalone-emulated.png"] = await shot(ios, "ios-standalone-emulated.png");
    await iosCtx.close();

    // Android + BIP stub
    const andCtx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      userAgent:
        "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
      hasTouch: true,
      isMobile: true,
      locale: "zh-CN",
    });
    const and = await andCtx.newPage();
    await and.addInitScript(() => {
      localStorage.clear();
      class BeforeInstallPromptEvent extends Event {
        constructor() {
          super("beforeinstallprompt", { cancelable: true });
          this.userChoice = Promise.resolve({ outcome: "dismissed", platform: "web" });
        }
        prompt() {
          return Promise.resolve();
        }
      }
      const fire = () => window.dispatchEvent(new BeforeInstallPromptEvent());
      window.addEventListener("load", () => setTimeout(fire, 200));
      document.addEventListener("DOMContentLoaded", () => setTimeout(fire, 200));
    });
    await and.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    await and.waitForTimeout(1800);
    await openForce(and);
    const andText = await and.locator(".mcj-pwa-sheet").innerText();
    results.checks.androidHasInstallOrTeach = /安装|Chrome|主屏幕|菜单/.test(andText);
    results.screenshots["android-install-ui.png"] = await shot(and, "android-install-ui.png");

    const and2 = await andCtx.newPage();
    await and2.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    await openForce(and2);
    results.checks.androidTeachFallback = /Chrome|菜单|主屏幕|安装/.test(
      await and2.locator(".mcj-pwa-sheet").innerText()
    );
    results.screenshots["android-teach-fallback.png"] = await shot(and2, "android-teach-fallback.png");
    await andCtx.close();
    await browser.close();

    results.ok =
      results.checks.manifestStatus === 200 &&
      results.checks.swStatus === 200 &&
      results.checks.icon192 === 200 &&
      results.checks.iosHomeTeach &&
      results.checks.iosHallTeach &&
      results.checks.dismissNoAutoWithin7d &&
      results.checks.installedNoAuto &&
      results.checks.standaloneSetsInstalled &&
      results.checks.androidHasInstallOrTeach;

    fs.writeFileSync(path.join(OUT, "verify.json"), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results, null, 2));
  } catch (e) {
    results.errors.push(String(e && e.stack ? e.stack : e));
    fs.writeFileSync(path.join(OUT, "verify.json"), JSON.stringify(results, null, 2));
    console.error(e);
    process.exitCode = 1;
  } finally {
    cleanup();
    setTimeout(() => process.exit(process.exitCode || 0), 500);
  }
}

main();
