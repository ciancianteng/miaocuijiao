/**
 * P0: Companion mobile avatar pick + self-select voice lines.
 * PREVIEW=https://... node scripts/p0-companion-avatar-voice-e2e.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, devices } from "playwright-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.PREVIEW || process.env.MCJ_STAGING_URL || "https://meow-cuijiao-homepage-staging.vercel.app").replace(
  /\/$/,
  ""
);
const PASS = process.env.PASS || "McjTest@12345678";
const COMPANION = process.env.E2E_COMPANION_EMAIL || "companion@meow.test";
const ART = path.join("/opt/cursor/artifacts", "companion-avatar-voice-e2e");
const ART_REPO = path.join(ROOT, "artifacts", "companion-avatar-voice-e2e");
fs.mkdirSync(ART, { recursive: true });
fs.mkdirSync(ART_REPO, { recursive: true });

const results = [];
function step(name, ok, detail) {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "").slice(0, 600) });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
  return !!ok;
}
async function api(pathname, token, body, method = null) {
  const m = method || (body == null ? "GET" : "POST");
  const res = await fetch(`${BASE}${pathname}`, {
    method: m,
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body != null ? { "Content-Type": "application/json" } : {}),
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok && json.ok !== false, status: res.status, json };
}
function tok(j) {
  return j?.session?.accessToken || j?.session?.token || j?.accessToken || j?.token || "";
}
function tinyPngDataUrl() {
  return (
    "data:image/png;base64," +
    "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC"
  );
}
async function shot(page, name) {
  const p = path.join(ART, `${name}.png`);
  await page.screenshot({ path: p, fullPage: true }).catch(() => null);
  try {
    fs.copyFileSync(p, path.join(ART_REPO, `${name}.png`));
  } catch {
    /* ignore */
  }
}

