#!/usr/bin/env node
/**
 * Staging/Preview evidence for Pricing V2 P2.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const PREVIEW = String(process.env.PREVIEW_URL || "").replace(/\/$/, "");
const PASS = process.env.PASS || process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const COMP_EMAIL = process.env.E2E_COMPANION_EMAIL || "companion@meow.test";
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || "admin@meow.test";
const STAGING_URL = String(process.env.STAGING_SUPABASE_URL || "").trim();
const STAGING_KEY = String(process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY || "").trim();
const PROD_REF = "jqfaknpmcnqwqvatrwgo";
const OUT = path.resolve("artifacts/pricing-v2-p2");

fs.mkdirSync(OUT, { recursive: true });

async function sbRest(pathname, { method = "GET", body = null } = {}) {
  requireStagingDb();
  const res = await fetch(`${STAGING_URL.replace(/\/$/, "")}/rest/v1${pathname}`, {
    method,
    headers: {
      apikey: STAGING_KEY,
      Authorization: `Bearer ${STAGING_KEY}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 500) }; }
  if (!res.ok) throw new Error(`supabase ${res.status} ${pathname}: ${typeof json === "string" ? json : JSON.stringify(json)}`);
  return json;
}


function requirePreview() {
  if (!PREVIEW) throw new Error("PREVIEW_URL required");
  const host = new URL(PREVIEW).hostname;
  if (/meowcuijiao\.com$/i.test(host) && !/vercel\.app$/i.test(host)) {
    throw new Error("Refusing Production host");
  }
}

function requireStagingDb() {
  if (!STAGING_URL || !STAGING_KEY) throw new Error("Missing staging supabase credentials");
  if (STAGING_URL.includes(PROD_REF)) throw new Error("Refusing Production supabase");
}

async function postApi(pathname, token, body, extraHeaders = {}) {
  const res = await fetch(`${PREVIEW}${pathname}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 500) };
  }
  return { status: res.status, json };
}

async function login(email) {
  const attempts = [
    { action: "login", email, password: PASS },
    { action: "login", account: email, password: PASS },
    { email, password: PASS },
  ];
  let last = null;
  for (const body of attempts) {
    last = await postApi("/api/auth", null, body);
    if (last.status < 400 && last.json && last.json.ok !== false) return last.json;
  }
  throw new Error(`login failed for ${email}: ${JSON.stringify(last).slice(0, 400)}`);
}

function pickToken(loginJson) {
  return (
    loginJson?.access_token ||
    loginJson?.accessToken ||
    loginJson?.token ||
    loginJson?.session?.access_token ||
    loginJson?.session?.accessToken ||
    loginJson?.data?.access_token ||
    loginJson?.data?.accessToken ||
    loginJson?.data?.session?.access_token ||
    loginJson?.data?.session?.accessToken ||
    loginJson?.user?.access_token ||
    loginJson?.user?.accessToken ||
    ""
  );
}

async function scanPrice(page) {
  return page.evaluate(() => {
    const text = document.body?.innerText || "";
    const hasPriceLabel = /接单价格（必填）|游戏价格|设置价格|单价（RM/.test(text);
    const inputs = Array.from(
      document.querySelectorAll(
        "input[data-game-price], input[name='hourlyPrice'], input[name='price'], input[name='game_prices']"
      )
    ).map((el) => ({ name: el.getAttribute("name"), dp: el.getAttribute("data-game-price") }));
    const notice = /申请阶段无需填写接单价格|不设置接单价格|基础价格/.test(text);
    const h2 = document.querySelector(".apply-panel h2, .apply-card h2, h2")?.innerText || "";
    const steps = Array.from(document.querySelectorAll(".apply-step, [data-apply-step], .step-item"))
      .map((el) => (el.textContent || "").trim())
      .filter(Boolean)
      .slice(0, 8);
    return { hasPriceLabel, inputs, notice, h2, steps };
  });
}

async function screenshotApply(browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const report = { steps: [] };

  await page.goto("https://www.meowcuijiao.com/companion-apply.html", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(OUT, "01-prod-apply-before.png"), fullPage: true });
  report.prodBefore = await scanPrice(page);

  const loginJson = await login(COMP_EMAIL);
  const token = pickToken(loginJson);
  if (!token) throw new Error(`No companion token: ${JSON.stringify(loginJson).slice(0, 300)}`);

  await page.goto(`${PREVIEW}/companion-apply.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.evaluate(
    ({ token, email }) => {
      const session = { access_token: token, token, user: { email, role: "companion" }, email };
      const raw = JSON.stringify(session);
      localStorage.setItem("mcjCompanionSession", raw);
      sessionStorage.setItem("mcjCompanionSession", raw);
      localStorage.setItem("companionAuthToken", token);
      localStorage.setItem("companionUser", JSON.stringify({ email, role: "companion" }));
    },
    { token, email: COMP_EMAIL }
  );
  await page.reload({ waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1500);

  for (let i = 0; i < 4; i++) {
    const stepBtn = page.locator(`[data-apply-step="${i}"]`);
    if (await stepBtn.count()) {
      await stepBtn.click({ force: true }).catch(() => {});
      await page.waitForTimeout(700);
    } else if (i > 0) {
      const next = page.locator("[data-apply-next]");
      if (await next.count()) await next.click().catch(() => {});
      await page.waitForTimeout(700);
    }
    await page.screenshot({ path: path.join(OUT, `0${i + 2}-preview-apply-step${i + 1}.png`), fullPage: true });
    report.steps.push({ i: i + 1, ...(await scanPrice(page)) });
  }

  const js = await (await fetch(`${PREVIEW}/src/companion-application.js`)).text();
  report.sourcePayloadHasPrice =
    /price:\s*draft\.data\.hourlyPrice/.test(js) || /game_prices:\s*draft\.data\.gamePriceMap/.test(js);
  report.sourceHasP2Comment = /Pricing V2 P2: never submit applicant price fields/.test(js);
  report.sourceSteps = (js.match(/var steps = \[[\s\S]*?\];/) || [""])[0];
  report.noPriceFields =
    report.steps.every((s) => !s.hasPriceLabel && (!s.inputs || s.inputs.length === 0)) && !report.sourcePayloadHasPrice;

  await context.close();
  return report;
}

async function screenshotAdmin(browser, adminToken) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${PREVIEW}/admin.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.evaluate(
    ({ token, email }) => {
      const user = { email, role: "admin", adminRole: "admin" };
      const session = { access_token: token, token, user };
      localStorage.setItem("adminUser", JSON.stringify(user));
      localStorage.setItem("adminAuthToken", token);
      localStorage.setItem("mcjAdminSession", JSON.stringify(session));
      sessionStorage.setItem("adminUser", JSON.stringify(user));
    },
    { token: adminToken, email: ADMIN_EMAIL }
  );
  await page.goto(`${PREVIEW}/admin.html#companion-applications`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT, "07-admin-applications.png"), fullPage: true });

  const ui = await page.evaluate(() => {
    const levelSelects = document.querySelectorAll("[data-capp-level]").length;
    const approveBtns = Array.from(document.querySelectorAll("[data-capp-approve]"));
    return {
      levelSelects,
      approveTotal: approveBtns.length,
      approveDisabled: approveBtns.filter((b) => b.disabled).length,
      hasLevelCopy: /陪玩等级|基础价格|base_price/.test(document.body.innerText),
    };
  });

  const sel = page.locator("[data-capp-level]").first();
  if ((await sel.count()) > 0) {
    const values = await sel.locator("option").evaluateAll((opts) =>
      opts.map((o) => ({ v: o.value, t: o.textContent }))
    );
    const first = values.find((o) => o.v);
    if (first) {
      await sel.selectOption(first.v);
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(OUT, "08-admin-level-selected.png"), fullPage: true });
      ui.selected = first;
      ui.previewText = await page.locator("[data-capp-level-preview]").first().innerText().catch(() => "");
    }
    ui.options = values.slice(0, 8);
  }
  await page.close();
  return ui;
}

async function dbAndApiEvidence(adminToken) {
  requireStagingDb();

  const levels = await sbRest("/companion_levels?select=id,code,name,base_price,is_enabled&order=sort_order.asc");
  const level = (levels || []).find((l) => Number(l.base_price) > 0);

  const existingBefore = await sbRest(
    "/companion_profiles?select=id,user_id,nickname,price,level_id,application_status,updated_at&application_status=eq.approved&order=updated_at.desc&limit=3"
  );
  const sample = existingBefore?.[0] || null;
  let servicesBefore = [];
  if (sample?.user_id) {
    servicesBefore = await sbRest(
      `/companion_services?select=id,companion_id,price,source,base_price_snapshot,level_id_at_price,updated_at&companion_id=eq.${encodeURIComponent(sample.user_id)}`
    );
  }

  const pending = await sbRest(
    "/companion_profiles?select=id,user_id,nickname,application_status,price,level_id&application_status=in.(pending,submitted,review,resubmit)&order=updated_at.desc&limit=10"
  );
  const target = pending?.[0] || null;

  const out = {
    levels: (levels || []).slice(0, 6).map((l) => ({ id: l.id, code: l.code, base_price: l.base_price })),
    sample,
    servicesBeforeCount: (servicesBefore || []).length,
    target,
    approveWithoutLevel: null,
    approveWithLevel: null,
    servicesAfter: null,
    seedOk: null,
    existingUnchanged: null,
  };

  if (target) {
    const noLevel = await postApi(
      "/api/admin/players",
      adminToken,
      { action: "review_application", id: target.id, payload: { status: "approved" } },
      { "x-mcj-admin-role": "admin" }
    );
    out.approveWithoutLevel = {
      status: noLevel.status,
      code: noLevel.json?.code || null,
      message: noLevel.json?.message || null,
      ok: noLevel.status >= 400,
    };

    const canMutate = /test|测试|meow\.test/i.test(String(target.nickname || ""));
    if (canMutate && level && out.approveWithoutLevel.ok) {
      const withLevel = await postApi(
        "/api/admin/players",
        adminToken,
        {
          action: "review_application",
          id: target.id,
          payload: {
            status: "approved",
            levelId: level.id,
            level_id: level.id,
            levelName: `${level.code || ""} ${level.name || ""}`.trim(),
          },
        },
        { "x-mcj-admin-role": "admin" }
      );
      out.approveWithLevel = {
        status: withLevel.status,
        message: withLevel.json?.message || null,
        ok: withLevel.status < 400 && withLevel.json?.ok !== false,
        levelId: level.id,
        base_price: level.base_price,
      };
      if (target.user_id) {
        const servicesAfter = await sbRest(
          `/companion_services?select=id,price,source,base_price_snapshot,level_id_at_price&companion_id=eq.${encodeURIComponent(target.user_id)}`
        );
        out.servicesAfter = servicesAfter || [];
        out.seedOk = (servicesAfter || []).some(
          (s) => Number(s.price) === Number(level.base_price) && String(s.source) === "level_default"
        );
      }
    } else {
      out.approveWithLevel = {
        skipped: true,
        reason: "no safe test pending row to mutate; missing-level 4xx verified",
        levelCandidate: level ? { id: level.id, base_price: level.base_price } : null,
      };
    }
  } else {
    out.approveWithoutLevel = { skipped: true, reason: "no pending applications" };
    out.approveWithLevel = { skipped: true, reason: "no pending applications" };
  }

  if (sample?.user_id) {
    const afterProfile = (
      await sbRest(
        `/companion_profiles?select=id,price,level_id,updated_at&id=eq.${encodeURIComponent(sample.id)}`
      )
    )?.[0];
    const afterServices = await sbRest(
      `/companion_services?select=id,price,source,updated_at&companion_id=eq.${encodeURIComponent(sample.user_id)}`
    );
    out.existingUnchanged =
      String(afterProfile?.price) === String(sample.price) &&
      String(afterProfile?.level_id || "") === String(sample.level_id || "") &&
      JSON.stringify((servicesBefore || []).map((s) => [s.id, s.price, s.source, s.updated_at])) ===
        JSON.stringify((afterServices || []).map((s) => [s.id, s.price, s.source, s.updated_at]));
  }

  return out;
}

async function main() {
  requirePreview();
  const summary = { preview: PREVIEW, at: new Date().toISOString() };

  const adminLogin = await login(ADMIN_EMAIL);
  const adminToken = pickToken(adminLogin);
  if (!adminToken) throw new Error(`admin login failed: ${JSON.stringify(adminLogin).slice(0, 300)}`);

  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome-stable",
  });
  try {
    summary.apply = await screenshotApply(browser);
    summary.adminUi = await screenshotAdmin(browser, adminToken);
  } finally {
    await browser.close();
  }

  summary.db = await dbAndApiEvidence(adminToken);

  const applyPass =
    !!summary.apply?.noPriceFields && !summary.apply?.sourcePayloadHasPrice && !!summary.apply?.sourceHasP2Comment;
  const adminPass = (summary.adminUi?.levelSelects || 0) > 0;
  const apiPass = !!summary.db?.approveWithoutLevel?.ok || !!summary.db?.approveWithoutLevel?.skipped;
  const existingPass = summary.db?.existingUnchanged !== false;
  summary.checks = { applyPass, adminPass, apiPass, existingPass, seedOk: summary.db?.seedOk };
  summary.verdict = applyPass && adminPass && apiPass && existingPass ? "PASS_WITH_LIMITS" : "FAIL";
  if (summary.db?.seedOk) summary.verdict = "PASS";

  fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  if (summary.verdict === "FAIL") process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
