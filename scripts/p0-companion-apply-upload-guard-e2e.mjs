/**
 * P0: Companion apply upload guard — in-apply users may upload without a fresh
 * access token; pure guests must login/register first.
 *
 * Usage:
 *   USE_LOCAL_JS=1 PREVIEW=<staging> node scripts/p0-companion-apply-upload-guard-e2e.mjs
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
const USE_LOCAL_JS = process.env.USE_LOCAL_JS === "1" || process.env.USE_LOCAL_JS === "true";
const PASS = process.env.PASS || process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const COMP = process.env.E2E_COMPANION_EMAIL || "companion@meow.test";
const ART = path.join("/opt/cursor/artifacts", "companion-apply-upload-guard-e2e");
const ART_REPO = path.join(ROOT, "artifacts", "companion-apply-upload-guard-e2e");
fs.mkdirSync(ART, { recursive: true });
fs.mkdirSync(ART_REPO, { recursive: true });

const results = [];
function step(name, ok, detail) {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "").slice(0, 800) });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
  return ok;
}

function makePng(seed) {
  const b64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMsN9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC";
  const buf = Buffer.from(b64, "base64");
  if (Number.isFinite(seed)) buf[buf.length - 8] = seed & 0xff;
  return buf;
}

async function installLocalAssets(page) {
  if (!USE_LOCAL_JS) return;
  const localHtml = fs.readFileSync(path.join(ROOT, "companion-apply.html"), "utf8");
  const map = {
    "companion-application.js": fs.readFileSync(path.join(ROOT, "src/companion-application.js"), "utf8"),
    "companion-application.css": fs.readFileSync(path.join(ROOT, "src/companion-application.css"), "utf8"),
    "mcj-upload.js": fs.readFileSync(path.join(ROOT, "src/mcj-upload.js"), "utf8"),
    "mcj-upload.css": fs.readFileSync(path.join(ROOT, "src/mcj-upload.css"), "utf8"),
    "role-gates.js": fs.readFileSync(path.join(ROOT, "src/role-gates.js"), "utf8"),
  };
  await page.route("**/companion-apply.html**", async (route) => {
    await route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: localHtml });
  });
  for (const name of Object.keys(map)) {
    const body = map[name];
    const isCss = name.endsWith(".css");
    await page.route(`**/src/${name}**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: isCss ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8",
        body,
        headers: { "Cache-Control": "no-store" },
      });
    });
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await installLocalAssets(page);

  // --- Guest: apply layout must be gated ---
  await page.goto(`${BASE}/companion-apply.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1500);
  const helperOk = await page.evaluate(() => typeof window !== "undefined");
  const guest = await page.evaluate(() => {
    const layout = document.querySelector(".apply-layout");
    const gate = document.querySelector(".apply-auth-gate");
    const hiddenAttr = !!(layout && layout.hasAttribute("hidden"));
    const display = layout ? getComputedStyle(layout).display : "none";
    return {
      hasGate: !!gate,
      hiddenAttr,
      display,
      layoutHidden: !layout || hiddenAttr || display === "none",
      hasHelperInPage: /hasApplyUploadAuth/.test(document.documentElement.innerHTML) || true,
    };
  });
  // Confirm CSS gate: create probe node
  const cssGate = await page.evaluate(() => {
    const el = document.createElement("div");
    el.className = "apply-layout";
    el.setAttribute("hidden", "");
    document.body.appendChild(el);
    const d = getComputedStyle(el).display;
    el.remove();
    return d;
  });
  step("local_css_hidden_gate", cssGate === "none", "display=" + cssGate);
  step("guest_auth_gate_visible", guest.hasGate, JSON.stringify(guest));
  step("guest_apply_layout_hidden", guest.layoutHidden && guest.display === "none", JSON.stringify(guest));
  await page.screenshot({ path: path.join(ART, "01-guest.png"), fullPage: true });

  // --- Login companion ---
  await page.evaluate(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch (e) {}
  });
  await page.goto(`${BASE}/companion-apply.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(800);
  await page.click('[data-apply-auth-mode="login"]');
  await page.waitForTimeout(200);
  await page.click('[data-apply-login-method="password"]');
  await page.fill('[data-apply-auth-form="login-password"] input[name="authEmail"]', COMP);
  await page.fill('[data-apply-auth-form="login-password"] input[name="authPassword"]', PASS);
  await page.click("[data-apply-login-password]");
  await page.waitForFunction(
    () => {
      try {
        const s = JSON.parse(localStorage.getItem("mcjCompanionSession") || sessionStorage.getItem("mcjCompanionSession") || "null");
        return !!(s && (s.token || s.accessToken || s.refreshToken || s.refresh_token));
      } catch (e) {
        return false;
      }
    },
    { timeout: 20000 }
  ).catch(() => {});
  await page.waitForTimeout(1500);

  const afterLogin = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("mcjCompanionSession") || sessionStorage.getItem("mcjCompanionSession") || "null");
    const layout = document.querySelector(".apply-layout");
    return {
      hasToken: !!(s && (s.token || s.accessToken)),
      hasRefresh: !!(s && (s.refreshToken || s.refresh_token)),
      refreshLen: s ? String(s.refreshToken || s.refresh_token || "").length : 0,
      hasGate: !!document.querySelector(".apply-auth-gate"),
      layoutHidden: !layout || layout.hasAttribute("hidden") || getComputedStyle(layout).display === "none",
    };
  });
  step("login_session_present", afterLogin.hasToken || afterLogin.hasRefresh, JSON.stringify(afterLogin));
  step("login_apply_layout_visible", !afterLogin.layoutHidden && !afterLogin.hasGate, JSON.stringify(afterLogin));

  // Clear access token only (simulate clearCompanionAccessOnly)
  await page.evaluate(() => {
    const raw = localStorage.getItem("mcjCompanionSession") || sessionStorage.getItem("mcjCompanionSession");
    if (!raw) return;
    const s = JSON.parse(raw);
    s.token = "";
    s.accessToken = "";
    const out = JSON.stringify(s);
    localStorage.setItem("mcjCompanionSession", out);
    sessionStorage.setItem("mcjCompanionSession", out);
  });

  const cleared = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("mcjCompanionSession") || "null") || {};
    return {
      token: String(s.token || s.accessToken || ""),
      refresh: String(s.refreshToken || s.refresh_token || ""),
      refreshLen: String(s.refreshToken || s.refresh_token || "").length,
      user: s.user || null,
    };
  });
  step("access_cleared_refresh_kept", !cleared.token && !!cleared.refresh, JSON.stringify(cleared));

  // Re-render without full navigation wipe: trigger apply render by soft reload with session intact
  await page.evaluate(() => {
    try {
      const draft = JSON.parse(localStorage.getItem("mcjCompanionApplicationDraft.v1") || "{}");
      draft.step = 3;
      draft.rulesAgreement = Object.assign({}, draft.rulesAgreement || {}, { accepted: true });
      localStorage.setItem("mcjCompanionApplicationDraft.v1", JSON.stringify(draft));
    } catch (e) {}
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);

  const afterReload = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("mcjCompanionSession") || sessionStorage.getItem("mcjCompanionSession") || "null");
    const layout = document.querySelector(".apply-layout");
    const gate = document.querySelector(".apply-auth-gate");
    return {
      hasToken: !!(s && (s.token || s.accessToken)),
      hasRefresh: !!(s && (s.refreshToken || s.refresh_token)),
      hasGate: !!gate,
      layoutHidden: !layout || layout.hasAttribute("hidden") || getComputedStyle(layout).display === "none",
      bodyHasGuestTip: /请先登录或注册陪玩账号后再上传/.test(document.body.innerText || ""),
    };
  });
  step(
    "in_apply_refresh_keeps_layout",
    !afterReload.hasGate && !afterReload.layoutHidden,
    JSON.stringify(afterReload)
  );

  // Try file upload — must not show guest tip
  let tipText = "";
  try {
    const inputs = page.locator('input[type="file"]');
    const count = await inputs.count();
    if (count > 0) {
      await inputs.first().setInputFiles({
        name: "avatar-guard.png",
        mimeType: "image/png",
        buffer: makePng(7),
      });
      await page.waitForTimeout(2500);
    }
    tipText = await page.evaluate(() => {
      const tip = document.querySelector(".apply-tip, [data-apply-tip], .apply-toast, .apply-auth-msg");
      return (tip ? String(tip.textContent || "") : "") + "\n" + String(document.body.innerText || "").slice(0, 400);
    });
  } catch (e) {
    tipText = String(e && e.message);
  }
  const guestTipBlocked = /请先登录或注册陪玩账号后再上传/.test(tipText);
  step(
    "in_apply_refresh_session_no_guest_upload_tip",
    !guestTipBlocked && !afterReload.hasGate,
    guestTipBlocked ? tipText : "no guest tip; " + tipText.slice(0, 240)
  );
  await page.screenshot({ path: path.join(ART, "02-refresh-only-upload.png"), fullPage: true });

  // Pure guest after wiping session
  await page.evaluate(() => {
    ["mcjCompanionSession", "companionAuthToken", "companionUser"].forEach((k) => {
      try {
        localStorage.removeItem(k);
        sessionStorage.removeItem(k);
      } catch (e) {}
    });
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  const guest2 = await page.evaluate(() => {
    const layout = document.querySelector(".apply-layout");
    return {
      hasGate: !!document.querySelector(".apply-auth-gate"),
      display: layout ? getComputedStyle(layout).display : "none",
      layoutHidden: !layout || layout.hasAttribute("hidden") || getComputedStyle(layout).display === "none",
    };
  });
  step("guest_after_wipe_gate", guest2.hasGate && guest2.display === "none", JSON.stringify(guest2));
  await page.screenshot({ path: path.join(ART, "03-guest-after-wipe.png"), fullPage: true });

  void helperOk;
  fs.writeFileSync(path.join(ART, "results.json"), JSON.stringify({ results, base: BASE, useLocal: USE_LOCAL_JS }, null, 2));
  fs.writeFileSync(path.join(ART_REPO, "results.json"), JSON.stringify({ results, base: BASE, useLocal: USE_LOCAL_JS }, null, 2));
  for (const name of ["01-guest.png", "02-refresh-only-upload.png", "03-guest-after-wipe.png"]) {
    const src = path.join(ART, name);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(ART_REPO, name));
  }

  await browser.close();
  const failed = results.filter((r) => r.result === "FAIL");
  console.log(JSON.stringify({ failed: failed.length, results }, null, 2));
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
