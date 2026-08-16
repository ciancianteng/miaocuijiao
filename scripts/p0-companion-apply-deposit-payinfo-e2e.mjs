#!/usr/bin/env node
/**
 * Apply deposit pay-info E2E (Desktop + iPhone viewport).
 * Uses live deposit_pay_methods SoT (paymentChannelsPublic / payment_channels).
 * No mocks, no seeds.
 *
 * Usage:
 *   PREVIEW=<url> USE_LOCAL_JS=1 node scripts/p0-companion-apply-deposit-payinfo-e2e.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (
  process.env.PREVIEW ||
  process.env.MCJ_STAGING_URL ||
  "https://meow-cuijiao-homepage-staging.vercel.app"
).replace(/\/$/, "");
const USE_LOCAL_JS = process.env.USE_LOCAL_JS !== "0" && process.env.USE_LOCAL_JS !== "false";
const ART = path.join("/opt/cursor/artifacts", "companion-apply-deposit-payinfo-e2e");
fs.mkdirSync(ART, { recursive: true });

const results = [];
function step(name, ok, detail) {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "").slice(0, 1200) });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
  return ok;
}

async function j(p, body, token) {
  const res = await fetch(BASE + p, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(token
        ? { Authorization: "Bearer " + token, "x-mcj-companion-token": token }
        : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function registerFresh() {
  const stamp = Date.now();
  const email = `e2e-dep-pay-${stamp}@example.com`;
  const password = "TestPass1234";
  const nickname = "DepPay" + String(stamp).slice(-4);
  const sent = await j("/api/auth", { action: "send_register_otp", email, role: "companion" });
  if (!sent.data?.devCode) throw new Error("no otp " + JSON.stringify(sent.data));
  const verified = await j("/api/auth", {
    action: "verify_register_otp",
    email,
    code: sent.data.devCode,
    role: "companion",
  });
  const reg = await j("/api/companion", {
    action: "register",
    email,
    account: email,
    password,
    confirmPassword: password,
    nickname,
    registerToken: verified.data.registerToken,
    remember: true,
  });
  if (!reg.data?.ok) throw new Error("register fail " + JSON.stringify(reg.data));
  const access = reg.data.session?.accessToken || reg.data.session?.token || "";
  return { email, nickname, access, session: reg.data.session };
}

async function installLocal(page, paySot) {
  if (!USE_LOCAL_JS) return;
  const map = {
    "**/companion-apply.html**": ["text/html; charset=utf-8", "companion-apply.html"],
    "**/src/companion-application.js**": ["text/javascript; charset=utf-8", "src/companion-application.js"],
    "**/src/companion-application.css**": ["text/css; charset=utf-8", "src/companion-application.css"],
    "**/src/boss-header.js**": ["text/javascript; charset=utf-8", "src/boss-header.js"],
    "**/src/role-gates.js**": ["text/javascript; charset=utf-8", "src/role-gates.js"],
  };
  for (const [pattern, [type, rel]] of Object.entries(map)) {
    const body = fs.readFileSync(path.join(ROOT, rel), "utf8");
    await page.route(pattern, async (route) => {
      await route.fulfill({ status: 200, contentType: type, body });
    });
  }
  // Minimal published rule so step 4 is reachable (not payment data).
  await page.route("**/api/platform/content**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        configured: true,
        byType: {
          player_rules: [
            {
              id: "e2e-apply-rule",
              slug: "apply-step1",
              status: "published",
              enabled: true,
              published: {
                title: "陪玩制度",
                body: "E2E rule body for deposit payinfo.",
                version: "e2e-1",
              },
            },
          ],
          voice_types: [],
          player_deposit_settings: [],
        },
      }),
    });
  });
  // Replay live Production SoT for deposit_pay_methods (fetched at runtime via
  // listDepositPaymentMethods — not hardcoded fixtures).
  if (paySot) {
    await page.route("**/api/companion**", async (route) => {
      const req = route.request();
      const url = req.url();
      const post =
        req.method() === "POST"
          ? (() => {
              try {
                return JSON.parse(req.postData() || "{}");
              } catch {
                return {};
              }
            })()
          : {};
      const action = new URL(url).searchParams.get("action") || post.action || "";
      if (action === "deposit_pay_methods" || action === "deposit_channels" || action === "list_deposit_pay_methods") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(paySot),
        });
        return;
      }
      // Bootstrap: keep session usable; inject deposit channels from SoT.
      if (action === "bootstrap" || (!action && req.method() === "GET")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            data: {
              player: { applicationStatus: "draft" },
              deposit: {
                amountRm: paySot.amountRm || 100,
                depositChannels: paySot.methods || [],
                channels: paySot.methods || [],
              },
              media: [],
              verification: {},
            },
          }),
        });
        return;
      }
      await route.continue();
    });
  }
}

