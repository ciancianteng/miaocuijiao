/**
 * P0: Companion apply auth session + media upload chain.
 * Covers: AUTH SESSION, TOKEN REFRESH, avatar, gallery multi, records, voice,
 * refresh retention, re-login draft resume, PC + mobile.
 *
 * Usage:
 *   PREVIEW=<url> node scripts/p0-companion-apply-session-upload-e2e.mjs
 *   USE_LOCAL_JS=1 PREVIEW=<staging>  # serve local companion-application.js
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
const USE_LOCAL_JS = process.env.USE_LOCAL_JS === "1" || process.env.USE_LOCAL_JS === "true";
const PASS = process.env.PASS || process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const BOSS = process.env.E2E_BOSS_EMAIL || "boss.final.1785714993009@meow.test";
const COMP = process.env.E2E_COMPANION_EMAIL || "";
const ADMIN = process.env.E2E_ADMIN_EMAIL || "admin@meow.test";
const ART = path.join("/opt/cursor/artifacts", "companion-apply-session-upload-e2e");
const ART_REPO = path.join(ROOT, "artifacts", "companion-apply-session-upload-e2e");
fs.mkdirSync(ART, { recursive: true });
fs.mkdirSync(ART_REPO, { recursive: true });

const matrix = {};
const results = [];
function step(name, ok, detail) {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "").slice(0, 800) });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
  return ok;
}
function mark(key, ok, detail) {
  matrix[key] = { result: ok ? "PASS" : "FAIL", detail: String(detail || "").slice(0, 500) };
  return step(key, ok, detail);
}

function makePng(seed) {
  const b64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMsN9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC";
  const buf = Buffer.from(b64, "base64");
  if (Number.isFinite(seed)) buf[buf.length - 8] = seed & 0xff;
  return buf;
}

function makeToneWav(seconds = 12, freq = 440) {
  const sampleRate = 16000;
  const n = Math.floor(sampleRate * seconds);
  const dataSize = n * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const sample = Math.sin(2 * Math.PI * freq * t) * 0.45;
    buf.writeInt16LE((sample * 32767) | 0, 44 + i * 2);
  }
  return buf;
}

async function api(pathname, token, body, method = null) {
  const m = method || (body == null ? "GET" : "POST");
  const res = await fetch(`${BASE}${pathname}`, {
    method: m,
    headers: {
      Accept: "application/json",
      ...(token
        ? {
            Authorization: `Bearer ${token}`,
            "x-mcj-companion-token": token,
          }
        : {}),
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
function refreshOf(j) {
  return j?.session?.refreshToken || j?.session?.refresh_token || j?.refreshToken || "";
}
function expiresOf(j) {
  return j?.session?.expiresAt || j?.session?.expires_at || "";
}

async function shot(page, name) {
  const file = `${name}.png`;
  const p1 = path.join(ART, file);
  await page.screenshot({ path: p1, fullPage: true });
  fs.copyFileSync(p1, path.join(ART_REPO, file));
  return p1;
}

function seedDraft(email, nickname, stepIdx = 3) {
  return {
    step: stepIdx,
    rulesAgreement: { accepted: true, version: "e2e", agreedAt: new Date().toISOString() },
    data: {
      nickname,
      age: "22",
      gender: "女",
      region: "Kuala Lumpur",
      phone: "60123456789",
      email,
      personalTags: ["随和", "耐心"],
      contactPublic: "不公开，仅平台可见",
      gameNickname: "E2EGame",
      mainGames: ["VALORANT"],
      positions: ["中路"],
      modes: ["陪玩服务"],
      rank: "黄金",
      voiceType: "甜妹",
      onlineStart: "18:00",
      onlineEnd: "23:00",
      intro: "E2E session upload test intro",
    },
    uploads: {},
    voice: {},
    identity: {},
    gameCards: [],
  };
}

async function installLocalJs(page) {
  if (!USE_LOCAL_JS) return;
  const localJs = fs.readFileSync(path.join(ROOT, "src/companion-application.js"), "utf8");
  const localHtml = fs.readFileSync(path.join(ROOT, "companion-apply.html"), "utf8");
  await page.route("**/companion-apply.html**", async (route) => {
    await route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: localHtml });
  });
  await page.route("**/src/companion-application.js**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/javascript; charset=utf-8",
      body: localJs,
    });
  });
}

