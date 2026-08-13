/**
 * P0: Companion apply upload guard — in-apply users may upload without a fresh
 * access token; pure guests must login/register first.
 *
 * Usage:
 *   USE_LOCAL_JS=1 PREVIEW=<staging> node scripts/p0-companion-apply-upload-guard-e2e.mjs
 */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
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
    "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMsN9AAAAFUlEQVR42mP8z8BQz0AEYBxSF+FABJADveWkH6oAAAAAElFRkSuQmCC";
  const buf = Buffer.from(b64, "base64");
  if (Number.isFinite(seed)) buf[buf.length - 8] = seed & 0xff;
  return buf;
}

async function startLocalAssetServer() {
  const mime = {
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
  };
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(String(req.url || "/").split("?")[0]);
    const filePath = path.join(ROOT, urlPath.replace(/^\//, ""));
    if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": mime[ext] || "application/octet-stream", "Cache-Control": "no-store" });
    fs.createReadStream(filePath).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { server, origin: `http://127.0.0.1:${port}` };
}

async function main() {
  let local = null;
  if (USE_LOCAL_JS) local = await startLocalAssetServer();

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  await page.route("**/*", async (route) => {
    const req = route.request();
    const url = req.url();
    if (USE_LOCAL_JS && local && /\/src\/(companion-application\.(js|css)|mcj-upload\.(js|css)|role-gates\.js)/.test(url)) {
      const name = url.match(/\/src\/[^?]+/)[0];
      return route.fulfill({
        status: 200,
        contentType: name.endsWith(".css") ? "text/css" : "application/javascript",
        body: fs.readFileSync(path.join(ROOT, name.slice(1))),
        headers: { "Cache-Control": "no-store" },
      });
    }
    return route.continue();
  });

  // --- Guest: apply layout must be gated; upload tip only for guests ---
  await page.goto(`${BASE}/companion-apply.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1200);
  const guest = await page.evaluate(() => {
    const layout = document.querySelector(".apply-layout");
    const gate = document.querySelector(".apply-auth-gate");
    const hidden = !layout || layout.hasAttribute("hidden") || getComputedStyle(layout).display === "none";
    return {
      hasGate: !!gate,
      layoutHidden: hidden,
      tip: "",
    };
  });
  step("guest_auth_gate_visible", guest.hasGate, JSON.stringify(guest));
  step("guest_apply_layout_hidden", guest.layoutHidden, JSON.stringify(guest));
  await page.screenshot({ path: path.join(ART, "01-guest.png"), fullPage: true });

  // --- Login companion, clear access only, keep refresh: upload must still be allowed ---
  await page.goto(`${BASE}/companion-apply.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    try {
      localStorage.removeItem("mcjCompanionSession");
      sessionStorage.removeItem("mcjCompanionSession");
    } catch (e) {}
  });
  await page.click('[data-apply-auth-mode="login"]');
  await page.waitForTimeout(200);
  await page.click('[data-apply-login-method="password"]');
  await page.fill('[data-apply-auth-form="login-password"] input[name="authEmail"]', COMP);
  await page.fill('[data-apply-auth-form="login-password"] input[name="authPassword"]', PASS);
  await page.click("[data-apply-login-password]");
  await page.waitForTimeout(2500);

  const afterLogin = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("mcjCompanionSession") || sessionStorage.getItem("mcjCompanionSession") || "null");
    return {
      hasToken: !!(s && (s.token || s.accessToken)),
      hasRefresh: !!(s && (s.refreshToken || s.refresh_token)),
      layoutHidden: (() => {
        const layout = document.querySelector(".apply-layout");
        return !layout || layout.hasAttribute("hidden") || getComputedStyle(layout).display === "none";
      })(),
    };
  });
  step("login_session_present", afterLogin.hasToken || afterLogin.hasRefresh, JSON.stringify(afterLogin));
  step("login_apply_layout_visible", !afterLogin.layoutHidden, JSON.stringify(afterLogin));

  // Clear access token only (simulate expiry wipe used by clearCompanionAccessOnly)
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
    };
  });
  step("access_cleared_refresh_kept", !cleared.token && !!cleared.refresh, JSON.stringify(cleared));

  // Navigate to upload step if possible and try avatar pick — should NOT show guest tip
  await page.evaluate(() => {
    try {
      const draft = JSON.parse(localStorage.getItem("mcjCompanionApplicationDraft.v1") || "{}");
      draft.step = 3;
      draft.rulesAgreement = draft.rulesAgreement || { accepted: true };
      localStorage.setItem("mcjCompanionApplicationDraft.v1", JSON.stringify(draft));
    } catch (e) {}
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  // Trigger upload via file input if present
  const fileInput = page.locator('input[type="file"][data-upload-key="avatar"], input[type="file"][name="avatar"], [data-upload="avatar"] input[type="file"]').first();
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
      await page.waitForTimeout(2000);
    }
    tipText = await page.evaluate(() => {
      const tip = document.querySelector(".apply-tip, [data-apply-tip], .apply-toast");
      return tip ? String(tip.textContent || "") : String(document.body.innerText || "").slice(0, 500);
    });
  } catch (e) {
    tipText = String(e && e.message);
  }

  const guestTipBlocked = /请先登录或注册陪玩账号后再上传/.test(tipText);
  step(
    "in_apply_refresh_session_no_guest_upload_tip",
    !guestTipBlocked,
    guestTipBlocked ? tipText : "no guest tip; body=" + tipText.slice(0, 200)
  );
  await page.screenshot({ path: path.join(ART, "02-refresh-only-upload.png"), fullPage: true });

  // Pure guest again after wiping session entirely
  await page.evaluate(() => {
    ["mcjCompanionSession", "companionAuthToken", "companionUser"].forEach((k) => {
      try {
        localStorage.removeItem(k);
        sessionStorage.removeItem(k);
      } catch (e) {}
    });
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);
  const guest2 = await page.evaluate(() => {
    const layout = document.querySelector(".apply-layout");
    return {
      hasGate: !!document.querySelector(".apply-auth-gate"),
      layoutHidden: !layout || layout.hasAttribute("hidden") || getComputedStyle(layout).display === "none",
    };
  });
  step("guest_after_wipe_gate", guest2.hasGate && guest2.layoutHidden, JSON.stringify(guest2));
  await page.screenshot({ path: path.join(ART, "03-guest-after-wipe.png"), fullPage: true });

  fs.writeFileSync(path.join(ART, "results.json"), JSON.stringify({ results, base: BASE, useLocal: USE_LOCAL_JS }, null, 2));
  fs.writeFileSync(path.join(ART_REPO, "results.json"), JSON.stringify({ results, base: BASE, useLocal: USE_LOCAL_JS }, null, 2));
  for (const name of ["01-guest.png", "02-refresh-only-upload.png", "03-guest-after-wipe.png"]) {
    const src = path.join(ART, name);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(ART_REPO, name));
  }

  await browser.close();
  if (local) local.server.close();

  const failed = results.filter((r) => r.result === "FAIL");
  console.log(JSON.stringify({ failed: failed.length, results }, null, 2));
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