(async () => {
  console.log("BASE", BASE);
  const html = await (await fetch(`${BASE}/companion/profile/?cb=${Date.now()}`, { cache: "no-store" })).text();
  step(
    "asset_workbench_cache",
    /companion-workbench\.js\?v=20260810avatarVoice/.test(html),
    /companion-workbench\.js\?v=[^"']+/.exec(html)?.[0] || "missing"
  );

  const tagsApi = await api("/api/platform/content?types=companion_tags", null, null, "GET");
  step(
    "tags_library_readable",
    !!(tagsApi.ok && (tagsApi.json?.byType?.companion_tags || []).length),
    `n=${(tagsApi.json?.byType?.companion_tags || []).length} msg=${tagsApi.json?.message || ""}`
  );

  const login = await api("/api/auth", null, {
    action: "login",
    email: COMPANION,
    password: PASS,
    loginPortal: "companion",
  });
  const token = tok(login.json);
  step("companion_login", !!token, `email=${COMPANION}`);

  if (!token) {
    fs.writeFileSync(path.join(ART, "report.json"), JSON.stringify({ results }, null, 2));
    process.exit(1);
  }

  const before = await api("/api/companion?action=bootstrap", token, null, "GET");
  const player = before.json?.player || before.json?.data?.player || {};
  const companionId = player.id || player.uid || login.json?.profile?.id || "";
  step("bootstrap", !!(before.ok && companionId), `id=${companionId} voice=${player.voiceType || player.voice_type || ""}`);

  const upload = await api("/api/companion", token, {
    action: "upload_media",
    media_type: "avatar",
    data_url: tinyPngDataUrl(),
    filename: "e2e-avatar.png",
  });
  const avatarUrl = upload.json?.url || upload.json?.media?.url || "";
  step("avatar_upload_storage", !!(upload.ok && avatarUrl), `url=${String(avatarUrl).slice(0, 90)} msg=${upload.json?.message || ""}`);

  const voicePayload = {
    action: "update_profile",
    voice_type: "甜妹、慵懒",
    voiceType: "甜妹、慵懒",
  };
  // Keep required fields if API needs full profile — merge from current player
  const save = await api(
    "/api/companion",
    token,
    {
      action: "update_profile",
      nickname: player.nickname || player.name || "E2E陪玩",
      age: player.age || 23,
      gender: player.gender || "女",
      region: player.region || "马来西亚",
      voice_type: "甜妹、慵懒",
      voiceType: "甜妹、慵懒",
      service_type: player.serviceType || player.service_type || "陪玩服务",
      main_game: player.mainGame || player.game || "VALORANT",
      game_id: player.gameId || player.game_id || "E2E-ID",
      public_tags: player.publicTags || player.public_tags || "",
      bio: player.bio || player.description || "e2e",
    },
    "POST"
  );
  step("voice_save", !!save.ok, `msg=${save.json?.message || ""} voice=${save.json?.player?.voiceType || save.json?.companion?.voice_type || ""}`);

  const after = await api("/api/companion?action=bootstrap", token, null, "GET");
  const p2 = after.json?.player || after.json?.data?.player || {};
  step(
    "voice_persist_refresh",
    /甜妹/.test(String(p2.voiceType || p2.voice_type || "")) && /慵懒/.test(String(p2.voiceType || p2.voice_type || "")),
    `voice=${p2.voiceType || p2.voice_type || ""}`
  );
  step(
    "avatar_persist_refresh",
    !!(p2.hasCustomAvatar || (p2.avatar && p2.avatar !== "/default-avatar.png")),
    `avatar=${String(p2.avatar || "").slice(0, 80)}`
  );

  // Public / boss detail
  const pub = await api(`/api/public/companions?id=${encodeURIComponent(companionId)}`, null, null, "GET");
  const card =
    pub.json?.companion ||
    pub.json?.player ||
    (pub.json?.companions || []).find((c) => String(c.id) === String(companionId)) ||
    {};
  step(
    "boss_sees_same_voice",
    /甜妹/.test(String(card.voiceType || card.voice_type || "")),
    `voice=${card.voiceType || card.voice_type || ""} ok=${pub.ok}`
  );

  // UI: no Choose File text; has 上传头像 button; has voice chips
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || "/usr/bin/google-chrome-stable",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const context = await browser.newContext({ ...devices["iPhone 13"] });
    const page = await context.newPage();
    await page.addInitScript(
      ({ token }) => {
        try {
          localStorage.setItem("mcjAuthAccessToken", token);
          sessionStorage.setItem("mcjAuthAccessToken", token);
          localStorage.setItem("mcjCompanionAccessToken", token);
        } catch (e) {}
      },
      { token }
    );
    const localJs = fs.readFileSync(path.join(ROOT, "src/companion-workbench.js"), "utf8");
    const localCss = fs.readFileSync(path.join(ROOT, "src/companion-workbench.css"), "utf8");
    await page.route("**/src/companion-workbench.js**", (route) =>
      route.fulfill({ status: 200, contentType: "application/javascript", body: localJs })
    );
    await page.route("**/src/companion-workbench.css**", (route) =>
      route.fulfill({ status: 200, contentType: "text/css", body: localCss })
    );
    await page.goto(`${BASE}/companion/profile/?cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(3500);
    await shot(page, "01-profile");
    const ui = await page.evaluate(() => {
      const text = document.body?.innerText || "";
      return {
        chooseFile: /Choose File|no file selected/i.test(text),
        hasPick: !!document.querySelector("[data-pw-pick-avatar]"),
        hasNativeAvatarInput: !!document.querySelector("[data-upload-avatar]"),
        voiceChips: document.querySelectorAll('input[name="voice_type_opt"]').length,
        adminHint: /声线管理|请联系后台/.test(text),
        tagAdminHint: /后台暂未配置标签，请联系管理员/.test(text),
      };
    });
    step("ui_no_choose_file_text", ui.chooseFile === false, JSON.stringify(ui));
    step("ui_avatar_pick_button", ui.hasPick === true && ui.hasNativeAvatarInput === false, JSON.stringify(ui));
    step("ui_voice_multiselect", ui.voiceChips >= 10, `chips=${ui.voiceChips}`);
    step("ui_no_voice_admin_hint", ui.adminHint === false, `adminHint=${ui.adminHint}`);
    step("ui_no_fake_tag_admin_hint", ui.tagAdminHint === false, `tagHint=${ui.tagAdminHint}`);
  } finally {
    await browser.close().catch(() => null);
  }

  const report = { base: BASE, at: new Date().toISOString(), results, allPass: results.every((r) => r.result === "PASS") };
  fs.writeFileSync(path.join(ART, "report.json"), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(ART_REPO, "report.json"), JSON.stringify(report, null, 2));
  console.log("OVERALL", report.allPass ? "PASS" : "FAIL");
  process.exit(report.allPass ? 0 : 1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