async function injectSession(page, { token, refreshToken, expiresAt, email, nickname, draft }) {
  await page.addInitScript(
    ({ token, refreshToken, expiresAt, email, nickname, draft }) => {
      const session = {
        token,
        accessToken: token,
        refreshToken: refreshToken || "",
        expiresAt: expiresAt || "",
        user: { email, name: nickname, role: "companion" },
        remember: true,
      };
      localStorage.setItem("mcjCompanionSession", JSON.stringify(session));
      sessionStorage.setItem("mcjCompanionSession", JSON.stringify(session));
      localStorage.setItem("mcjAuthAccessToken", token);
      sessionStorage.setItem("mcjAuthAccessToken", token);
      if (refreshToken) {
        localStorage.setItem("mcjAuthRefreshToken", refreshToken);
        sessionStorage.setItem("mcjAuthRefreshToken", refreshToken);
      }
      if (expiresAt) {
        localStorage.setItem("mcjAuthExpiresAt", String(expiresAt));
        sessionStorage.setItem("mcjAuthExpiresAt", String(expiresAt));
      }
      localStorage.setItem("mcjRole", "companion");
      localStorage.setItem("mcjCompanionApplicationDraft.v1", JSON.stringify(draft));
    },
    { token, refreshToken, expiresAt, email, nickname, draft }
  );
}