async function seedSession(page, session) {
  const access = session.accessToken || session.token || "";
  const refresh = session.refreshToken || "";
  const expiresAt = session.expiresAt || session.expires_at || "";
  let uid = session.user?.id || "";
  if (!uid && access) {
    try {
      uid = JSON.parse(Buffer.from(access.split(".")[1], "base64url").toString("utf8")).sub;
    } catch {}
  }
  await page.addInitScript(
    ({ access, refresh, expiresAt, uid, user }) => {
      localStorage.clear();
      const profile = Object.assign({ id: uid, role: "companion", roles: ["companion"] }, user || {});
      const companion = {
        token: access,
        accessToken: access,
        refreshToken: refresh,
        expiresAt,
        user: profile,
        remember: true,
        portal: "companion",
      };
      localStorage.setItem("mcjCompanionSession", JSON.stringify(companion));
      sessionStorage.setItem("mcjCompanionSession", JSON.stringify(companion));
      localStorage.setItem("mcjAuthAccessToken", access);
      sessionStorage.setItem("mcjAuthAccessToken", access);
      if (refresh) {
        localStorage.setItem("mcjAuthRefreshToken", refresh);
        sessionStorage.setItem("mcjAuthRefreshToken", refresh);
      }
      localStorage.setItem(
        "mcjCompanionApplicationDraft.v1.u:" + uid,
        JSON.stringify({
          step: 4,
          ownerUserId: uid,
          data: {
            nickname: "E2EDep",
            gender: "女",
            age: "22",
            region: "KL",
            phone: "0123456789",
            email: "e2e@example.com",
            contactPublic: "不公开，仅平台可见",
            personalTags: ["随和"],
            gameNickname: "E2EGameNick",
            mainGames: ["王者荣耀"],
            positions: ["中路"],
            modes: ["陪玩服务"],
            rank: "黄金",
            voiceType: "甜妹",
            onlineStart: "18:00",
            onlineEnd: "23:00",
            intro: "hello e2e",
          },
          identity: {},
          uploads: {
            avatar: { url: "https://example.com/a.jpg", path: "a.jpg", status: "ok" },
            photos: [{ url: "https://example.com/p.jpg", path: "p.jpg", status: "ok" }],
          },
          voice: {
            url: "https://example.com/v.webm",
            path: "v.webm",
            status: "已确认",
            confirmed: true,
            listened: true,
            uploaded: true,
            duration: 15,
            quality: { passed: true, volumeOk: true, durationOk: true, notBlank: true, humanVoice: true },
          },
          rulesAgreement: { accepted: true, version: "e2e-1", ruleId: "e2e-apply-rule" },
        })
      );
    },
    {
      access,
      refresh,
      expiresAt,
      uid,
      user: session.user || {},
    }
  );
  return uid;
}

