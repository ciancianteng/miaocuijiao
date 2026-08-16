/**
 * #107 deposit QR acceptance — Staging live SoT only (no mocks / no fake QR).
 * Desktop + iPhone: apply page + companion account workbench.
 *
 * Usage: node scripts/p0-deposit-pay-qr-107-e2e.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { chromium, devices } from "playwright-core";

const BASE = (process.env.MCJ_STAGING_URL || "https://meow-cuijiao-homepage-staging.vercel.app").replace(/\/$/, "");
const ART = path.join("/opt/cursor/artifacts", "deposit-pay-qr-107-e2e");
const CHROME =
  process.env.CHROME_PATH ||
  "/home/ubuntu/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome";
fs.mkdirSync(ART, { recursive: true });

const results = [];
function step(name, ok, detail = "") {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "").slice(0, 1200) });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${String(detail).slice(0, 280)}`);
  return ok;
}

async function j(p, body, token) {
  const res = await fetch(BASE + p, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(token ? { Authorization: "Bearer " + token, "x-mcj-companion-token": token } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function registerFresh() {
  const stamp = Date.now();
  const email = `e2e-dep-qr107-${stamp}@example.com`;
  const password = "TestPass1234";
  const nickname = "Qr107" + String(stamp).slice(-4);
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
      localStorage.setItem("companionUser", JSON.stringify(profile));
      sessionStorage.setItem("companionUser", JSON.stringify(profile));
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
            nickname: "Qr107",
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
    { access, refresh, expiresAt, uid, user: session.user || {} }
  );
}

async function jumpToDepositStep(page) {
  await page.waitForSelector("#companionApplyRoot", { timeout: 30000 });
  await page.waitForTimeout(2200);
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
  await page.locator('[data-auth-mode="deposit"]').click();
  await page.waitForTimeout(2200);
}

async function assertApplyDepositQr(page, label) {
  await page.waitForTimeout(1500);
  const view = await page.evaluate(() => {
    const html = document.body.innerText || "";
    const qr = document.querySelector(".apply-deposit-qr img, [data-apply-deposit-qr-zoom] img");
    const empty = document.querySelector(".apply-deposit-empty");
    const channel = document.querySelector("[data-deposit-channel-card], .apply-deposit-channel");
    const net = performance.getEntriesByType("resource")
      .map((r) => r.name)
      .filter((n) => /deposit_pay_methods|companion/.test(n))
      .slice(-8);
    return {
      amount: /认证押金：\s*RM\s*100|认证押金：RM100/.test(html.replace(/\s+/g, " ")) || /RM\s*100/.test(html),
      hasReceiver: /MEOW CUI JIAO ENTERPRISE|收款人/.test(html),
      hasAccount: /7011687050|DuitNow|银行账号/.test(html),
      hasQr: !!(qr && String(qr.getAttribute("src") || "").trim()),
      qrSrc: qr ? String(qr.getAttribute("src") || "") : "",
      emptyText: empty ? empty.textContent : "",
      hasChannel: !!channel,
      scrollWidth: document.documentElement.scrollWidth,
      vw: window.innerWidth,
      net,
    };
  });
  await page.screenshot({ path: path.join(ART, `${label}-apply-deposit.png`), fullPage: false });
  const qrOk =
    view.hasQr &&
    /cfccwysniduwkjskiqgy\.supabase\.co\/storage\/v1\/object\/public\/platform-payment\/qr\//i.test(view.qrSrc);
  step(`${label}_apply_qr_visible`, qrOk, JSON.stringify(view));
  step(`${label}_apply_amount_rm100`, view.amount || /RM\s*100/.test(JSON.stringify(view)), JSON.stringify({ amount: view.amount }));
  step(`${label}_apply_no_h_overflow`, view.scrollWidth <= view.vw + 1, JSON.stringify({ vw: view.vw, scrollWidth: view.scrollWidth }));

  if (view.hasQr) {
    await page.locator("[data-apply-deposit-qr-zoom]").first().click({ force: true });
    await page.waitForTimeout(500);
    const open = await page.evaluate(() => !!document.querySelector("#applyDepositQrLightbox.is-open"));
    await page.screenshot({ path: path.join(ART, `${label}-apply-qr-zoom.png`), fullPage: false });
    step(`${label}_apply_qr_zoom`, open, `lightbox=${open}`);
    if (open) {
      await page.locator("[data-apply-deposit-qr-close]").first().click({ force: true }).catch(() => {});
      await page.waitForTimeout(300);
    }
  }
  return view;
}

async function assertWorkbenchDepositQr(page, label) {
  await page.goto(`${BASE}/companion/account`, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForTimeout(2500);
  const view = await page.evaluate(() => {
    const html = document.body.innerText || "";
    const qr = document.querySelector(".pw-deposit-qr-block img[data-mcj-pay-qr], .pw-deposit-qr-block img");
    const channel = document.querySelector("[data-deposit-channel-card], .pw-deposit-channel");
    return {
      hasForm: !!document.querySelector("[data-deposit-form]"),
      hasChannel: !!channel,
      hasQr: !!(qr && String(qr.getAttribute("src") || "").trim()),
      qrSrc: qr ? String(qr.getAttribute("src") || "") : "",
      amount: /RM\s*100|押金认证（RM100）/.test(html),
      receiver: /MEOW CUI JIAO ENTERPRISE|收款人/.test(html),
      scrollWidth: document.documentElement.scrollWidth,
      vw: window.innerWidth,
    };
  });
  await page.screenshot({ path: path.join(ART, `${label}-workbench-deposit.png`), fullPage: false });
  const qrOk =
    view.hasQr &&
    /cfccwysniduwkjskiqgy\.supabase\.co\/storage\/v1\/object\/public\/platform-payment\/qr\//i.test(view.qrSrc);
  step(`${label}_workbench_qr_visible`, qrOk, JSON.stringify(view));
  if (view.hasQr) {
    await page.locator(".pw-deposit-qr-block [data-pay-qr-zoom], .pw-deposit-qr-block img[data-mcj-pay-qr]").first().click({ force: true });
    await page.waitForTimeout(500);
    const open = await page.evaluate(() => !!document.querySelector("#pwDepositQrLightbox.is-open, .pay-qr-lightbox.is-open"));
    await page.screenshot({ path: path.join(ART, `${label}-workbench-qr-zoom.png`), fullPage: false });
    step(`${label}_workbench_qr_zoom`, open, `lightbox=${open}`);
  }
  return view;
}

async function runViewport(browser, label, contextOpts, session) {
  const context = await browser.newContext(contextOpts);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  page.on("response", (res) => {
    if (res.status() >= 400 && /deposit_pay_methods|companion\?action=bootstrap/.test(res.url())) {
      errors.push(`HTTP ${res.status()} ${res.url()}`);
    }
  });
  await seedSession(page, session);
  await page.goto(`${BASE}/companion-apply.html`, { waitUntil: "networkidle", timeout: 90000 });
  await jumpToDepositStep(page);
  await assertApplyDepositQr(page, label);
  await assertWorkbenchDepositQr(page, label);
  step(`${label}_no_js_http_errors`, errors.length === 0, errors.join(" | ") || "clean");
  await context.close();
}

async function main() {
  const { access, session } = await registerFresh();
  step("register", !!access, "ok");

  const methodsRes = await fetch(BASE + "/api/companion?action=deposit_pay_methods", {
    headers: { Accept: "application/json", Authorization: "Bearer " + access, "x-mcj-companion-token": access },
  });
  const methods = await methodsRes.json().catch(() => ({}));
  const first = (methods.methods || methods.channels || [])[0];
  step(
    "api_deposit_pay_methods",
    methodsRes.status === 200 && methods.ok && first?.payInfo?.qrUrl,
    JSON.stringify({
      status: methodsRes.status,
      amountRm: methods.amountRm,
      id: first?.id,
      qr: first?.payInfo?.qrUrl,
      receiver: first?.payInfo?.receiverName,
      amount: first?.payInfo?.amountRm,
    })
  );

  const browser = await chromium.launch({
    executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
    channel: fs.existsSync(CHROME) ? undefined : "chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  await runViewport(browser, "desktop", { viewport: { width: 1280, height: 900 }, locale: "zh-CN" }, session);
  await runViewport(browser, "iphone", { ...devices["iPhone 13"], locale: "zh-CN" }, session);

  await browser.close();
  const summary = { base: BASE, art: ART, results, pass: results.every((r) => r.result === "PASS") };
  fs.writeFileSync(path.join(ART, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  process.exit(summary.pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
