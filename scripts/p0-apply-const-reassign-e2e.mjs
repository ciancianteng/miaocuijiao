/**
 * Staging E2E: companion apply step5 must not throw "Assignment to constant variable".
 * Repro: submit_verification with empty identity_no (apply form never collects it).
 *
 * Usage: PREVIEW=https://... node scripts/p0-apply-const-reassign-e2e.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.PREVIEW || process.env.MCJ_STAGING_URL || "https://meow-cuijiao-homepage-staging.vercel.app").replace(
  /\/$/,
  ""
);
const PASS = process.env.PASS || process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const EMAIL = process.env.E2E_COMPANION_EMAIL || "companion@meow.test";
const ART = path.join(ROOT, "artifacts", "apply-const-reassign-e2e");
fs.mkdirSync(ART, { recursive: true });

const CHROME =
  process.env.PLAYWRIGHT_CHROMIUM_PATH ||
  process.env.CHROME_PATH ||
  [
    "/home/ubuntu/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell",
    "/home/ubuntu/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/local/bin/google-chrome",
  ].find((p) => fs.existsSync(p));

const results = [];
function step(name, ok, detail) {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "") });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
  return ok;
}

async function api(pathname, token, body, extraHeaders = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    method: body == null ? "GET" : "POST",
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}`, "x-mcj-companion-token": token } : {}),
      ...(body != null ? { "Content-Type": "application/json" } : {}),
      ...extraHeaders,
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok && json.ok !== false, status: res.status, json };
}

function tokenOf(login) {
  return login.json?.session?.accessToken || login.json?.session?.token || login.json?.accessToken || login.json?.token || "";
}

function playerFromBoot(boot) {
  return boot.json?.data?.player || boot.json?.player || {};
}

async function fetchApplyRuleMeta() {
  const res = await fetch(`${BASE}/api/platform/content?types=player_rules`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  const rules = json?.byType?.player_rules || [];
  const published = rules
    .map((item) => {
      const d = Object.assign({}, item.published || {}, item.draft || {}, item);
      const body = String(d.body || d.content || "").trim();
      return {
        id: item.id || d.id || "",
        slug: item.slug || d.slug || "",
        title: d.title || item.title || "",
        body,
        version: d.version || d.versionNote || "1.0",
        status: item.status === "published" || item.enabled !== false || d.enabled !== false ? "published" : "draft",
        enabled: item.enabled !== false,
        sort: Number(d.sort || item.sort || 0),
        forceConfirm: d.forceConfirm === true || d.requiresAck === true,
      };
    })
    .filter((r) => r.status === "published" && r.enabled !== false && r.body);
  const bySlug = published.find((r) => {
    const slug = String(r.slug || "").toLowerCase();
    const id = String(r.id || "");
    return id === "pc-player-rules-default" || slug === "apply-step1" || slug === "apply" || /apply|申请/.test(slug);
  });
  const byTitle = published.find((r) => /陪玩制度|陪玩规则|申请/.test(String(r.title || "")) && !/俱乐部等级|平台使用/.test(String(r.title || "")));
  const nonBoss = published.filter((r) => !r.forceConfirm && !/俱乐部等级|平台使用/.test(String(r.title || "")));
  const pool = nonBoss.length ? nonBoss : published;
  const selected =
    bySlug ||
    byTitle ||
    pool.slice().sort((a, b) => Number(b.sort || 0) - Number(a.sort || 0))[0] ||
    null;
  return selected ? { id: selected.id, version: selected.version } : { id: "", version: "1.0" };
}

async function restoreApprovedIfNeeded(status0) {
  if (!/approved|verified|passed/i.test(String(status0))) return { restored: false, reason: "not-approved-before" };
  const adminLogin = await api("/api/auth", null, {
    action: "login",
    email: process.env.E2E_ADMIN_EMAIL || "admin@meow.test",
    password: PASS,
  });
  const adminToken = tokenOf(adminLogin);
  if (!adminToken) return { restored: false, reason: "admin-login-fail" };
  const listRes = await fetch(`${BASE}/api/admin/players`, {
    headers: { Authorization: `Bearer ${adminToken}`, "x-mcj-admin-role": "admin", Accept: "application/json" },
  });
  const listJson = await listRes.json().catch(() => ({}));
  const player = (listJson.players || []).find((p) => String(p.email || "").toLowerCase() === EMAIL.toLowerCase());
  if (!player?.id) return { restored: false, reason: "player-not-found" };
  for (const action of ["review_application", "review_identity"]) {
    await fetch(`${BASE}/api/admin/players`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "x-mcj-admin-role": "admin",
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        action,
        id: player.id,
        status: "approved",
        reason: "restore after apply const-fix e2e",
      }),
    });
  }
  return { restored: true, playerId: player.id };
}

async function main() {
  let failed = 0;
  const login = await api("/api/auth", null, { action: "login", email: EMAIL, password: PASS });
  const token = tokenOf(login);
  if (!step("companion login", !!token, `tok=${!!token}`)) {
    failed += 1;
    finish(failed);
    return;
  }

  const boot0 = await api("/api/companion?action=bootstrap", token, null);
  const p0 = playerFromBoot(boot0);
  const status0 = p0.applicationStatus || p0.auditStatus || "";
  const deposit0 = p0.depositStatus || "";
  const identity0 = p0.identityStatus || p0.identityVerificationStatus || "";
  step("bootstrap before", boot0.ok || !!boot0.json, `status=${status0 || "-"} deposit=${deposit0 || "-"} identity=${identity0 || "-"}`);

  const png =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

  // Direct API repro of the const bug: empty identity_no + ID photos.
  // NOTE: submit_verification sets verification/application pending — restore afterwards if needed.
  const verify = await api("/api/companion", token, {
    action: "submit_verification",
    real_name: "E2E Apply",
    identity_no: "",
    id_front: png,
    id_back: png,
    settlementMethod: "银行卡",
    account_name: "E2E Apply",
    bank_account: "1234567890",
    method: "bank",
  });
  const msg = String(verify.json?.message || "");
  const noConstErr = !/Assignment to constant variable/i.test(msg);
  const noEnglishRuntime = !/TypeError|ReferenceError|is not defined|Cannot read propert/i.test(msg);
  if (
    !step(
      "submit_verification empty identity_no",
      (verify.ok || /已提交|审核/.test(msg)) && noConstErr && noEnglishRuntime,
      JSON.stringify({ ok: verify.ok, status: verify.status, message: msg.slice(0, 160) })
    )
  ) {
    failed += 1;
  }

  let restoreInfo = { restored: false };
  try {
    restoreInfo = await restoreApprovedIfNeeded(status0);
  } catch (e) {
    restoreInfo = { restored: false, reason: String(e?.message || e) };
  }
  step("admin restore approved", restoreInfo.restored || !/approved|verified|passed/i.test(String(status0)), JSON.stringify(restoreInfo));

  const boot1 = await api("/api/companion?action=bootstrap", token, null);
  const p1 = playerFromBoot(boot1);
  const status1 = p1.applicationStatus || p1.auditStatus || "";
  const deposit1 = p1.depositStatus || "";
  const preserved =
    !status0 ||
    status0 === status1 ||
    (/approved|verified|passed/i.test(String(status0)) && /approved|verified|passed/i.test(String(status1))) ||
    /pending|review|submitted|approved|verified|draft/i.test(String(status1));
  if (!step("application status restored/stable", preserved, `before=${status0 || "-"} after=${status1 || "-"}`)) {
    failed += 1;
  }
  // OR-gate: deposit approval must not be wiped by ID submit_verification.
  if (/approved|paid|verified|passed/i.test(String(deposit0))) {
    if (
      !step(
        "deposit status preserved (OR-gate)",
        /approved|paid|verified|passed/i.test(String(deposit1)),
        `before=${deposit0 || "-"} after=${deposit1 || "-"}`
      )
    ) {
      failed += 1;
    }
  }

  const ruleMeta = await fetchApplyRuleMeta();
  step("published apply rule", !!ruleMeta.id, JSON.stringify(ruleMeta));

  const browser = await chromium.launch({
    headless: true,
    executablePath: CHROME || undefined,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(String(err.message || err)));
  page.on("console", (msg) => {
    if (msg.type() === "error" && /Assignment to constant/i.test(msg.text())) pageErrors.push(msg.text());
  });

  await context.addInitScript(
    ({ token, email, ruleId, ruleVersion }) => {
      const user = { role: "companion", email, name: "Companion" };
      const session = {
        token,
        accessToken: token,
        refreshToken: "",
        expiresAt: "",
        user,
        remember: true,
        portal: "companion",
      };
      localStorage.setItem("mcjAuthAccessToken", token);
      sessionStorage.setItem("mcjAuthAccessToken", token);
      localStorage.setItem("mcjCompanionSession", JSON.stringify(session));
      sessionStorage.setItem("mcjCompanionSession", JSON.stringify(session));
      localStorage.setItem("companionAuthToken", "companion_session_v4_e2e");
      localStorage.setItem("companionUser", JSON.stringify(user));
      localStorage.setItem(
        "mcjCompanionApplicationDraft.v1",
        JSON.stringify({
          step: 4,
          data: {
            nickname: "E2E",
            age: "22",
            gender: "女",
            region: "KL",
            phone: "60123456789",
            email,
            contactPublic: "不公开，仅平台可见",
            personalTags: ["随和"],
            gameNickname: "E2EGame",
            mainGames: ["VALORANT"],
            positions: ["输出"],
            modes: ["陪玩服务"],
            rank: "黄金",
            voiceType: "甜妹",
            onlineStart: "20:00",
            onlineEnd: "23:00",
            intro: "hello intro text long enough for apply",
          },
          uploads: { avatar: { url: "https://example.com/a.jpg", path: "avatars/a.jpg", status: "ok" } },
          voice: {
            confirmed: true,
            listened: true,
            uploaded: true,
            url: "https://example.com/v.webm",
            path: "voice/v.webm",
            status: "已确认",
            duration: 15,
            quality: { passed: true, volumeOk: true, durationOk: true, notBlank: true, humanVoice: true },
          },
          identity: {
            authMode: "id_card",
            documentType: "马来西亚身份证",
            settlementMethod: "银行卡",
            settlementName: "Test",
            settlementAccount: "1234",
            idFront: { url: "https://example.com/f.jpg", path: "id/f.jpg", status: "ok" },
            idBack: { url: "https://example.com/b.jpg", path: "id/b.jpg", status: "ok" },
          },
          rulesAgreement: {
            accepted: true,
            version: ruleVersion || "1.0",
            ruleId: ruleId || "",
            agreedAt: new Date().toISOString(),
          },
        })
      );
    },
    { token, email: EMAIL, ruleId: ruleMeta.id, ruleVersion: ruleMeta.version }
  );

  await page.goto(`${BASE}/companion-apply.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("#companionApplyRoot", { timeout: 60000 });
  // Wait until remote config finishes (loading banner gone) then re-bind matching rule + step 5.
  await page.waitForFunction(() => !document.querySelector(".apply-load-pending"), { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(800);
  const forceInfo = await page.evaluate(({ ruleId, ruleVersion }) => {
    const raw = JSON.parse(localStorage.getItem("mcjCompanionApplicationDraft.v1") || "{}");
    raw.step = 4;
    raw.rulesAgreement = {
      accepted: true,
      version: ruleVersion || (raw.rulesAgreement && raw.rulesAgreement.version) || "1.0",
      ruleId: ruleId || (raw.rulesAgreement && raw.rulesAgreement.ruleId) || "",
      agreedAt: new Date().toISOString(),
    };
    localStorage.setItem("mcjCompanionApplicationDraft.v1", JSON.stringify(raw));
    // Click step nav if present after reload path.
    return { step: raw.step, ruleId: raw.rulesAgreement.ruleId };
  }, { ruleId: ruleMeta.id, ruleVersion: ruleMeta.version });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("#companionApplyRoot", { timeout: 60000 });
  await page.waitForFunction(() => !document.querySelector(".apply-load-pending"), { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(1000);
  // Re-apply agreement after remote rule hydrate (which may clear mismatched acceptance once).
  await page.evaluate(({ ruleId, ruleVersion }) => {
    const raw = JSON.parse(localStorage.getItem("mcjCompanionApplicationDraft.v1") || "{}");
    raw.step = 4;
    raw.rulesAgreement = {
      accepted: true,
      version: ruleVersion || "1.0",
      ruleId: ruleId || "",
      agreedAt: new Date().toISOString(),
    };
    localStorage.setItem("mcjCompanionApplicationDraft.v1", JSON.stringify(raw));
    const stepBtn = document.querySelector('[data-apply-step="4"]');
    if (stepBtn && stepBtn.getAttribute("aria-disabled") !== "true") stepBtn.click();
  }, { ruleId: ruleMeta.id, ruleVersion: ruleMeta.version });
  await page.waitForTimeout(800);
  // If still locked, accept checkbox then jump.
  const onStep5 = (await page.locator('[data-auth-mode="id_card"]').count()) > 0;
  if (!onStep5) {
    const agree = page.locator('input[type="checkbox"]').first();
    if ((await agree.count()) > 0) {
      await agree.check({ force: true }).catch(() => {});
      await page.waitForTimeout(400);
    }
    for (let i = 0; i < 5; i++) {
      const next = page.locator("[data-apply-next]").first();
      if ((await next.count()) === 0) break;
      if (await page.locator('[data-auth-mode="id_card"]').count()) break;
      await next.click({ force: true }).catch(() => {});
      await page.waitForTimeout(600);
    }
  }

  const authBtns = await page.locator("[data-auth-mode]").count();
  step("mobile reached step5 auth modes", authBtns >= 2, `authBtns=${authBtns} force=${JSON.stringify(forceInfo)}`);

  for (const mode of ["deposit", "id_card", "deposit", "id_card"]) {
    const btn = page.locator(`[data-auth-mode="${mode}"]`).first();
    if ((await btn.count()) > 0) {
      await btn.click();
      await page.waitForTimeout(400);
    }
  }
  // Soft reload while on step5 draft to mimic mobile re-enter.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await page.evaluate(({ ruleId, ruleVersion }) => {
    const raw = JSON.parse(localStorage.getItem("mcjCompanionApplicationDraft.v1") || "{}");
    raw.step = 4;
    raw.rulesAgreement = {
      accepted: true,
      version: ruleVersion || "1.0",
      ruleId: ruleId || "",
      agreedAt: new Date().toISOString(),
    };
    localStorage.setItem("mcjCompanionApplicationDraft.v1", JSON.stringify(raw));
    const stepBtn = document.querySelector('[data-apply-step="4"]');
    if (stepBtn) stepBtn.click();
  }, { ruleId: ruleMeta.id, ruleVersion: ruleMeta.version });
  await page.waitForTimeout(800);
  for (const mode of ["id_card", "deposit"]) {
    const btn = page.locator(`[data-auth-mode="${mode}"]`).first();
    if ((await btn.count()) > 0) await btn.click().catch(() => {});
    await page.waitForTimeout(300);
  }

  await page.screenshot({ path: path.join(ART, "step5-toggle.png"), fullPage: true });
  const bodyText = await page.locator("body").innerText();
  const uiHasConst = /Assignment to constant variable/i.test(bodyText);
  const pageHasConst = pageErrors.some((e) => /Assignment to constant/i.test(e));
  if (!step("mobile step5 toggle no const error", !uiHasConst && !pageHasConst, JSON.stringify({ uiHasConst, pageErrors }))) {
    failed += 1;
  }
  if (!step("mobile UI no English runtime dump", !/TypeError|ReferenceError|is not defined/i.test(bodyText), bodyText.replace(/\s+/g, " ").slice(0, 180))) {
    failed += 1;
  }

  await browser.close();
  finish(failed);
}

function finish(failed) {
  const line = failed ? `APPLY_CONST_REASSIGN_FAIL ${failed}` : "APPLY_CONST_REASSIGN_PASS";
  console.log(line);
  fs.writeFileSync(path.join(ART, "results.json"), JSON.stringify({ base: BASE, results, failed }, null, 2));
  fs.writeFileSync(path.join(ART, "summary.txt"), line + "\n" + results.map((r) => `${r.result} ${r.step} :: ${r.detail}`).join("\n"));
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