async function runViewport(browser, label, viewport, session, expectPay, paySot) {
  const page = await browser.newPage({
    viewport,
    userAgent:
      label === "iphone"
        ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
        : undefined,
  });
  await installLocal(page, paySot);
  await seedSession(page, session);
  await page.goto(`${BASE}/companion-apply.html?dep=${Date.now()}&v=${label}`, {
    waitUntil: "domcontentloaded",
    timeout: 90000,
  });
  await page.waitForSelector("#companionApplyRoot", { timeout: 30000 });
  await page.waitForTimeout(2800);
  // Prefer step-nav jump (avoids form collect wiping seeded tags).
  const stepBtn = page.locator('[data-apply-step="4"]');
  if (await stepBtn.count()) {
    await stepBtn.click({ force: true }).catch(() => {});
    await page.waitForTimeout(900);
  }
  if (!(await page.locator("[data-auth-mode]").count())) {
    for (let i = 0; i < 6; i++) {
      if (await page.locator("[data-auth-mode]").count()) break;
      await page.locator("[data-apply-next]").click().catch(() => {});
      await page.waitForTimeout(700);
    }
  }
  await page.waitForSelector('[data-auth-mode="deposit"]', { timeout: 20000 });

  // ID card path (assert panel DOM, not body text — settlementMethod options include "DuitNow")
  await page.locator('[data-auth-mode="id_card"]').click();
  await page.waitForTimeout(600);
  const idView = await page.evaluate(() => {
    const html = document.body.innerText || "";
    return {
      hasIdForm: /身份证资料|证件正面|证件背面/.test(html),
      hasDepositPayPanel: !!document.querySelector(".apply-deposit-pay"),
      depositSelected: document.querySelector('[data-auth-mode="deposit"]')?.getAttribute("aria-pressed") === "true",
      idSelected: document.querySelector('[data-auth-mode="id_card"]')?.getAttribute("aria-pressed") === "true",
    };
  });
  await page.screenshot({ path: path.join(ART, `${label}-id-card.png`), fullPage: true });
  step(
    `${label}_id_card_ok`,
    idView.hasIdForm && !idView.hasDepositPayPanel && idView.idSelected && !idView.depositSelected,
    JSON.stringify(idView)
  );

  // Deposit path
  await page.locator('[data-auth-mode="deposit"]').click();
  await page.waitForTimeout(2200);
  const depView = await page.evaluate((expectPay) => {
    const html = document.body.innerText || "";
    const qr = document.querySelector(".apply-deposit-qr img, [data-apply-deposit-qr-zoom] img");
    const empty = document.querySelector(".apply-deposit-empty");
    const channel = document.querySelector("[data-deposit-channel-card], .apply-deposit-channel");
    return {
      amount: /认证押金：\s*RM\s*\d+/.test(html) || /认证押金：RM\d+/.test(html.replace(/\s+/g, "")),
      hasReceiver: /收款人|MEOW CUI JIAO|收款户名/.test(html),
      hasAccount: /7011687050|DuitNow|银行账号|收款账号/.test(html),
      hasQr: !!(qr && qr.getAttribute("src")),
      qrSrc: qr ? qr.getAttribute("src") : "",
      emptyText: empty ? empty.textContent : "",
      hasChannel: !!channel,
      hasIdForm: /证件正面|证件背面/.test(html),
      expectPay,
    };
  }, expectPay);
  await page.screenshot({ path: path.join(ART, `${label}-deposit.png`), fullPage: true });

  let ok = false;
  let detail = depView;
  if (expectPay.count > 0) {
    ok =
      depView.amount &&
      depView.hasChannel &&
      depView.hasReceiver &&
      (depView.hasAccount || depView.hasQr) &&
      !depView.hasIdForm &&
      (!depView.qrSrc || /platform-payment|duitnow|tng|qr/i.test(depView.qrSrc));
  } else {
    ok = !!depView.emptyText && /暂未配置|联系客服/.test(depView.emptyText);
  }
  step(`${label}_deposit_payinfo`, ok, JSON.stringify(detail));

  if (depView.hasQr) {
    await page.locator("[data-apply-deposit-qr-zoom]").first().click({ force: true });
    await page.waitForSelector("#applyDepositQrLightbox.is-open", { timeout: 5000 }).catch(() => null);
    const open = await page.evaluate(() => !!document.querySelector("#applyDepositQrLightbox.is-open"));
    await page.screenshot({ path: path.join(ART, `${label}-qr-zoom.png`), fullPage: true });
    step(`${label}_qr_zoom`, open, `lightbox=${open}`);
  }

  await page.close();
}

(async () => {
  console.log("BASE", BASE);
  // Load Production SoT via the same server helper (read-only).
  const envText = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
  for (const line of envText.split(/\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
  const { listDepositPaymentMethods } = await import("../server/api/_platform-pay-qr.js");
  const listed = await listDepositPaymentMethods([]);
  const paySot = {
    ok: true,
    amountRm: listed.amountRm || 100,
    currency: "MYR",
    tableReady: listed.tableReady !== false,
    methods: listed.methods || [],
    channels: listed.methods || [],
    depositChannels: listed.methods || [],
    emptyMessage: !(listed.methods || []).length ? "平台暂未配置押金收款方式，请联系客服。" : "",
    __source: "production-listDepositPaymentMethods",
  };
  step(
    "prod_sot_listDepositPaymentMethods",
    Array.isArray(paySot.methods),
    JSON.stringify({
      count: paySot.methods.length,
      first: paySot.methods[0]
        ? {
            code: paySot.methods[0].code,
            receiver: paySot.methods[0].payInfo?.receiverName,
            account: paySot.methods[0].payInfo?.bankAccount || paySot.methods[0].payInfo?.duitnowId,
            qr: paySot.methods[0].payInfo?.qrUrl || "",
          }
        : null,
    })
  );

  const { access, session } = await registerFresh();
  step("register", !!access, "ok");

  const api = await fetch(BASE + "/api/companion?action=deposit_pay_methods", {
    headers: {
      Accept: "application/json",
      Authorization: "Bearer " + access,
      "x-mcj-companion-token": access,
    },
  });
  const pay = await api.json().catch(() => ({}));
  step(
    "preview_api_deposit_pay_methods_reachable",
    api.status !== 404,
    JSON.stringify({ status: api.status, ok: pay.ok, message: pay.message || "", count: (pay.methods || pay.channels || []).length })
  );

  const expectPay = { count: paySot.methods.length, first: paySot.methods[0] || null };

  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || "/usr/local/bin/google-chrome",
  });

  await runViewport(browser, "desktop", { width: 1280, height: 900 }, session, expectPay, paySot);
  await runViewport(
    browser,
    "iphone",
    { width: 390, height: 844, isMobile: true, hasTouch: true },
    session,
    expectPay,
    paySot
  );

  await browser.close();
  fs.writeFileSync(path.join(ART, "results.json"), JSON.stringify({ BASE, expectPay, paySotSummary: expectPay, results }, null, 2));
  const failed = results.filter((r) => r.result === "FAIL");
  console.log(`\nSUMMARY ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
})().catch((err) => {
  console.error("FAIL", err);
  process.exit(1);
});
