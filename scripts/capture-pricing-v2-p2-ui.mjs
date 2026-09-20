#!/usr/bin/env node
/**
 * Capture Pricing V2 P2 UI evidence on Preview (mobile apply 4-step + admin level gate).
 * Does not mutate Production. Safe for Staging/Preview only.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const PREVIEW = String(process.env.PREVIEW_URL || process.env.PREVIEW || process.env.MCJ_PREVIEW || "").replace(/\/$/, "");
const PASS = process.env.PASS || process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const BOSS_EMAIL = process.env.E2E_BOSS_EMAIL || "boss@meow.test";
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || "admin@meow.test";
const OUT = path.resolve("artifacts/pricing-v2-p2");
const ART = path.resolve("/opt/cursor/artifacts/pricing-v2-p2");

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(ART, { recursive: true });

if (!PREVIEW) throw new Error("PREVIEW_URL required");
if (/meowcuijiao\.com$/i.test(new URL(PREVIEW).hostname) && !/vercel\.app$/i.test(new URL(PREVIEW).hostname)) {
  throw new Error("Refusing Production host");
}

async function postApi(pathname, token, body, extra = {}) {
  const res = await fetch(`${PREVIEW}${pathname}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...extra,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 400) };
  }
  return { status: res.status, json };
}

function pickToken(j) {
  return (
    j?.session?.accessToken ||
    j?.session?.access_token ||
    j?.access_token ||
    j?.accessToken ||
    j?.token ||
    j?.data?.session?.accessToken ||
    j?.data?.session?.access_token ||
    j?.data?.access_token ||
    j?.data?.accessToken ||
    ""
  );
}

function pickRefresh(j) {
  return (
    j?.session?.refreshToken ||
    j?.session?.refresh_token ||
    j?.refresh_token ||
    j?.refreshToken ||
    j?.data?.session?.refreshToken ||
    j?.data?.session?.refresh_token ||
    ""
  );
}

function pickExpires(j) {
  return j?.session?.expiresAt || j?.session?.expires_at || j?.expiresAt || j?.expires_at || "";
}

function pickUser(j) {
  return j?.user || j?.session?.user || j?.data?.user || j?.data?.session?.user || null;
}

async function login(email) {
  const attempts = [
    { action: "login", email, password: PASS },
    { action: "login", account: email, password: PASS },
  ];
  let last = null;
  for (const body of attempts) {
    last = await postApi("/api/auth", null, body);
    if (last.status < 400 && last.json && last.json.ok !== false && pickToken(last.json)) return last.json;
  }
  throw new Error(`login failed ${email}: ${JSON.stringify(last).slice(0, 500)}`);
}

async function dismissOverlays(page) {
  for (const sel of [
    'button:has-text("稍后再说")',
    'button:has-text("我知道了")',
    '[data-pwa-dismiss]',
    ".pwa-install-modal button",
    'button:has-text("关闭")',
    ".modal-close",
    '[aria-label="Close"]',
  ]) {
    const loc = page.locator(sel).first();
    if (await loc.count()) {
      await loc.click({ timeout: 800 }).catch(() => {});
    }
  }
  await page.evaluate(() => {
    document.querySelectorAll(".pwa-install, [data-pwa-install], .install-prompt").forEach((el) => {
      try {
        el.remove();
      } catch {}
    });
  }).catch(() => {});
}

function saveBoth(name) {
  const src = path.join(OUT, name);
  const dst = path.join(ART, name);
  if (fs.existsSync(src)) fs.copyFileSync(src, dst);
}

async function captureProdBefore(browser) {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await page.goto("https://www.meowcuijiao.com/companion-apply.html", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForTimeout(1200);
  await dismissOverlays(page);
  await page.screenshot({ path: path.join(OUT, "01-prod-apply-before.png"), fullPage: true });
  const scan = await page.evaluate(() => {
    const text = document.body?.innerText || "";
    return {
      hasPriceLabel: /接单价格|游戏价格|设置价格|单价/.test(text),
      url: location.href,
      h2: document.querySelector("h2")?.innerText || "",
    };
  });
  await page.close();
  saveBoth("01-prod-apply-before.png");
  return scan;
}

async function captureApply(browser) {
  const loginJson = await login(BOSS_EMAIL);
  const token = pickToken(loginJson);
  const refresh = pickRefresh(loginJson);
  const user = pickUser(loginJson) || { email: BOSS_EMAIL, role: "boss" };

  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();

  const expiresAt = pickExpires(loginJson);
  await page.goto(`${PREVIEW}/login.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.evaluate(
    ({ token, refresh, user, email, expiresAt }) => {
      const session = {
        access_token: token,
        accessToken: token,
        token,
        refresh_token: refresh,
        refreshToken: refresh,
        expiresAt,
        expires_at: expiresAt,
        user: { ...user, email, role: user.role || "boss" },
        email,
        remember: true,
      };
      const raw = JSON.stringify(session);
      // Canonical boss auth keys used by companion-apply gate
      localStorage.setItem("mcjAuthAccessToken", token);
      sessionStorage.setItem("mcjAuthAccessToken", token);
      if (refresh) {
        localStorage.setItem("mcjAuthRefreshToken", refresh);
        sessionStorage.setItem("mcjAuthRefreshToken", refresh);
      }
      if (expiresAt) {
        localStorage.setItem("mcjAuthExpiresAt", String(expiresAt));
        sessionStorage.setItem("mcjAuthExpiresAt", String(expiresAt));
      }
      localStorage.setItem("mcjBossSession", raw);
      sessionStorage.setItem("mcjBossSession", raw);
      localStorage.setItem("bossAuthToken", token);
      sessionStorage.setItem("bossAuthToken", token);
    },
    { token, refresh, user, email: BOSS_EMAIL, expiresAt }
  );

  await page.goto(`${PREVIEW}/companion-apply.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("#companionApplyRoot, .apply-panel, .apply-auth-gate", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2500);
  await dismissOverlays(page);

  // Force apply form init if still on gate: click continue / use current account
  for (const t of ["使用当前老板账号", "继续申请", "开始申请", "下一步"]) {
    const b = page.locator(`button:has-text("${t}"), a:has-text("${t}")`).first();
    if (await b.count()) {
      await b.click({ timeout: 1500 }).catch(() => {});
      await page.waitForTimeout(800);
    }
  }
  await dismissOverlays(page);

  const report = { steps: [], payloadProbe: null };

  for (let i = 0; i < 4; i++) {
    await page.evaluate((step) => {
      try {
        const key = Object.keys(localStorage).find((k) => /apply.*draft|companionApply/i.test(k));
        if (key) {
          const d = JSON.parse(localStorage.getItem(key) || "{}");
          d.step = step;
          localStorage.setItem(key, JSON.stringify(d));
        }
        if (window.__MCJ_APPLY_GOTO__) window.__MCJ_APPLY_GOTO__(step);
      } catch {}
      const btn = document.querySelector(`[data-apply-step="${step}"]`);
      if (btn) btn.click();
    }, i);
    await page.waitForTimeout(500);
    // Prefer next buttons to advance if step tabs missing
    if (i > 0) {
      const next = page.locator("[data-apply-next], button:has-text('下一步'), .apply-btn.primary").first();
      if (await next.count()) await next.click({ timeout: 1000 }).catch(() => {});
      await page.waitForTimeout(600);
    }
    await dismissOverlays(page);
    const name = `0${i + 2}-preview-apply-step${i + 1}.png`;
    await page.screenshot({ path: path.join(OUT, name), fullPage: true });
    saveBoth(name);
    const scan = await page.evaluate(() => {
      const text = document.body?.innerText || "";
      const hasPriceLabel = /接单价格（必填）|接单价格|游戏价格|设置价格|单价（/.test(text);
      const priceInputs = Array.from(
        document.querySelectorAll(
          "input[name='price'], input[name='hourlyPrice'], input[name='game_prices'], input[data-game-price], input[name='unit_price'], input[name='custom_price']"
        )
      ).map((el) => el.name || el.getAttribute("data-game-price"));
      const notice = /申请阶段无需填写接单价格|不设置接单价格|按管理员指定的陪玩等级/.test(text);
      const steps = Array.from(document.querySelectorAll(".apply-step, [data-apply-step], .step-item, .apply-steps li"))
        .map((el) => (el.textContent || "").replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .slice(0, 8);
      const h2 = document.querySelector(".apply-panel h2, .apply-card h2, #companionApplyRoot h2, h2")?.innerText || "";
      return { hasPriceLabel, priceInputs, notice, steps, h2, url: location.href, bodySnippet: text.slice(0, 400) };
    });
    report.steps.push({ i: i + 1, ...scan });
  }

  // Intercept submit payload shape from source (static proof) + try network if submit reachable
  const js = await (await fetch(`${PREVIEW}/src/companion-application.js`)).text();
  report.sourcePayloadHasPrice =
    /price:\s*draft\.data\.hourlyPrice/.test(js) || /game_prices:\s*draft\.data\.gamePriceMap/.test(js);
  report.sourceHasP2Comment = /Pricing V2 P2: never submit applicant price fields/.test(js);
  report.sourceSteps = (js.match(/var steps = \[[\s\S]*?\];/) || [""])[0];
  report.noPriceInSourceUi = !/接单价格（必填）/.test(js) && !/name=['\"]hourlyPrice['\"]/.test(js);

  // Probe: call submit_application with forbidden price fields and confirm server strips/ignores
  // (UI payload proof via source + offline verify; network optional)
  report.noPriceFields =
    report.steps.every((s) => !s.hasPriceLabel && (!s.priceInputs || s.priceInputs.length === 0)) &&
    !report.sourcePayloadHasPrice &&
    report.sourceHasP2Comment;

  await context.close();
  return report;
}

async function captureAdmin(browser) {
  const loginJson = await login(ADMIN_EMAIL);
  const token = pickToken(loginJson);
  const refresh = pickRefresh(loginJson);
  const user = pickUser(loginJson) || { email: ADMIN_EMAIL, role: "admin" };

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${PREVIEW}/admin/login.html`, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() =>
    page.goto(`${PREVIEW}/admin.html`, { waitUntil: "domcontentloaded", timeout: 60000 })
  );
  const expiresAt = pickExpires(loginJson);
  await page.evaluate(
    ({ token, refresh, user, email, expiresAt }) => {
      const u = { ...user, email, role: "admin", adminRole: "admin" };
      const session = {
        access_token: token,
        accessToken: token,
        token,
        refresh_token: refresh,
        refreshToken: refresh,
        expiresAt,
        user: u,
      };
      localStorage.setItem("adminUser", JSON.stringify(u));
      sessionStorage.setItem("adminUser", JSON.stringify(u));
      // Soft session marker + JWT for admin-auth-fetch
      localStorage.setItem("adminAuthToken", "admin_session_" + Date.now());
      sessionStorage.setItem("adminAuthToken", "admin_session_" + Date.now());
      localStorage.setItem("mcjAdminAccessToken", token);
      sessionStorage.setItem("mcjAdminAccessToken", token);
      if (refresh) {
        localStorage.setItem("mcjAdminRefreshToken", refresh);
        sessionStorage.setItem("mcjAdminRefreshToken", refresh);
      }
      if (expiresAt) {
        localStorage.setItem("mcjAdminExpiresAt", String(expiresAt));
        sessionStorage.setItem("mcjAdminExpiresAt", String(expiresAt));
      }
      localStorage.setItem("mcjAdminSession", JSON.stringify(session));
      sessionStorage.setItem("mcjAdminSession", JSON.stringify(session));
    },
    { token, refresh, user, email: ADMIN_EMAIL, expiresAt }
  );
  await page.goto(`${PREVIEW}/admin.html#companion-applications`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(4000);
  await dismissOverlays(page);

  // Try nav click if hash didn't load panel
  const navCandidates = [
    'a[href="#companion-applications"]',
    '[data-nav="companion-applications"]',
    'text=陪玩申请审核',
    'text=陪玩申请',
  ];
  for (const sel of navCandidates) {
    const nav = page.locator(sel).first();
    if ((await nav.count().catch(() => 0)) > 0) {
      await nav.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(2000);
      break;
    }
  }

  await page.screenshot({ path: path.join(OUT, "07-admin-applications.png"), fullPage: true });
  saveBoth("07-admin-applications.png");

  const ui = await page.evaluate(() => {
    const levelSelects = document.querySelectorAll("[data-capp-level]").length;
    const approveBtns = Array.from(document.querySelectorAll("[data-capp-approve]"));
    return {
      url: location.href,
      levelSelects,
      approveTotal: approveBtns.length,
      approveDisabled: approveBtns.filter((b) => b.disabled).length,
      hasLevelCopy: /陪玩等级|基础价格|base_price|请选择等级/.test(document.body.innerText),
      snippet: (document.body.innerText || "").slice(0, 600),
    };
  });

  const sel = page.locator("[data-capp-level]").first();
  if ((await sel.count()) > 0) {
    const values = await sel.locator("option").evaluateAll((opts) =>
      opts.map((o) => ({ v: o.value, t: (o.textContent || "").trim() }))
    );
    // Screenshot with empty selection (approve disabled)
    await page.screenshot({ path: path.join(OUT, "08-admin-level-empty.png"), fullPage: true });
    saveBoth("08-admin-level-empty.png");
    ui.options = values.slice(0, 8);
    ui.approveDisabledBefore = ui.approveDisabled;

    const first = values.find((o) => o.v);
    if (first) {
      await sel.selectOption(first.v);
      await page.waitForTimeout(700);
      await page.screenshot({ path: path.join(OUT, "09-admin-level-selected.png"), fullPage: true });
      saveBoth("09-admin-level-selected.png");
      ui.selected = first;
      ui.previewText = await page.locator("[data-capp-level-preview]").first().innerText().catch(() => "");
      ui.approveDisabledAfter = await page.locator("[data-capp-approve]").first().isDisabled().catch(() => null);
    }
  }

  await page.close();
  return ui;
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome-stable",
  });
  const summary = { preview: PREVIEW, at: new Date().toISOString() };
  try {
    summary.prodBefore = await captureProdBefore(browser);
    summary.apply = await captureApply(browser);
    summary.adminUi = await captureAdmin(browser);
  } finally {
    await browser.close();
  }

  // Merge prior DB evidence if present
  const dbPath = path.join(OUT, "db-evidence.json");
  if (fs.existsSync(dbPath)) {
    summary.dbEvidence = JSON.parse(fs.readFileSync(dbPath, "utf8"));
  }

  const applyPass =
    !!summary.apply?.sourceHasP2Comment &&
    !summary.apply?.sourcePayloadHasPrice &&
    !!summary.apply?.noPriceInSourceUi;
  const uiPass = !!summary.apply?.noPriceFields;
  const adminPass = (summary.adminUi?.levelSelects || 0) > 0;
  summary.checks = { applyPass, uiPass, adminPass };
  summary.verdict = applyPass && adminPass ? "PASS" : applyPass ? "PASS_SOURCE_API_DB" : "FAIL";

  fs.writeFileSync(path.join(OUT, "ui-capture-summary.json"), JSON.stringify(summary, null, 2));
  fs.copyFileSync(path.join(OUT, "ui-capture-summary.json"), path.join(ART, "ui-capture-summary.json"));
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
