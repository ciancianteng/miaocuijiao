/**
 * Local verify: shared chat VV pin + focus-based keyboard mode (boss + CS).
 * Covers the iOS inset=0 case that previously left the composer off-screen.
 * No deploy.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "artifacts", "local-chat-vv-focus-390");
const BASE = process.env.LOCAL_BASE || "http://127.0.0.1:5188";
fs.mkdirSync(OUT, { recursive: true });
const fails = [];
function check(cond, msg) {
  if (!cond) fails.push(msg);
}

const scrollKeep = fs.readFileSync(path.join(ROOT, "src/scroll-keep.js"), "utf8");
const csJs = fs.readFileSync(path.join(ROOT, "src/customer-service-v2.js"), "utf8");
const csCss = fs.readFileSync(path.join(ROOT, "src/customer-service-v2.css"), "utf8");
const bossJs = fs.readFileSync(path.join(ROOT, "src/support-chat.js"), "utf8");
const bossCss = fs.readFileSync(path.join(ROOT, "src/support-chat.css"), "utf8");
const supportHtml = fs.readFileSync(path.join(ROOT, "support.html"), "utf8");
const csHtml = fs.readFileSync(path.join(ROOT, "customer-service/conversations/index.html"), "utf8");

check(/export function isChatKeyboardOpen/.test(scrollKeep), "scroll-keep missing isChatKeyboardOpen");
check(/lock \? "0px"/.test(scrollKeep) || /lock \? '0px'/.test(scrollKeep), "locked shells must zero keyboard-inset");
check(/querySelectorAll\(shellSel\)/.test(scrollKeep), "applyVisualViewportCss must pin all shell matches");
check(/isChatKeyboardOpen/.test(csJs), "CS JS must use isChatKeyboardOpen");
check(/isChatKeyboardOpen/.test(bossJs), "boss JS must use isChatKeyboardOpen");
check(!/kbOpen=lock&&box\.inset>0/.test(csJs), "CS must not gate kbOpen on inset alone");
check(!/kbOpen = lock && box\.inset > 0/.test(bossJs), "boss must not gate kbOpen on inset alone");
check(/position:\s*relative/.test(csCss) && !/Keep chat composer above bottom nav[\s\S]*position:\s*sticky/.test(csCss), "CS composer must not be sticky");
check(/html\.cs-chat-lock\{--cs-keyboard-inset:0px/.test(csCss), "CS lock must zero keyboard-inset CSS var");
check(/20261121chatVvFocus1/.test(supportHtml), "support.html cache bust");
check(/20261121chatVvFocus1/.test(csHtml), "CS conversations cache bust");

const mod = await import(pathToFileURL(path.join(ROOT, "src/scroll-keep.js")).href);
assert.equal(mod.isChatKeyboardOpen({ lock: true, focused: true, inset: 0 }), true, "focus+inset0 => open");
assert.equal(mod.isChatKeyboardOpen({ lock: true, focused: false, inset: 0 }), false, "blur+inset0 => closed");
assert.equal(mod.isChatKeyboardOpen({ lock: true, focused: false, inset: 320 }), true, "blur+inset residual => open");
assert.equal(mod.isChatKeyboardOpen({ lock: false, focused: true, inset: 320 }), false, "unlocked => closed");
assert.equal(mod.keyboardInsetPx({ innerHeight: 420, visualViewport: { height: 420, offsetTop: 0 } }), 0);

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
const report = { base: BASE, cases: {} };

async function runHarness(name, url, applyFn) {
  const page = await browser.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(250);
  const closed = await page.evaluate((fn) => {
    // eslint-disable-next-line no-eval
    return (0, eval)(fn)(false);
  }, applyFn);
  await page.screenshot({ path: path.join(OUT, `${name}-closed-390.png`), fullPage: false });

  // Critical iOS case: focus open with inset=0 (innerHeight shrunk with VV).
  const focusInset0 = await page.evaluate((fn) => {
    const run = (0, eval)(fn);
    // Simulate focused kb mode via apply helpers if present, else CSS vars.
    if (typeof window.__applyFocusInset0 === "function") return window.__applyFocusInset0();
    return run(true, { inset: 0, focused: true });
  }, applyFn);
  await page.screenshot({ path: path.join(OUT, `${name}-focus-inset0-390.png`), fullPage: false });

  const openInset = await page.evaluate((fn) => (0, eval)(fn)(true), applyFn);
  await page.screenshot({ path: path.join(OUT, `${name}-kb-inset-390.png`), fullPage: false });

  const restored = await page.evaluate((fn) => (0, eval)(fn)(false), applyFn);
  await page.screenshot({ path: path.join(OUT, `${name}-restored-390.png`), fullPage: false });
  await page.close();
  return { closed, focusInset0, openInset, restored };
}

// Patch harnesses at runtime via page scripts — use existing __applyKb and extend.
const csPage = await browser.newPage();
await csPage.setViewportSize({ width: 390, height: 844 });
await csPage.goto(`${BASE}/scripts/fixtures/chat-viewport-harness.html`, {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
await csPage.waitForTimeout(200);
await csPage.evaluate(() => {
  window.__applyFocusInset0 = function () {
    const { applyVisualViewportCss } = window.__mod || {};
  };
});
// Re-import apply in page and define focus-inset0 case
await csPage.evaluate(async () => {
  const mod = await import("/src/scroll-keep.js");
  function measure() {
    return window.__measure();
  }
  function apply(kb, opts) {
    const focused = !!(opts && opts.focused);
    const insetForce = opts && "inset" in opts ? opts.inset : kb ? 320 : 0;
    const realH = window.innerHeight || 844;
    const box = kb
      ? { top: 0, height: Math.max(280, Math.round(realH * 0.55)), inset: insetForce }
      : { top: 0, height: realH, inset: 0 };
    if (opts && opts.mode === "focusInset0") {
      box.height = Math.max(280, Math.round(realH * 0.55));
      box.inset = 0;
    }
    const kbOpen2 =
      opts && opts.mode === "focusInset0"
        ? mod.isChatKeyboardOpen({ lock: true, focused: true, inset: 0 })
        : mod.isChatKeyboardOpen({
            lock: true,
            focused: !!kb,
            inset: box.inset,
          });
    mod.applyVisualViewportCss("cs", box, {
      lock: true,
      kbOpen: kbOpen2,
      lockClass: "cs-chat-lock",
      kbClass: "cs-kb-open",
      shellSelector: ".cs-shell",
      tabbarPx: kbOpen2 ? 0 : 54,
    });
    const m = measure();
    m.kbOpenFlag = kbOpen2;
    m.insetUsed = box.inset;
    document.getElementById("note").textContent = JSON.stringify(m);
    return m;
  }
  window.__applyKb = (kb) => apply(!!kb);
  window.__applyFocusInset0 = () => apply(true, { mode: "focusInset0" });
});
const csClosed = await csPage.evaluate(() => window.__applyKb(false));
await csPage.screenshot({ path: path.join(OUT, "cs-closed-390.png"), fullPage: false });
const csFocusInset0 = await csPage.evaluate(() => window.__applyFocusInset0());
await csPage.screenshot({ path: path.join(OUT, "cs-focus-inset0-390.png"), fullPage: false });
const csOpenInset = await csPage.evaluate(() => window.__applyKb(true));
await csPage.screenshot({ path: path.join(OUT, "cs-kb-open-390.png"), fullPage: false });
const csRestored = await csPage.evaluate(() => window.__applyKb(false));
await csPage.screenshot({ path: path.join(OUT, "cs-restored-390.png"), fullPage: false });
await csPage.close();
const cs = { closed: csClosed, focusInset0: csFocusInset0, openInset: csOpenInset, restored: csRestored };

check(cs.closed.lock === true, "CS closed: lock on");
check(cs.closed.kb === false, "CS closed: kb off");
check(cs.focusInset0.kb === true && cs.focusInset0.kbOpenFlag === true, "CS focus+inset0 must enter kb mode");
check(cs.focusInset0.navDisplay === "none", "CS focus+inset0 must hide tabbar");
check(
  cs.focusInset0.composerBottom <= cs.focusInset0.shellTop + cs.focusInset0.shellHeight + 2,
  "CS focus+inset0 composer inside shell"
);
check(
  Math.abs(cs.focusInset0.shellTop + cs.focusInset0.shellHeight - cs.focusInset0.composerBottom) < 90,
  "CS focus+inset0 composer near shell bottom"
);
check(cs.focusInset0.msgsHeight < cs.closed.msgsHeight, "CS message area shrinks on focus kb");
check(cs.openInset.kb === true, "CS inset-open kb on");
check(cs.restored.kb === false, "CS restored kb off");
check(Math.abs(cs.restored.msgsHeight - cs.closed.msgsHeight) < 40, "CS msgs restore");

const bossPage = await browser.newPage();
await bossPage.setViewportSize({ width: 390, height: 844 });
await bossPage.goto(`${BASE}/scripts/fixtures/boss-support-chat-harness.html`, {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
await bossPage.waitForTimeout(200);
await bossPage.evaluate(async () => {
  const mod = await import("/src/scroll-keep.js");
  function measure() {
    const shell = document.querySelector(".support-shell");
    const footer = document.querySelector(".support-footer");
    const msgs = document.getElementById("msgs");
    const sr = shell.getBoundingClientRect();
    const fr = footer.getBoundingClientRect();
    const mr = msgs.getBoundingClientRect();
    return {
      lock: document.documentElement.classList.contains("support-chat-lock"),
      kb: document.documentElement.classList.contains("support-kb-open"),
      shellTop: Math.round(sr.top),
      shellHeight: Math.round(sr.height),
      composerBottom: Math.round(fr.bottom),
      composerTop: Math.round(fr.top),
      msgsHeight: Math.round(mr.height),
      composerPadBottom: getComputedStyle(footer).paddingBottom,
    };
  }
  function apply(mode) {
    const realH = window.innerHeight || 844;
    let box;
    let focused = false;
    if (mode === "closed") {
      box = { top: 0, height: realH, inset: 0 };
    } else if (mode === "focusInset0") {
      box = { top: 0, height: Math.max(280, Math.round(realH * 0.55)), inset: 0 };
      focused = true;
    } else {
      box = { top: 0, height: 420, inset: 380 };
      focused = true;
    }
    const kbOpen = mod.isChatKeyboardOpen({ lock: true, focused, inset: box.inset });
    mod.applyVisualViewportCss("support", box, {
      lock: true,
      kbOpen,
      lockClass: "support-chat-lock",
      kbClass: "support-kb-open",
      shellSelector: ".support-shell, #supportApp",
    });
    document.body.classList.toggle("support-chat-lock", true);
    document.body.classList.toggle("support-kb-open", kbOpen);
    const m = measure();
    m.kbOpenFlag = kbOpen;
    document.getElementById("note").textContent = JSON.stringify(m);
    return m;
  }
  window.__bossApply = apply;
});
const bossClosed = await bossPage.evaluate(() => window.__bossApply("closed"));
await bossPage.screenshot({ path: path.join(OUT, "boss-closed-390.png"), fullPage: false });
const bossFocusInset0 = await bossPage.evaluate(() => window.__bossApply("focusInset0"));
await bossPage.screenshot({ path: path.join(OUT, "boss-focus-inset0-390.png"), fullPage: false });
const bossOpenInset = await bossPage.evaluate(() => window.__bossApply("open"));
await bossPage.screenshot({ path: path.join(OUT, "boss-kb-open-390.png"), fullPage: false });
const bossRestored = await bossPage.evaluate(() => window.__bossApply("closed"));
await bossPage.screenshot({ path: path.join(OUT, "boss-restored-390.png"), fullPage: false });
await bossPage.close();
const boss = {
  closed: bossClosed,
  focusInset0: bossFocusInset0,
  openInset: bossOpenInset,
  restored: bossRestored,
};

check(boss.closed.lock === true, "boss closed lock");
check(boss.closed.kb === false, "boss closed kb off");
check(boss.focusInset0.kb === true, "boss focus+inset0 kb on");
check(
  boss.focusInset0.composerBottom <= boss.focusInset0.shellTop + boss.focusInset0.shellHeight + 2,
  "boss focus+inset0 composer inside shell"
);
check(
  Math.abs(boss.focusInset0.shellTop + boss.focusInset0.shellHeight - boss.focusInset0.composerBottom) < 90,
  "boss focus+inset0 composer near bottom"
);
check(boss.focusInset0.msgsHeight < boss.closed.msgsHeight, "boss msgs shrink on kb");
check(boss.restored.kb === false, "boss restored");

report.cases = { cs, boss };
fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));

await browser.close();

if (fails.length) {
  console.error("FAIL");
  fails.forEach((f) => console.error(" -", f));
  process.exit(1);
}
console.log("PASS verify-chat-vv-focus-local");
console.log("artifacts:", OUT);
