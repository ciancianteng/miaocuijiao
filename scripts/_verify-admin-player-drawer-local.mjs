/**
 * Local acceptance: admin companion detail drawer scrolls fully on iPhone viewport.
 * No deploy.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "artifacts", "local-admin-player-drawer-390");
const BASE = process.env.LOCAL_BASE || "http://127.0.0.1:5188";
fs.mkdirSync(path.join(OUT, "shots"), { recursive: true });

const suiteJs = fs.readFileSync(path.join(ROOT, "src/admin-suite.js"), "utf8");
const suiteCss = fs.readFileSync(path.join(ROOT, "src/admin-suite.css"), "utf8");
const mgmtCss = fs.readFileSync(path.join(ROOT, "src/admin-player-management.css"), "utf8");
const html = fs.readFileSync(path.join(ROOT, "admin.html"), "utf8");
const fails = [];
function check(cond, msg) {
  if (!cond) fails.push(msg);
}

check(/ensurePlayerDetailDrawer/.test(suiteJs), "drawer portal helper missing");
check(/document\.body\.appendChild\(drawer\)/.test(suiteJs), "drawer must mount on body");
check(!/<aside id="playerDetailDrawer"/.test(suiteJs), "drawer must not be nested in playerManagement HTML");
check(/player-drawer-open/.test(suiteJs) && /player-drawer-open/.test(suiteCss), "body scroll lock missing");
check(/z-index:\s*120000/.test(suiteCss), "drawer z-index must beat admin overlays");
check(/overflow:\s*visible/.test(mgmtCss), "playerManagement overflow must be visible");
check(/20261121playerDrawer1/.test(html), "admin cache bust missing");

if (fails.length) {
  console.error("STATIC FAIL\n" + fails.map((f) => "- " + f).join("\n"));
  process.exit(1);
}

const require = createRequire(import.meta.url);
let chromium;
try {
  chromium = require("playwright-core").chromium;
} catch {
  chromium = require("playwright").chromium;
}
function findChrome() {
  const base = path.join(process.env.LOCALAPPDATA || "", "ms-playwright");
  if (fs.existsSync(base)) {
    for (const d of fs.readdirSync(base)) {
      if (!d.startsWith("chromium-")) continue;
      for (const sub of ["chrome-win", "chrome-win64"]) {
        const exe = path.join(base, d, sub, "chrome.exe");
        if (fs.existsSync(exe)) return exe;
      }
    }
  }
  const edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  if (fs.existsSync(edge)) return edge;
  return null;
}

const exe = findChrome();
if (!exe) throw new Error("No chromium/edge");
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage();
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${BASE}/scripts/fixtures/admin-player-drawer-harness.html`, {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
await page.waitForFunction(() => window.__drawerHarness && window.__drawerHarness.scrollEl);

const metrics = await page.evaluate(async () => {
  const h = window.__drawerHarness;
  const scroller = h.scrollEl;
  const drawer = h.drawer;
  const before = {
    parentIsBody: drawer.parentElement === document.body,
    sectionCount: h.sectionCount,
    clientHeight: scroller.clientHeight,
    scrollHeight: scroller.scrollHeight,
    drawerHeight: drawer.getBoundingClientRect().height,
    viewport: window.innerHeight,
  };
  scroller.scrollTop = 0;
  await new Promise((r) => requestAnimationFrame(r));
  const topVisible = scroller.querySelector(".player-detail-section")?.querySelector("h3")?.textContent || "";
  scroller.scrollTop = scroller.scrollHeight;
  await new Promise((r) => requestAnimationFrame(r));
  const last = [...scroller.querySelectorAll(".player-detail-section")].pop();
  const lastRect = last.getBoundingClientRect();
  const drawerRect = drawer.getBoundingClientRect();
  return {
    before,
    topVisible,
    canScroll: before.scrollHeight > before.clientHeight + 40,
    lastBottomInsideDrawer: lastRect.bottom <= drawerRect.bottom + 8,
    scrollTop: scroller.scrollTop,
    maxScroll: scroller.scrollHeight - scroller.clientHeight,
  };
});

assert.equal(metrics.before.parentIsBody, true, "drawer parent must be body");
assert.ok(metrics.before.sectionCount >= 12, "all modules present");
assert.ok(metrics.canScroll, "drawer content must be scrollable");
assert.ok(metrics.scrollTop > 100, "must scroll toward bottom");
assert.ok(metrics.lastBottomInsideDrawer, "last module must be reachable inside drawer");

await page.evaluate(() => {
  window.__drawerHarness.scrollEl.scrollTop = 0;
});
await page.waitForTimeout(150);
await page.screenshot({ path: path.join(OUT, "shots", "01-drawer-top-390.png"), fullPage: false });
await page.evaluate(() => {
  const scroller = window.__drawerHarness.scrollEl;
  scroller.scrollTop = scroller.scrollHeight;
});
await page.waitForTimeout(200);
await page.screenshot({ path: path.join(OUT, "shots", "02-drawer-bottom-390.png"), fullPage: false });

await page.setViewportSize({ width: 1280, height: 900 });
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__drawerHarness && window.__drawerHarness.scrollEl);
const desktop = await page.evaluate(() => {
  const scroller = window.__drawerHarness.scrollEl;
  return {
    canScroll: scroller.scrollHeight > scroller.clientHeight + 20,
    parentIsBody: window.__drawerHarness.drawer.parentElement === document.body,
  };
});
assert.equal(desktop.parentIsBody, true);
await page.screenshot({ path: path.join(OUT, "shots", "03-drawer-desktop.png"), fullPage: false });

fs.writeFileSync(
  path.join(OUT, "report.json"),
  JSON.stringify({ ok: true, metrics, desktop, shots: fs.readdirSync(path.join(OUT, "shots")) }, null, 2)
);

await browser.close();

const build = spawn(
  process.platform === "win32" ? "npm.cmd" : "npm",
  ["run", "build"],
  { cwd: ROOT, stdio: "inherit", shell: true }
);
const buildCode = await new Promise((resolve) => build.on("exit", resolve));
assert.equal(buildCode, 0, "build failed");

console.log(JSON.stringify({ ok: true, out: OUT, canScroll: metrics.canScroll, sections: metrics.before.sectionCount }, null, 2));
