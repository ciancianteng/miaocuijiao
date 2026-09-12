/**
 * Mobile forced-ack modal checks at 360/390/430 on Preview.
 * Usage: node scripts/shot-forced-modal-mobile.mjs <preview-base>
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const BASE = (process.argv[2] || "").replace(/\/$/, "");
const PASS = process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
if (!BASE) {
  console.error("need preview base");
  process.exit(2);
}

const outDir = path.resolve("tmp-forced-modal-mobile");
fs.mkdirSync(outDir, { recursive: true });
const widths = [360, 390, 430];
const results = [];

async function injectForcedCssAndShow(page) {
  await page.addScriptTag({ url: `${BASE}/src/companion-forced-ack.js?v=20260803rules1` }).catch(() => null);
  await page.waitForTimeout(300);
  const ok = await page.evaluate(() => {
    function ensure() {
      if (window.MCJCompanionForcedAck) return true;
      return false;
    }
    if (!ensure()) return false;
    window.MCJCompanionForcedAck.show([
      {
        id: "mobile-ui-test",
        contentType: "companion_work_rules",
        title: "手机端强制规则测试",
        version: "1",
        content:
          Array.from({ length: 24 }, (_, i) => `${i + 1}. 接单前必须完整阅读平台规则，禁止私下交易与跳单。`).join("\n") +
          "\n请滚动到底部后勾选并点击“我已阅读并同意”。",
      },
    ]);
    // Override click to close without API for layout test
    var btn = document.querySelector("[data-pw-forced-confirm]");
    if (btn) {
      btn.onclick = function (e) {
        e.preventDefault();
        e.stopPropagation();
        window.MCJCompanionForcedAck.show([]);
      };
    }
    return !!document.querySelector(".pw-forced-modal");
  });
  return ok;
}

async function loginCompanion(page) {
  // Prefer API token injection to avoid flaky login UI
  const envPath = path.resolve(".env.local");
  const env = Object.fromEntries(
    fs
      .readFileSync(envPath, "utf8")
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith("#"))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i), l.slice(i + 1)];
      })
  );
  const SUPABASE_URL = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const ANON = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
  const authRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: "companion@meow.test", password: PASS }),
  });
  const auth = await authRes.json();
  if (!authRes.ok) throw new Error("auth failed " + JSON.stringify(auth));
  await page.goto(`${BASE}/companion/dashboard/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.evaluate(
    ({ access, refresh }) => {
      localStorage.setItem("mcjAuthAccessToken", access);
      localStorage.setItem("mcjAuthRefreshToken", refresh || "");
      sessionStorage.setItem("mcjAuthAccessToken", access);
      localStorage.setItem("mcjAuthRole", "companion");
    },
    { access: auth.access_token, refresh: auth.refresh_token }
  );
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2000);
}

async function measure(page, width) {
  const metrics = await page.evaluate(() => {
    const mask = document.querySelector("[data-pw-forced-mask]");
    const modal = document.querySelector(".pw-forced-modal");
    const body = document.querySelector("[data-pw-forced-body]");
    const btn = document.querySelector("[data-pw-forced-confirm]");
    const docW = document.documentElement.scrollWidth;
    const winW = window.innerWidth;
    const mr = modal ? modal.getBoundingClientRect() : null;
    const br = btn ? btn.getBoundingClientRect() : null;
    return {
      hasMask: !!mask,
      hasModal: !!modal,
      docW,
      winW,
      overflowX: docW > winW + 1,
      modalInViewport: !!(mr && mr.left >= -2 && mr.right <= winW + 2 && mr.top >= -2 && mr.bottom <= window.innerHeight + 4),
      bodyScrollable: !!(body && body.scrollHeight > body.clientHeight + 4),
      btnVisible: !!(br && br.bottom <= window.innerHeight + 4 && br.width > 0),
      btnText: btn ? btn.textContent.trim() : "",
      modalHeight: mr ? Math.round(mr.height) : 0,
    };
  });

  await page.evaluate(() => {
    const body = document.querySelector("[data-pw-forced-body]");
    if (body) body.scrollTop = body.scrollHeight;
  });
  await page.waitForTimeout(200);
  await page.locator("[data-pw-forced-agree]").check({ force: true }).catch(() => {});
  await page.waitForTimeout(100);
  await page.evaluate(() => {
    const btn = document.querySelector("[data-pw-forced-confirm]");
    if (btn) btn.disabled = false;
  });
  await page.locator("[data-pw-forced-confirm]").click({ force: true });
  await page.waitForTimeout(400);
  const closedOk = (await page.locator("[data-pw-forced-mask]").count()) === 0;
  return { ...metrics, closedOk, width };
}

const browser = await chromium.launch({ headless: true });
try {
  for (const width of widths) {
    const context = await browser.newContext({
      viewport: { width, height: 800 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    await loginCompanion(page);
    const shown = await injectForcedCssAndShow(page);
    await page.waitForTimeout(300);
    const shot = path.join(outDir, `forced-${width}.png`);
    await page.screenshot({ path: shot, fullPage: false });
    const m = await measure(page, width);
    const pass = shown && m.hasModal && !m.overflowX && m.modalInViewport && m.btnVisible && m.closedOk;
    results.push({ width, pass, shown, shot, ...m });
    console.log(pass ? "PASS" : "FAIL", width, JSON.stringify(m));
    await context.close();
  }
} finally {
  await browser.close();
}

const summary = { base: BASE, results, allPass: results.every((r) => r.pass) };
fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify(summary, null, 2));
console.log(summary.allPass ? "ALL PASS" : "HAS FAIL");
process.exit(summary.allPass ? 0 : 1);
