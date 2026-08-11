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

const results = [];
function step(name, ok, detail) {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "") });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
  return ok;
}

async function api(pathname, token, body) {
  const res = await fetch(`${BASE}${pathname}`, {
    method: body == null ? "GET" : "POST",
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}`, "x-mcj-companion-token": token } : {}),
      ...(body != null ? { "Content-Type": "application/json" } : {}),
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok && json.ok !== false, status: res.status, json };
}

function tokenOf(login) {
  return login.json?.session?.accessToken || login.json?.session?.token || login.json?.accessToken || login.json?.token || "";
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

  // Capture application status before (must not be wiped by this test).
  const boot0 = await api("/api/companion?action=bootstrap", token, null);
  const status0 =
    boot0.json?.data?.player?.applicationStatus ||
    boot0.json?.data?.player?.auditStatus ||
    boot0.json?.player?.applicationStatus ||
    "";
  step("bootstrap before", boot0.ok || !!boot0.json, `status=${status0 || "-"}`);

  // Tiny 1x1 png data URL for id front/back (or reuse existing paths via empty + existing).
  const png =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

  // Direct API repro of the const bug: empty identity_no + ID photos.
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
      verify.ok && noConstErr && noEnglishRuntime,
      JSON.stringify({ ok: verify.ok, status: verify.status, message: msg.slice(0, 160) })
    )
  ) {
    failed += 1;
  }

  const boot1 = await api("/api/companion?action=bootstrap", token, null);
  const status1 =
    boot1.json?.data?.player?.applicationStatus ||
    boot1.json?.data?.player?.auditStatus ||
    boot1.json?.player?.applicationStatus ||
    "";
  // Status should remain a valid enum; pending/review after verification is OK. Must not wipe to empty unexpectedly
  // if it was already pending/approved. Allow transition pending←draft.
  const preserved =
    !status0 ||
    status0 === status1 ||
    /pending|review|submitted|approved|verified|draft/i.test(String(status1));
  if (!step("application status not wiped", preserved, `before=${status0 || "-"} after=${status1 || "-"}`)) {
    failed += 1;
  }

  // Mobile UI: step 5 auth mode toggle must not pageerror.
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
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
    ({ token, email }) => {
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
          rulesAgreement: { accepted: true, version: "1.0", ruleId: "x", agreedAt: new Date().toISOString() },
        })
      );
    },
    { token, email: EMAIL }
  );

  await page.goto(`${BASE}/companion-apply.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2500);
  // Force navigate to step 5 if reachable.
  await page.evaluate(() => {
    try {
      const raw = JSON.parse(localStorage.getItem("mcjCompanionApplicationDraft.v1") || "{}");
      raw.step = 4;
      localStorage.setItem("mcjCompanionApplicationDraft.v1", JSON.stringify(raw));
    } catch (e) {}
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);

  for (const mode of ["deposit", "id_card", "deposit", "id_card"]) {
    const btn = page.locator(`[data-auth-mode="${mode}"]`).first();
    if ((await btn.count()) > 0) {
      await btn.click();
      await page.waitForTimeout(500);
    }
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
