import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const root = process.cwd();
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};
const server = http.createServer((req, res) => {
  let u = decodeURIComponent((req.url || "/").split("?")[0]);
  if (u === "/admin/" || u === "/admin") u = "/admin.html";
  if (u.endsWith("/")) u += "index.html";
  const file = path.join(root, u.replace(/^\//, ""));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end("missing " + u); return;
  }
  res.writeHead(200, { "Content-Type": mime[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(8796, "127.0.0.1", r));
const base = "http://127.0.0.1:8796";
const browser = await chromium.launch({ headless: true });
const outDir = "/opt/cursor/artifacts/pwa-portal-start-urls";
fs.mkdirSync(outDir, { recursive: true });
const portals = [
  { key: "boss", start: "/", expectPathPrefix: "/", notBossOnly: false },
  { key: "companion", start: "/companion/", expectPathPrefix: "/companion/", notBossOnly: true },
  { key: "cs", start: "/customer-service/", expectPathPrefix: "/customer-service/", notBossOnly: true },
  { key: "admin", start: "/admin/", expectPathPrefix: "/admin", notBossOnly: true },
];
const results = [];
for (const p of portals) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    colorScheme: "dark",
    // Emulate installed PWA standalone launch
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  });
  await context.addInitScript(() => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (q) => {
        const standalone = String(q).includes("display-mode: standalone");
        return {
          matches: standalone ? true : false,
          media: q,
          onchange: null,
          addListener() {},
          removeListener() {},
          addEventListener() {},
          removeEventListener() {},
          dispatchEvent() { return false; },
        };
      },
    });
    Object.defineProperty(navigator, "standalone", { get: () => true });
  });
  const page = await context.newPage();
  const resp = await page.goto(base + p.start, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForTimeout(800);
  const info = await page.evaluate(() => ({
    href: location.href,
    pathname: location.pathname,
    displayStandalone: window.matchMedia("(display-mode: standalone)").matches,
    portalBoot: window.__MCJ_PWA_PORTAL__ || null,
    manifest: document.querySelector('link[rel="manifest"]')?.getAttribute("href") || null,
    title: document.title,
  }));
  const shot = path.join(outDir, p.key + "-standalone-launch.png");
  await page.screenshot({ path: shot, fullPage: false });
  const pathOk = info.pathname.startsWith(p.expectPathPrefix) || info.pathname === p.expectPathPrefix.replace(/\/$/, "");
  const notRewrittenToBoss =
    !p.notBossOnly || !(info.pathname === "/" || info.pathname === "/index.html");
  const ok = pathOk && notRewrittenToBoss && info.displayStandalone && resp && resp.ok();
  results.push({ ...p, ...info, status: resp?.status(), pathOk, notRewrittenToBoss, ok, screenshot: shot });
  await context.close();
}
await browser.close();
server.close();
fs.writeFileSync(path.join(outDir, "standalone-launch-results.json"), JSON.stringify({ ok: results.every((r) => r.ok), results }, null, 2));
console.log(JSON.stringify({ ok: results.every((r) => r.ok), results }, null, 2));