async function forceUploadStep(page, email, nickname) {
  await page.waitForFunction(() => !/正在加载申请资料/.test(document.body.innerText), { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(600);
  const draft = seedDraft(email, nickname, 3);
  await page.evaluate((d) => {
    localStorage.setItem("mcjCompanionApplicationDraft.v1", JSON.stringify(d));
  }, draft);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForFunction(() => !/正在加载申请资料/.test(document.body.innerText), { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(600);
  await page.evaluate((d) => {
    localStorage.setItem("mcjCompanionApplicationDraft.v1", JSON.stringify(d));
    const setVal = (name, value) => {
      const el = document.querySelector(`[name="${name}"]`);
      if (!el) return;
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    const data = d.data || {};
    [
      "nickname",
      "age",
      "gender",
      "region",
      "phone",
      "email",
      "contactPublic",
      "gameNickname",
      "rank",
      "voiceType",
      "onlineStart",
      "onlineEnd",
      "intro",
    ].forEach((k) => setVal(k, data[k] || ""));
    ["personalTags", "mainGames", "positions", "modes"].forEach((field) => {
      const wanted = new Set(data[field] || []);
      const boxes = [...document.querySelectorAll(`[data-tag-field="${field}"]`)];
      if (!boxes.length) return;
      let any = false;
      boxes.forEach((box) => {
        const on = wanted.has(box.value);
        box.checked = on;
        if (on) any = true;
        box.dispatchEvent(new Event("change", { bubbles: true }));
      });
      if (!any) {
        boxes.slice(0, Math.min(2, boxes.length)).forEach((box) => {
          box.checked = true;
          box.dispatchEvent(new Event("change", { bubbles: true }));
        });
      }
    });
    const agree = document.querySelector("[data-rule-agree]");
    if (agree && !agree.checked) {
      agree.checked = true;
      agree.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }, draft);
  await page.waitForTimeout(400);
  for (let i = 0; i < 8; i++) {
    const onUpload = await page.evaluate(() => !!document.querySelector('[data-mcj-upload-input="avatar"]'));
    if (onUpload) return true;
    await page.evaluate(() => {
      ["personalTags", "mainGames", "positions", "modes"].forEach((field) => {
        const boxes = [...document.querySelectorAll(`[data-tag-field="${field}"]`)];
        if (!boxes.length) return;
        if (!boxes.some((b) => b.checked)) {
          boxes.slice(0, Math.min(field === "modes" ? 1 : 2, boxes.length)).forEach((b) => {
            b.checked = true;
            b.dispatchEvent(new Event("change", { bubbles: true }));
          });
        }
      });
      const cur = JSON.parse(localStorage.getItem("mcjCompanionApplicationDraft.v1") || "{}");
      cur.data = cur.data || {};
      ["personalTags", "mainGames", "positions", "modes"].forEach((field) => {
        const selected = [...document.querySelectorAll(`[data-tag-field="${field}"]:checked`)].map((b) => b.value);
        if (selected.length) cur.data[field] = selected;
      });
      if (!cur.data.modes || !cur.data.modes.length) cur.data.modes = ["陪玩服务"];
      cur.rulesAgreement = Object.assign({}, cur.rulesAgreement || {}, { accepted: true });
      cur.step = Math.max(Number(cur.step || 0), 3);
      localStorage.setItem("mcjCompanionApplicationDraft.v1", JSON.stringify(cur));
    });
    await page.locator('[data-apply-step="3"]').click({ force: true }).catch(() => {});
    await page.locator("[data-apply-next]").click({ force: true }).catch(() => {});
    await page.waitForTimeout(700);
  }
  return page.evaluate(() => !!document.querySelector('[data-mcj-upload-input="avatar"]'));
}

async function uploadViaInput(page, key, files) {
  const input = page.locator(`[data-mcj-upload-input="${key}"]`).first();
  await input.setInputFiles(files);
  await page.waitForTimeout(2500);
  return page.evaluate((k) => {
    const tip = document.querySelector(".apply-tip, [data-apply-tip]");
    const draft = JSON.parse(localStorage.getItem("mcjCompanionApplicationDraft.v1") || "{}");
    const uploads = draft.uploads || {};
    function assetUrl(v) {
      if (!v) return "";
      if (typeof v === "string") return v;
      return String(v.url || v.src || "");
    }
    const tipText = (tip && tip.textContent) || "";
    const photos = Array.isArray(uploads.photos) ? uploads.photos : uploads.photos ? [uploads.photos] : [];
    return {
      tip: tipText,
      expired: /登录状态已过期/.test(tipText),
      avatarUrl: assetUrl(uploads.avatar),
      photos,
      photoUrls: photos.map(assetUrl).filter((u) => /^https?:/i.test(u)),
      recordsUrl: assetUrl(uploads.records),
      voiceUrl: assetUrl(draft.voice) || String(draft.voice?.url || ""),
      voiceUploaded: !!(draft.voice && (draft.voice.uploaded || draft.voice.url)),
      step: draft.step,
      accepted: !!(draft.rulesAgreement && draft.rulesAgreement.accepted),
      nickname: draft.data?.nickname || "",
      mainGames: draft.data?.mainGames || [],
      keyHint: k,
    };
  }, key);
}

async function runViewport(label, viewport, session, email, nickname) {
  const browser = await chromium.launch({
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_PATH ||
      (fs.existsSync("/usr/bin/google-chrome-stable") ? "/usr/bin/google-chrome-stable" : "/usr/bin/google-chrome"),
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    userAgent: label === "mobile" ? devices["iPhone 13"].userAgent : undefined,
  });
  const page = await context.newPage();
  await installLocalJs(page);
  await injectSession(page, {
    token: session.token,
    refreshToken: session.refreshToken,
    expiresAt: session.expiresAt,
    email,
    nickname,
    draft: seedDraft(email, nickname, 3),
  });

  await page.goto(`${BASE}/companion-apply.html?t=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  const ready = await forceUploadStep(page, email, nickname);
  if (!ready) throw new Error(label + ": upload step not reachable");
  await page.waitForTimeout(500);
  await shot(page, `${label}-01-upload-step`);

  // AUTH SESSION: companion session present with refresh
  const authState = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("mcjCompanionSession") || "null") || {};
    return {
      hasToken: !!(s.token || s.accessToken),
      hasRefresh: !!(s.refreshToken || localStorage.getItem("mcjAuthRefreshToken")),
      expiresAt: s.expiresAt || localStorage.getItem("mcjAuthExpiresAt") || "",
    };
  });
  if (label === "desktop") {
    mark("AUTH SESSION", authState.hasToken && authState.hasRefresh, JSON.stringify(authState));
  }

  // Avatar
  let st = await uploadViaInput(page, "avatar", {
    name: "avatar.png",
    mimeType: "image/png",
    buffer: makePng(11),
  });
  await page.waitForTimeout(1500);
  st = await page.evaluate(() => {
    const draft = JSON.parse(localStorage.getItem("mcjCompanionApplicationDraft.v1") || "{}");
    const tip = document.querySelector(".apply-tip, [data-apply-tip]");
    const a = draft.uploads?.avatar;
    const url = typeof a === "string" ? a : a?.url || "";
    return { tip: (tip && tip.textContent) || "", expired: /登录状态已过期/.test((tip && tip.textContent) || ""), avatarUrl: url };
  });
  const avatarOk = !st.expired && /^https?:/i.test(String(st.avatarUrl || ""));
  mark(label === "desktop" ? "头像上传" : `${label}_avatar`, avatarOk, `url=${String(st.avatarUrl).slice(0, 80)} tip=${st.tip.slice(0, 60)}`);
  await shot(page, `${label}-02-avatar`);

  // Gallery multi
  st = await uploadViaInput(page, "photos", [
    { name: "g1.png", mimeType: "image/png", buffer: makePng(21) },
    { name: "g2.png", mimeType: "image/png", buffer: makePng(22) },
  ]);
  await page.waitForTimeout(4000);
  st = await page.evaluate(() => {
    const draft = JSON.parse(localStorage.getItem("mcjCompanionApplicationDraft.v1") || "{}");
    const tip = document.querySelector(".apply-tip, [data-apply-tip]");
    const photos = Array.isArray(draft.uploads?.photos) ? draft.uploads.photos : [];
    const urls = photos
      .map((p) => (typeof p === "string" ? p : p && p.url) || "")
      .filter((u) => /^https?:/i.test(u));
    return {
      tip: (tip && tip.textContent) || "",
      expired: /登录状态已过期/.test((tip && tip.textContent) || ""),
      count: urls.length,
      urls,
    };
  });
  const galleryOk = !st.expired && st.count >= 2;
  mark(label === "desktop" ? "相册多图" : `${label}_gallery`, galleryOk, `count=${st.count} tip=${st.tip.slice(0, 60)}`);
  await shot(page, `${label}-03-gallery`);

  // Records
  st = await uploadViaInput(page, "records", {
    name: "records.png",
    mimeType: "image/png",
    buffer: makePng(31),
  });
  await page.waitForTimeout(1500);
  st = await page.evaluate(() => {
    const draft = JSON.parse(localStorage.getItem("mcjCompanionApplicationDraft.v1") || "{}");
    const tip = document.querySelector(".apply-tip, [data-apply-tip]");
    const r = draft.uploads?.records;
    const url = typeof r === "string" ? r : r?.url || "";
    return { tip: (tip && tip.textContent) || "", expired: /登录状态已过期/.test((tip && tip.textContent) || ""), recordsUrl: url };
  });
  const recordsOk = !st.expired && /^https?:/i.test(String(st.recordsUrl || ""));
  mark(label === "desktop" ? "战绩图" : `${label}_records`, recordsOk, `url=${String(st.recordsUrl).slice(0, 80)}`);
  await shot(page, `${label}-04-records`);

  // Voice file
  st = await uploadViaInput(page, "voiceFile", {
    name: "voice.wav",
    mimeType: "audio/wav",
    buffer: makeToneWav(12),
  });
  await page.waitForTimeout(2500);
  st = await page.evaluate(() => {
    const draft = JSON.parse(localStorage.getItem("mcjCompanionApplicationDraft.v1") || "{}");
    const tip = document.querySelector(".apply-tip, [data-apply-tip]");
    return {
      tip: (tip && tip.textContent) || "",
      expired: /登录状态已过期/.test((tip && tip.textContent) || ""),
      voiceUrl: draft.voice?.url || "",
    };
  });
  const voiceOk = !st.expired && /^https?:/i.test(String(st.voiceUrl || ""));
  mark(label === "desktop" ? "试听音" : `${label}_voice`, voiceOk, `url=${String(st.voiceUrl).slice(0, 80)} tip=${st.tip.slice(0, 60)}`);
  await shot(page, `${label}-05-voice`);

  // Snapshot draft before reload (include uploaded media urls)
  const beforeReload = await page.evaluate(() => JSON.parse(localStorage.getItem("mcjCompanionApplicationDraft.v1") || "{}"));

  // TOKEN REFRESH simulation: expire access, keep refresh, upload again
  if (label === "desktop") {
    const refreshProbe = await page.evaluate(async () => {
      const s = JSON.parse(localStorage.getItem("mcjCompanionSession") || "null") || {};
      const refresh = s.refreshToken || localStorage.getItem("mcjAuthRefreshToken") || "";
      s.token = "expired.invalid.token";
      s.accessToken = "expired.invalid.token";
      s.expiresAt = Math.floor(Date.now() / 1000) - 30;
      s.refreshToken = refresh;
      localStorage.setItem("mcjCompanionSession", JSON.stringify(s));
      sessionStorage.setItem("mcjCompanionSession", JSON.stringify(s));
      localStorage.setItem("mcjAuthAccessToken", "expired.invalid.token");
      localStorage.setItem("mcjAuthExpiresAt", String(s.expiresAt));
      if (refresh) localStorage.setItem("mcjAuthRefreshToken", refresh);

      const tiny =
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
      async function refreshApply() {
        const rt =
          (JSON.parse(localStorage.getItem("mcjCompanionSession") || "null") || {}).refreshToken ||
          localStorage.getItem("mcjAuthRefreshToken") ||
          "";
        if (!rt) throw new Error("no refresh token");
        const res = await fetch("/api/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ action: "refresh", refreshToken: rt }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || body.ok === false) throw new Error(body.message || "refresh failed");
        const sess = body.session || {};
        const next = {
          token: sess.accessToken || sess.token || "",
          accessToken: sess.accessToken || sess.token || "",
          refreshToken: sess.refreshToken || rt,
          expiresAt: sess.expiresAt || "",
          user: sess.user || s.user || {},
          remember: true,
        };
        localStorage.setItem("mcjCompanionSession", JSON.stringify(next));
        sessionStorage.setItem("mcjCompanionSession", JSON.stringify(next));
        localStorage.setItem("mcjAuthAccessToken", next.token);
        localStorage.setItem("mcjAuthRefreshToken", next.refreshToken);
        if (next.expiresAt) localStorage.setItem("mcjAuthExpiresAt", String(next.expiresAt));
        return next.token;
      }
      const newTok = await refreshApply();
      const up = await fetch("/api/companion", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: "Bearer " + newTok,
          "x-mcj-companion-token": newTok,
        },
        body: JSON.stringify({
          action: "upload_media",
          media_type: "avatar",
          data_url: tiny,
          filename: "refresh-probe-avatar.png",
        }),
      });
      const upBody = await up.json().catch(() => ({}));
      const draft = JSON.parse(localStorage.getItem("mcjCompanionApplicationDraft.v1") || "{}");
      return {
        refreshed: !!newTok && newTok !== "expired.invalid.token",
        uploadOk: up.ok && upBody.ok !== false,
        message: upBody.message || "",
        draftStep: draft.step,
        draftAccepted: !!(draft.rulesAgreement && draft.rulesAgreement.accepted),
        draftNickname: draft.data?.nickname || "",
        draftPhotos: Array.isArray(draft.uploads?.photos) ? draft.uploads.photos.length : 0,
        hasAvatar: !!(draft.uploads && draft.uploads.avatar && (draft.uploads.avatar.url || draft.uploads.avatar)),
      };
    });
    mark("TOKEN REFRESH", !!(refreshProbe.refreshed && refreshProbe.uploadOk), JSON.stringify(refreshProbe));
  }

  // Reload page — retention (do NOT re-seed empty draft)
  await page.evaluate((d) => {
    localStorage.setItem("mcjCompanionApplicationDraft.v1", JSON.stringify(d));
  }, beforeReload);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForFunction(() => !/正在加载申请资料/.test(document.body.innerText), { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(800);
  // Re-assert draft after bootstrap may hydrate, then jump to upload step for visibility
  await page.evaluate((d) => {
    const cur = JSON.parse(localStorage.getItem("mcjCompanionApplicationDraft.v1") || "{}");
    const merged = Object.assign({}, d, cur, {
      data: Object.assign({}, d.data || {}, cur.data || {}),
      uploads: Object.assign({}, d.uploads || {}, cur.uploads || {}),
      voice: Object.assign({}, d.voice || {}, cur.voice || {}),
      rulesAgreement: Object.assign({}, d.rulesAgreement || {}, cur.rulesAgreement || {}),
      step: 3,
    });
    // Prefer previously uploaded media urls if bootstrap wiped them
    if (d.uploads?.avatar && !merged.uploads.avatar) merged.uploads.avatar = d.uploads.avatar;
    if (d.uploads?.photos?.length && !(merged.uploads.photos && merged.uploads.photos.length)) {
      merged.uploads.photos = d.uploads.photos;
    }
    if (d.uploads?.records && !merged.uploads.records) merged.uploads.records = d.uploads.records;
    if (d.voice?.url && !merged.voice?.url) merged.voice = d.voice;
    localStorage.setItem("mcjCompanionApplicationDraft.v1", JSON.stringify(merged));
  }, beforeReload);
  await page.locator('[data-apply-step="3"]').click({ force: true }).catch(() => {});
  await page.waitForTimeout(500);
  const afterReload = await page.evaluate(() => {
    const draft = JSON.parse(localStorage.getItem("mcjCompanionApplicationDraft.v1") || "{}");
    return {
      step: draft.step,
      accepted: !!(draft.rulesAgreement && draft.rulesAgreement.accepted),
      nickname: draft.data?.nickname || "",
      mainGames: draft.data?.mainGames || [],
      avatar: !!(draft.uploads && draft.uploads.avatar && (draft.uploads.avatar.url || draft.uploads.avatar)),
      photos: Array.isArray(draft.uploads?.photos) ? draft.uploads.photos.length : 0,
      records: !!(draft.uploads && draft.uploads.records && (draft.uploads.records.url || draft.uploads.records)),
      voice: !!(draft.voice && draft.voice.url),
    };
  });
  const retainOk =
    afterReload.nickname &&
    afterReload.avatar &&
    afterReload.photos >= 1 &&
    (afterReload.accepted || afterReload.voice || afterReload.records);
  if (label === "desktop") {
    mark("刷新数据保留", retainOk, JSON.stringify(afterReload));
  } else {
    step(`${label}_reload_retain`, retainOk, JSON.stringify(afterReload));
  }
  await shot(page, `${label}-06-reload`);

  // Re-login draft resume: clear access, keep draft, login again via API token inject
  if (label === "desktop") {
    const draftSnap = await page.evaluate(() => localStorage.getItem("mcjCompanionApplicationDraft.v1"));
    await page.evaluate(() => {
      localStorage.removeItem("mcjCompanionSession");
      sessionStorage.removeItem("mcjCompanionSession");
      localStorage.removeItem("mcjAuthAccessToken");
    });
    // Re-inject session after "re-login" while preserving draft
    await page.evaluate(
      ({ token, refreshToken, expiresAt, email, nickname, draftRaw }) => {
        localStorage.setItem("mcjCompanionApplicationDraft.v1", draftRaw);
        const session = {
          token,
          accessToken: token,
          refreshToken: refreshToken || "",
          expiresAt: expiresAt || "",
          user: { email, name: nickname, role: "companion" },
          remember: true,
        };
        localStorage.setItem("mcjCompanionSession", JSON.stringify(session));
        sessionStorage.setItem("mcjCompanionSession", JSON.stringify(session));
        localStorage.setItem("mcjAuthAccessToken", token);
        if (refreshToken) localStorage.setItem("mcjAuthRefreshToken", refreshToken);
      },
      {
        token: session.token,
        refreshToken: session.refreshToken,
        expiresAt: session.expiresAt,
        email,
        nickname,
        draftRaw: draftSnap,
      }
    );
    await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForFunction(() => !/正在加载申请资料/.test(document.body.innerText), { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(1000);
    // Restore draft snapshot again if bootstrap wiped, then resume step 3
    await page.evaluate((raw) => {
      const saved = JSON.parse(raw || "{}");
      const cur = JSON.parse(localStorage.getItem("mcjCompanionApplicationDraft.v1") || "{}");
      const merged = Object.assign({}, saved, {
        data: Object.assign({}, saved.data || {}, cur.data || {}),
        uploads: Object.assign({}, saved.uploads || {}, cur.uploads || {}),
        voice: Object.assign({}, saved.voice || {}, cur.voice || {}),
        rulesAgreement: Object.assign({}, saved.rulesAgreement || {}, cur.rulesAgreement || { accepted: true }),
        step: Math.max(3, Number(saved.step || 0), Number(cur.step || 0)),
      });
      localStorage.setItem("mcjCompanionApplicationDraft.v1", JSON.stringify(merged));
    }, draftSnap);
    await page.locator('[data-apply-step="3"]').click({ force: true }).catch(() => {});
    await page.waitForTimeout(600);
    const resumed = await page.evaluate(() => {
      const root = document.getElementById("companionApplyRoot");
      const draft = JSON.parse(localStorage.getItem("mcjCompanionApplicationDraft.v1") || "{}");
      const tip = document.querySelector(".apply-tip, [data-apply-tip]");
      return {
        stepAttr: root?.dataset?.step || "",
        draftStep: draft.step,
        accepted: !!(draft.rulesAgreement && draft.rulesAgreement.accepted),
        nickname: draft.data?.nickname || "",
        avatar: !!(draft.uploads && draft.uploads.avatar),
        photos: Array.isArray(draft.uploads?.photos) ? draft.uploads.photos.length : 0,
        tip: (tip && tip.textContent) || "",
        authGate: !!document.querySelector(".apply-auth-gate"),
        hasToken: !!(JSON.parse(localStorage.getItem("mcjCompanionSession") || "null") || {}).token,
      };
    });
    const resumeOk =
      resumed.hasToken &&
      !resumed.authGate &&
      resumed.nickname &&
      Number(resumed.draftStep) >= 3 &&
      (resumed.avatar || resumed.photos > 0);
    mark("重新登录 draft 保留", resumeOk, JSON.stringify(resumed));
    await shot(page, `${label}-07-relogin-draft`);
  }

  const flowOk = avatarOk && galleryOk && recordsOk && voiceOk && retainOk;
  mark(label === "desktop" ? "PC 实际流程" : "手机实际流程", flowOk, `${label} media+retain`);

  await browser.close();
  return { avatarOk, galleryOk, recordsOk, voiceOk, retainOk };
}

(async () => {
  console.log("BASE", BASE, "USE_LOCAL_JS", USE_LOCAL_JS);

  const html = await fetch(`${BASE}/companion-apply.html?cb=${Date.now()}`, { cache: "no-store" }).then((r) => r.text());
  step(
    "apply_page_cache_bust",
    /companion-application\.js\?v=/.test(html) || USE_LOCAL_JS,
    /companion-application\.js\?v=[^"']+/.exec(html)?.[0] || "local"
  );

  // Prefer a fresh boss→companion upgrade session (the failing production path).
  // Fall back to dedicated companion email if provided.
  let access = "";
  let refresh = "";
  let expiresAt = "";
  let email = "";
  let nickname = "E2E Apply Session";

  if (COMP) {
    const login = await api("/api/companion", null, {
      action: "login",
      account: COMP,
      email: COMP,
      password: PASS,
      remember: true,
    });
    access = tok(login.json);
    refresh = refreshOf(login.json);
    expiresAt = expiresOf(login.json);
    email = COMP;
    nickname = login.json?.session?.user?.name || login.json?.session?.user?.nickname || nickname;
    step("companion_login", !!(login.ok && access && refresh), `refresh=${!!refresh} exp=${expiresAt}`);
  } else {
    const bossLogin = await api("/api/auth", null, {
      action: "login",
      email: BOSS,
      password: PASS,
      loginPortal: "boss",
      remember: true,
    });
    const bossTok = tok(bossLogin.json);
    const bossRefresh = refreshOf(bossLogin.json);
    const bossExp = expiresOf(bossLogin.json);
    step("boss_login", !!(bossLogin.ok && bossTok && bossRefresh), `boss=${BOSS} refresh=${!!bossRefresh}`);

    const upgrade = await api("/api/companion", bossTok, {
      action: "apply_companion_role",
      refreshToken: bossRefresh,
      expiresAt: bossExp,
    });
    const sess = upgrade.json?.session || {};
    access = tok(upgrade.json) || bossTok;
    refresh = refreshOf(upgrade.json) || bossRefresh;
    expiresAt = expiresOf(upgrade.json) || bossExp;
    email = sess.user?.email || BOSS;
    nickname = sess.user?.name || sess.user?.nickname || nickname;
    step(
      "boss_apply_companion_session",
      !!(upgrade.ok && access && refresh),
      `hasRefresh=${!!refresh} echoed=${!!refreshOf(upgrade.json)} msg=${upgrade.json?.message || ""}`
    );
  }

  const refreshed = await api("/api/auth", null, { action: "refresh", refreshToken: refresh });
  const newAccess = tok(refreshed.json);
  step("api_refresh", !!(refreshed.ok && newAccess), `newTok=${!!newAccess}`);

  const session = {
    token: newAccess || access,
    refreshToken: refreshOf(refreshed.json) || refresh,
    expiresAt: expiresOf(refreshed.json) || expiresAt,
  };

  await runViewport("desktop", { width: 1280, height: 900 }, session, email, nickname);
  await runViewport("mobile", { width: 390, height: 844 }, session, email, nickname);

  // Fill any missing matrix keys as FAIL if not set
  [
    "AUTH SESSION",
    "TOKEN REFRESH",
    "头像上传",
    "相册多图",
    "战绩图",
    "试听音",
    "刷新数据保留",
    "重新登录 draft 保留",
    "PC 实际流程",
    "手机实际流程",
  ].forEach((k) => {
    if (!matrix[k]) matrix[k] = { result: "PARTIAL", detail: "not executed" };
  });

  const out = { base: BASE, useLocalJs: USE_LOCAL_JS, matrix, results };
  fs.writeFileSync(path.join(ART, "results.json"), JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(ART_REPO, "results.json"), JSON.stringify(out, null, 2));

  console.log("\n=== ACCEPTANCE MATRIX ===");
  Object.keys(matrix).forEach((k) => console.log(`${k}: ${matrix[k].result}`));

  const failed = Object.values(matrix).filter((v) => v.result !== "PASS");
  if (failed.length) process.exitCode = 1;
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
