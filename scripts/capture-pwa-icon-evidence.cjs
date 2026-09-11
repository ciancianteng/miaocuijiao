/**
 * Lightweight PWA icon + install-sheet evidence capture.
 * Static-serves repo root (public/ assets) via Node http; no Vite required.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const { chromium } = require("playwright-core");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "docs", "pwa-install-accept");
const PORT = 5188;
const BASE = `http://127.0.0.1:${PORT}`;

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(path.join(OUT, "icon-previews"), { recursive: true });

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

function resolveFile(urlPath) {
  let p = decodeURIComponent(urlPath.split("?")[0]);
  if (p === "/") p = "/index.html";
  // Prefer public/ for site-root statics
  const publicCandidate = path.join(ROOT, "public", p.replace(/^\//, ""));
  if (fs.existsSync(publicCandidate) && fs.statSync(publicCandidate).isFile()) {
    return publicCandidate;
  }
  const rootCandidate = path.join(ROOT, p.replace(/^\//, ""));
  if (fs.existsSync(rootCandidate) && fs.statSync(rootCandidate).isFile()) {
    return rootCandidate;
  }
  return null;
}

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const file = resolveFile(req.url || "/");
      if (!file) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("404");
        return;
      }
      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

function findChrome() {
  const local = process.env.LOCALAPPDATA || "";
  const candidates = [
    process.env.CHROME_PATH,
    path.join(local, "ms-playwright", "chromium-1148", "chrome-win", "chrome.exe"),
    path.join(local, "ms-playwright", "chromium-1148", "chrome-win64", "chrome.exe"),
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
}

async function getJsonSafe(url) {
  const r = await fetch(url);
  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (_) {}
  return { status: r.status, contentType: r.headers.get("content-type"), text, json };
}

async function probe(url) {
  const r = await fetch(url);
  const ct = String(r.headers.get("content-type") || "");
  const buf = Buffer.from(await r.arrayBuffer());
  return { status: r.status, contentType: ct, bytes: buf.length, ok: r.status === 200 };
}

async function main() {
  const chrome = findChrome();
  if (!chrome) throw new Error("Chrome/Edge not found");
  const server = await startServer();

  const results = {
    ok: false,
    generatedAt: new Date().toISOString(),
    base: BASE,
    environment: "local-static",
    iconChecklist: {},
    checks: {},
    screenshots: {},
    passFail: {},
    notes: {
      letterMOnProduction:
        "Production TODAY shows letter M because /icons/* + /manifest.webmanifest 404 — browser falls back to a text glyph from the site name. This PR ships official cat app icons. After merge, users must delete the old home-screen icon and re-add.",
      productionExpectedUntilMerge:
        "Production icon/manifest 404 is expected until this PR merges. Preview must be 200.",
    },
    errors: [],
  };

  try {
    const iconPaths = [
      "/icons/icon-192.png",
      "/icons/icon-512.png",
      "/icons/icon-192-maskable.png",
      "/icons/icon-512-maskable.png",
      "/icons/apple-touch-icon.png",
      "/apple-touch-icon.png",
      "/favicon-32.png",
      "/favicon.ico",
      "/manifest.webmanifest",
      "/sw-mcj.js",
    ];
    for (const p of iconPaths) {
      const info = await probe(BASE + p);
      const isImg = p.endsWith(".png") || p.endsWith(".ico");
      results.iconChecklist[p] = {
        ...info,
        ok: info.status === 200 && (!isImg || /image\//.test(info.contentType) || info.bytes > 100),
      };
    }

    const man = await getJsonSafe(BASE + "/manifest.webmanifest");
    results.manifest = man.json;
    results.checks.manifestStatus = man.status;
    results.checks.manifestHasSeparateMaskable = !!(
      man.json &&
      (man.json.icons || []).some(
        (i) => i.purpose === "maskable" && String(i.src || "").includes("maskable")
      )
    );
    results.checks.manifestHasAny = !!(
      man.json && (man.json.icons || []).some((i) => i.purpose === "any")
    );

    fs.writeFileSync(
      path.join(OUT, "manifest.json"),
      JSON.stringify(man.json || { parseError: true, preview: (man.text || "").slice(0, 200) }, null, 2),
      "utf8"
    );

    const browser = await chromium.launch({ executablePath: chrome, headless: true });

    // iOS install sheet
    const iosCtx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      hasTouch: true,
      isMobile: true,
      locale: "zh-CN",
    });
    const ios = await iosCtx.newPage();
    await ios.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await ios.waitForTimeout(800);
    // Inject prompt assets if boss-header path is heavy — load CSS/JS directly
    await ios.addStyleTag({ url: BASE + "/src/pwa-install-prompt.css?v=20260911pwaIcon2" });
    await ios.addScriptTag({ url: BASE + "/src/pwa-install-prompt.js?v=20260911pwaIcon2" });
    await ios.waitForTimeout(400);
    await ios.evaluate(() => {
      if (window.MCJPwaInstall) window.MCJPwaInstall.open({ force: true });
    });
    await ios.waitForSelector(".mcj-pwa-root.is-open", { timeout: 8000 });
    const iosShot = path.join(OUT, "ios-home-teach.png");
    await ios.screenshot({ path: iosShot, fullPage: false });
    results.screenshots["ios-home-teach.png"] = iosShot;
    const iosText = await ios.locator(".mcj-pwa-sheet").innerText();
    results.checks.iosHomeTeach = /分享|主屏幕|Safari/.test(iosText);
    // logo visible
    const logoOk = await ios.evaluate(() => {
      const img = document.querySelector(".mcj-pwa-logo");
      return !!(img && img.complete && img.naturalWidth > 0);
    });
    results.checks.iosSheetShowsCatLogo = logoOk;
    await iosCtx.close();

    // Android install UI
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
      class BeforeInstallPromptEvent extends Event {
        constructor(type) {
          super(type, { cancelable: true });
          this.userChoice = Promise.resolve({ outcome: "dismissed", platform: "web" });
        }
        prompt() {
          return Promise.resolve();
        }
      }
      window.addEventListener("DOMContentLoaded", () => {
        setTimeout(() => window.dispatchEvent(new BeforeInstallPromptEvent("beforeinstallprompt")), 200);
      });
    });
    await and.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await and.addStyleTag({ url: BASE + "/src/pwa-install-prompt.css?v=20260911pwaIcon2" });
    await and.addScriptTag({ url: BASE + "/src/pwa-install-prompt.js?v=20260911pwaIcon2" });
    await and.waitForTimeout(600);
    await and.evaluate(() => window.MCJPwaInstall && window.MCJPwaInstall.open({ force: true }));
    await and.waitForSelector(".mcj-pwa-root.is-open", { timeout: 8000 });
    const andShot = path.join(OUT, "android-install-ui.png");
    await and.screenshot({ path: andShot, fullPage: false });
    results.screenshots["android-install-ui.png"] = andShot;
    const andText = await and.locator(".mcj-pwa-sheet").innerText();
    results.checks.androidHasInstallOrTeach = /安装|Chrome|主屏幕|菜单/.test(andText);
    results.checks.androidSheetShowsCatLogo = await and.evaluate(() => {
      const img = document.querySelector(".mcj-pwa-logo");
      return !!(img && img.complete && img.naturalWidth > 0);
    });
    await andCtx.close();
    await browser.close();

    results.passFail = {
      iOS_appleTouchIcon: results.iconChecklist["/apple-touch-icon.png"]?.ok ? "PASS" : "FAIL",
      iOS_installSheetCatLogo: results.checks.iosSheetShowsCatLogo ? "PASS" : "FAIL",
      Android_maskableIcons: results.iconChecklist["/icons/icon-512-maskable.png"]?.ok
        ? "PASS"
        : "FAIL",
      Android_installSheet: results.checks.androidHasInstallOrTeach ? "PASS" : "FAIL",
      Manifest_anyPlusMaskable:
        results.checks.manifestHasAny && results.checks.manifestHasSeparateMaskable
          ? "PASS"
          : "FAIL",
      Maskable_safeZoneEvidence: fs.existsSync(
        path.join(OUT, "icon-previews", "maskable-512-circle-overlay.png")
      )
        ? "PASS"
        : "FAIL",
      Favicon32: results.iconChecklist["/favicon-32.png"]?.ok ? "PASS" : "FAIL",
      Production_untilMerge: "EXPECTED_404 (icons not live until merge)",
    };

    results.ok = Object.entries(results.passFail)
      .filter(([k]) => k !== "Production_untilMerge")
      .every(([, v]) => v === "PASS");

    const readme = `# PWA install + official cat app icons — acceptance

## Why Production shows letter "M" TODAY
Production \`/icons/*\` and \`/manifest.webmanifest\` still **404** until this PR merges. Browsers fall back to a monochrome letter glyph from the site name. **Not a design choice.**

After merge: delete the old home-screen icon and re-add 妙脆角 to pick up the official cat logo.

## Icon set (official source: \`/og/meowcuijiao-logo-transparent.png\`)
- any: \`/icons/icon-192.png\`, \`/icons/icon-512.png\` (brand purple-black gradient, ~11% pad)
- maskable: \`/icons/icon-*-maskable.png\` (~20% safe zone)
- iOS: \`/apple-touch-icon.png\` + \`/icons/apple-touch-icon.png\` (180)
- favicon: \`/favicon-32.png\`, \`/favicon.ico\`

## Evidence
- icon-previews/* (including maskable circle overlay)
- ios-home-teach.png / android-install-ui.png (install sheet with cat logo)
- verify.json (this run checklist)

Regenerate icons: \`node scripts/build-pwa-icons.cjs\`
`;
    fs.writeFileSync(path.join(OUT, "README.md"), readme, "utf8");
    fs.writeFileSync(path.join(OUT, "verify.json"), JSON.stringify(results, null, 2), "utf8");
    console.log(JSON.stringify(results, null, 2));
  } catch (e) {
    results.errors.push(String(e && e.stack ? e.stack : e));
    fs.writeFileSync(path.join(OUT, "verify.json"), JSON.stringify(results, null, 2), "utf8");
    console.error(e);
    process.exitCode = 1;
  } finally {
    server.close();
  }
}

main();
