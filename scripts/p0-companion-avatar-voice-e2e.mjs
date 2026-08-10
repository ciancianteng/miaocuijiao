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
  const data = before.json?.data || before.json || {};
  const player = data.player || {};
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

  const services = await api("/api/platform/services?scope=profile", null, null, "GET");
  const valorant =
    (services.json?.services || []).find((s) => /VALORANT/i.test(String(s.name || ""))) ||
    (services.json?.services || [])[0];
  const sid = valorant?.id || "";
  const save = await api("/api/companion", token, {
    action: "update_profile",
    nickname: player.name || player.nickname || "E2E陪玩",
    age: player.age || 23,
    gender: player.gender || "女",
    region: player.region || "马来西亚",
    voice_type: "甜妹、慵懒",
    voiceType: "甜妹、慵懒",
    service_type: "陪玩服务",
    service_ids: sid ? [sid] : [],
    main_game: valorant?.name || "VALORANT",
    game_id: player.gameId || player.game_id || "E2E-ID",
    game_prices: sid ? { [sid]: 28, [valorant.name]: 28 } : { VALORANT: 28 },
    bio: player.bio || "e2e",
  });
  step("voice_save", !!save.ok, `msg=${save.json?.message || ""} sid=${sid}`);

  const after = await api("/api/companion?action=bootstrap", token, null, "GET");
  const p2 = after.json?.data?.player || after.json?.player || {};
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

  const html = await (await fetch(`${BASE}/companion/profile/?cb=${Date.now()}`, { cache: "no-store" })).text();
  step(
    "asset_workbench_bundle",
    /companion-workbench-[A-Za-z0-9_-]+\.(js|css)/.test(html),
    /companion-workbench[^"' ]+/.exec(html)?.[0] || "missing"
  );

  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || "/usr/bin/google-chrome-stable",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const context = await browser.newContext({ ...devices["iPhone 13"] });
    const page = await context.newPage();
    const access = token;
    const refresh = login.json?.session?.refreshToken || login.json?.session?.refresh_token || "";
    const user = login.json?.profile || login.json?.user || { email: COMPANION, role: "companion" };
    await page.addInitScript(
      ({ access, refresh, user }) => {
        try {
          const session = {
            token: access,
            accessToken: access,
            refreshToken: refresh,
            user: Object.assign({}, user, { role: "companion" }),
            remember: true,
          };
          localStorage.setItem("mcjCompanionSession", JSON.stringify(session));
          sessionStorage.setItem("mcjCompanionSession", JSON.stringify(session));
          localStorage.setItem("mcjAuthAccessToken", access);
          sessionStorage.setItem("mcjAuthAccessToken", access);
          if (refresh) {
            localStorage.setItem("mcjAuthRefreshToken", refresh);
            sessionStorage.setItem("mcjAuthRefreshToken", refresh);
          }
          localStorage.setItem("companionAuthToken", "companion_session_v4_e2e");
          sessionStorage.setItem("companionAuthToken", "companion_session_v4_e2e");
          localStorage.setItem("companionUser", JSON.stringify(session.user));
          sessionStorage.setItem("companionUser", JSON.stringify(session.user));
          localStorage.setItem("mcjRole", "companion");
          sessionStorage.setItem("mcjRole", "companion");
        } catch (e) {}
      },
      { access, refresh, user }
    );
    // Use deployed Vite bundle (already contains fix). Do not replace ESM hashed chunk with IIFE source.
    await page.goto(`${BASE}/companion/profile/?cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    try {
      await page.waitForSelector("[data-pw-pick-avatar], input[name=\"voice_type_opt\"], .pw-profile-form", {
        timeout: 20000,
      });
    } catch {
      /* fall through to assertions */
    }
    await page.waitForTimeout(1500);
    await shot(page, "01-profile");
    const ui = await page.evaluate(() => {
      const text = document.body?.innerText || "";
      return {
        href: location.href,
        chooseFile: /Choose File|no file selected/i.test(text),
        hasPick: !!document.querySelector("[data-pw-pick-avatar]"),
        hasNativeAvatarInput: !!document.querySelector("[data-upload-avatar]"),
        voiceChips: document.querySelectorAll('input[name="voice_type_opt"]').length,
        adminHint: /声线管理|请联系后台/.test(text),
        tagAdminHint: /后台暂未配置标签，请联系管理员/.test(text),
        h2: [...document.querySelectorAll("h2")].map((h) => h.textContent).slice(0, 3),
        snippet: text.replace(/\s+/g, " ").slice(0, 220),
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
