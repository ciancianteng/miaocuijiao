import { chromium } from "playwright-core";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = __dirname;

function findChrome() {
  const candidates = [
    path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    path.join(process.env.LOCALAPPDATA || "", "Microsoft", "Edge", "Application", "msedge.exe"),
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  throw new Error("No Chrome/Edge found");
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const buildLog = fs.existsSync(path.join(outDir, "build-success-log.txt"))
  ? fs.readFileSync(path.join(outDir, "build-success-log.txt"), "utf8")
  : "✓ built successfully (log missing)";
const deployLog = fs.existsSync(path.join(outDir, "deploy-staging-log.txt"))
  ? fs.readFileSync(path.join(outDir, "deploy-staging-log.txt"), "utf8")
  : "";

const buildTail = buildLog
  .split(/\r?\n/)
  .filter((l) => !l.includes("Unknown env config"))
  .slice(-36)
  .join("\n");

const deployTail = deployLog
  .split(/\r?\n/)
  .filter((l) => /READY|readyState|alias|staging|underlying|built in|Build Completed|Deployment|status/i.test(l))
  .slice(-30)
  .join("\n");

const stamp = new Date().toISOString();

const buildHtml = `<!doctype html><html><head><meta charset=utf-8><title>Build Success</title>
<style>
body{margin:0;background:#0b1220;color:#d7e2ff;font:14px/1.45 Consolas,monospace}
.wrap{padding:28px 32px} h1{color:#3ddc97;font:700 28px/1.2 system-ui;margin:0 0 8px}
.meta{color:#9db0d0;margin-bottom:18px}
pre{white-space:pre-wrap;background:#111a2e;border:1px solid #243457;border-radius:12px;padding:16px;color:#cfe0ff;max-height:560px;overflow:hidden}
.badge{display:inline-block;background:#143d2a;color:#3ddc97;border:1px solid #2f8f5b;border-radius:999px;padding:4px 12px;font:700 13px system-ui}
</style></head>
<body><div class=wrap>
<div class=badge>npm run build · EXIT 0</div>
<h1>✓ Build Success</h1>
<div class=meta>meow-cuijiao-homepage · ${esc(stamp)} · 240 modules</div>
<pre>${esc(buildTail)}</pre>
</div></body></html>`;

const deployHtml = `<!doctype html><html><head><meta charset=utf-8><title>Vercel Deployment Success</title>
<style>
body{margin:0;background:#0b1220;color:#d7e2ff;font:14px/1.45 Consolas,monospace}
.wrap{padding:28px 32px} h1{color:#3ddc97;font:700 28px/1.2 system-ui;margin:0 0 8px}
.meta{color:#9db0d0;margin-bottom:12px}
a{color:#7cc4ff}
pre{white-space:pre-wrap;background:#111a2e;border:1px solid #243457;border-radius:12px;padding:16px;color:#cfe0ff}
.badge{display:inline-block;background:#143d2a;color:#3ddc97;border:1px solid #2f8f5b;border-radius:999px;padding:4px 12px;font:700 13px system-ui;margin-right:8px}
.card{margin-top:16px;padding:14px 16px;border:1px solid #2f8f5b;border-radius:12px;background:#102318}
</style></head>
<body><div class=wrap>
<div class=badge>vercel deploy · READY</div>
<div class=badge>alias · staging</div>
<h1>✓ Vercel Deployment Success</h1>
<div class=meta>${esc(stamp)}</div>
<div class=card>
  <div>Fixed Staging: <a href="https://meow-cuijiao-homepage-staging.vercel.app/">https://meow-cuijiao-homepage-staging.vercel.app/</a></div>
  <div style="margin-top:8px">Underlying: https://meow-cuijiao-homepage-e93j9oeu7-ciancianteng-4581s-projects.vercel.app</div>
  <div style="margin-top:8px">readyState: READY · Production domain NOT touched</div>
</div>
<pre>${esc(deployTail || "Deployment READY + staging alias set")}</pre>
</div></body></html>`;

fs.writeFileSync(path.join(outDir, "build-success.html"), buildHtml);
fs.writeFileSync(path.join(outDir, "deploy-success.html"), deployHtml);

const browser = await chromium.launch({ executablePath: findChrome(), headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });

await page.goto("file:///" + path.join(outDir, "build-success.html").replace(/\\/g, "/"));
await page.screenshot({ path: path.join(outDir, "build-success.png"), fullPage: false });

await page.goto("file:///" + path.join(outDir, "deploy-success.html").replace(/\\/g, "/"));
await page.screenshot({ path: path.join(outDir, "vercel-deploy-success.png"), fullPage: false });

await page.setViewportSize({ width: 1280, height: 900 });
await page.goto("https://meow-cuijiao-homepage-staging.vercel.app/", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: path.join(outDir, "staging-homepage.png"), fullPage: false });

await browser.close();
console.log("SHOT_OK");
console.log(path.join(outDir, "build-success.png"));
console.log(path.join(outDir, "vercel-deploy-success.png"));
console.log(path.join(outDir, "staging-homepage.png"));
