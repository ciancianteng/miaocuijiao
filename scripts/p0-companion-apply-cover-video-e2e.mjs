#!/usr/bin/env node
/**
 * P0: Apply game-cover vs album quota + showcase video direct upload.
 *
 * A) album at 6 → 7th gallery blocked; cover (游戏照封面) still succeeds
 * B) replace/delete cover does not change album count
 * C/D) PC + Mobile: video uses prepare_video_upload (no Vercel body 413 / no [object Object])
 *
 * Usage:
 *   USE_LOCAL_JS=1 PREVIEW=https://meow-cuijiao-homepage-staging.vercel.app \
 *     node scripts/p0-companion-apply-cover-video-e2e.mjs
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
const ART = path.join("/opt/cursor/artifacts", "companion-apply-cover-video-e2e");
fs.mkdirSync(ART, { recursive: true });

const results = [];
function step(name, ok, detail) {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "").slice(0, 1200) });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
  return ok;
}

function tinyPngDataUrl(n) {
  // Minimal valid 1x1 PNG; vary last bytes via comment is unnecessary — unique filename is enough.
  const png =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  return `data:image/png;base64,${png}`;
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
  const raw = await res.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { message: String(raw).slice(0, 200) };
  }
  return { status: res.status, data, raw };
}

async function registerFresh() {
  const stamp = Date.now();
  const email = `e2e-cover-vid-${stamp}@example.com`;
  const password = "TestPass1234";
  const nickname = "CoverVid" + String(stamp).slice(-4);
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

function galleryOf(boot) {
  const list = Array.isArray(boot?.media) ? boot.media : [];
  return list.filter((m) => {
    const mt = String(m.mediaType || m.media_type || "");
    const ctype = String(m.contentType || m.content_type || "");
    if (mt !== "gallery") return false;
    if (/^video\//i.test(ctype)) return false;
    if (Number(m.sortOrder ?? m.sort_order) === 1) return false;
    if (/\/cover\//i.test(String(m.storagePath || m.storage_path || ""))) return false;
    return true;
  });
}

function coverOf(boot) {
  const list = Array.isArray(boot?.media) ? boot.media : [];
  return list.filter((m) => String(m.mediaType || m.media_type || "") === "cover");
}

async function bootstrap(token) {
  const res = await fetch(BASE + "/api/companion?action=bootstrap", {
    headers: {
      Accept: "application/json",
      Authorization: "Bearer " + token,
      "x-mcj-companion-token": token,
    },
  });
  const data = await res.json().catch(() => ({}));
  return data.data || data;
}

async function installLocal(page) {
  if (!USE_LOCAL_JS) return;
  const map = {
    "**/companion-apply.html**": ["text/html; charset=utf-8", "companion-apply.html"],
    "**/src/companion-application.js**": ["text/javascript; charset=utf-8", "src/companion-application.js"],
    "**/src/companion-application.css**": ["text/css; charset=utf-8", "src/companion-application.css"],
    "**/src/mcj-companion-video-upload.js**": [
      "text/javascript; charset=utf-8",
      "src/mcj-companion-video-upload.js",
    ],
    "**/src/mcj-upload.js**": ["text/javascript; charset=utf-8", "src/mcj-upload.js"],
    "**/src/boss-header.js**": ["text/javascript; charset=utf-8", "src/boss-header.js"],
    "**/src/role-gates.js**": ["text/javascript; charset=utf-8", "src/role-gates.js"],
  };
  for (const [pattern, [type, rel]] of Object.entries(map)) {
    const body = fs.readFileSync(path.join(ROOT, rel), "utf8");
    await page.route(pattern, async (route) => {
      await route.fulfill({ status: 200, contentType: type, body });
    });
  }
}

async function apiQuotaTests(token) {
  // Fill album to 6
  for (let i = 0; i < 6; i++) {
    const up = await j(
      "/api/companion",
      {
        action: "upload_media",
        media_type: "gallery",
        data_url: tinyPngDataUrl(i),
        filename: `album-${i}.png`,
      },
      token
    );
    if (!up.data?.ok) {
      return { ok: false, detail: `album[${i}] fail status=${up.status} ${JSON.stringify(up.data).slice(0, 200)}` };
    }
  }
  let boot = await bootstrap(token);
  let g = galleryOf(boot);
  if (g.length !== 6) {
    return { ok: false, detail: `expected 6 gallery got ${g.length}` };
  }

  const seventh = await j(
    "/api/companion",
    {
      action: "upload_media",
      media_type: "gallery",
      data_url: tinyPngDataUrl(99),
      filename: "album-7.png",
    },
    token
  );
  const seventhBlocked =
    seventh.status === 400 && /相册最多上传 6/.test(String(seventh.data?.message || ""));

  const cover = await j(
    "/api/companion",
    {
      action: "upload_media",
      media_type: "cover",
      data_url: tinyPngDataUrl(42),
      filename: "game-cover.png",
    },
    token
  );
  boot = await bootstrap(token);
  g = galleryOf(boot);
  const covers = coverOf(boot);
  const coverOk = !!(cover.data?.ok && covers.length >= 1 && g.length === 6);

  // Replace cover — album count unchanged
  const cover2 = await j(
    "/api/companion",
    {
      action: "upload_media",
      media_type: "records",
      data_url: tinyPngDataUrl(43),
      filename: "game-cover-2.png",
    },
    token
  );
  boot = await bootstrap(token);
  const g2 = galleryOf(boot);
  const covers2 = coverOf(boot);
  const replaceOk = !!(cover2.data?.ok && covers2.length >= 1 && g2.length === 6);

  // Delete cover by type — album still 6
  const del = await j(
    "/api/companion",
    {
      action: "delete_media",
      media_type: "cover",
      media_id: covers2[0]?.id || cover2.data?.media?.id || "",
    },
    token
  );
  boot = await bootstrap(token);
  const g3 = galleryOf(boot);
  const covers3 = coverOf(boot);
  const deleteOk = g3.length === 6 && covers3.length === 0;

  // Video: reject legacy data_url path with readable message (no [object Object])
  const legacyVid = await j(
    "/api/companion",
    {
      action: "upload_media",
      media_type: "video",
      data_url: "data:video/mp4;base64,AAAA",
      filename: "bad.mp4",
      duration_seconds: 2,
    },
    token
  );
  const legacyMsg = String(legacyVid.data?.message || "");
  const legacyOk =
    legacyVid.status >= 400 &&
    !/\[object Object\]/i.test(legacyMsg) &&
    /直传|prepare_video|勿将完整视频/i.test(legacyMsg);

  // Video direct: prepare → (skip real bytes if no storage) metadata path probe
  const prep = await j(
    "/api/companion",
    {
      action: "prepare_video_upload",
      filename: "showcase.mp4",
      content_type: "video/mp4",
      byte_length: 128 * 1024,
      duration_seconds: 5,
    },
    token
  );
  const prepOk = !!(prep.data?.ok && prep.data?.signedUrl && prep.data?.path);
  const noObj = !/\[object Object\]/i.test(JSON.stringify(prep.data || {}));

  return {
    ok: seventhBlocked && coverOk && replaceOk && deleteOk && legacyOk && prepOk && noObj,
    detail: {
      seventhBlocked,
      seventhMsg: seventh.data?.message,
      coverOk,
      coverStatus: cover.status,
      coverMsg: cover.data?.message,
      galleryAfterCover: g.length,
      covers: covers.length,
      replaceOk,
      galleryAfterReplace: g2.length,
      deleteOk,
      galleryAfterDelete: g3.length,
      coversAfterDelete: covers3.length,
      delStatus: del.status,
      legacyOk,
      legacyStatus: legacyVid.status,
      legacyMsg,
      prepOk,
      prepPath: prep.data?.path || "",
      hasSignedUrl: !!prep.data?.signedUrl,
    },
  };
}

async function uiStaticChecks(browser, label, viewport, session) {
  const page = await browser.newPage({
    viewport,
    userAgent:
      label === "iphone"
        ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
        : undefined,
  });
  await installLocal(page);
  const access = session.accessToken || session.token || "";
  const refresh = session.refreshToken || session.refresh_token || "";
  const uid = session.user?.id || session.userId || session.uid || "";
  await page.addInitScript(
    ({ access, refresh, uid, user }) => {
      const sess = {
        accessToken: access,
        token: access,
        refreshToken: refresh,
        user: user || { id: uid, role: "companion" },
        role: "companion",
      };
      localStorage.setItem("mcjCompanionSession", JSON.stringify(sess));
      sessionStorage.setItem("mcjCompanionSession", JSON.stringify(sess));
      localStorage.setItem("mcjAuthAccessToken", access);
      if (refresh) localStorage.setItem("mcjAuthRefreshToken", refresh);
    },
    { access, refresh, uid, user: session.user || {} }
  );

  // Probe source: records → cover, video → prepare_video_upload, no [object Object] raw concat
  const src = await page.evaluate(async () => {
    const urls = [
      "/src/companion-application.js",
      ...Array.from(document.scripts)
        .map((s) => s.src)
        .filter((u) => /companion-apply|companion-application/i.test(u)),
    ];
    let text = "";
    for (const u of urls) {
      try {
        const r = await fetch(u, { cache: "no-store" });
        if (r.ok) text += "\n" + (await r.text());
      } catch (e) {}
    }
    return {
      len: text.length,
      recordsIsCover: /records:\s*\{\s*api:\s*[\"']upload_media[\"']\s*,\s*mediaType:\s*[\"']cover[\"']/.test(
        text
      ) || /records:\{api:`upload_media`,mediaType:`cover`/.test(text),
      hasPrepare: /prepare_video_upload/.test(text),
      hasVideoUploadHelper: /McjCompanionVideoUpload/.test(text),
      labelsCover: /游戏照封面图/.test(text),
      noLegacyRecordsGallery:
        !/records:\s*\{\s*api:\s*[\"']upload_media[\"']\s*,\s*mediaType:\s*[\"']gallery[\"']/.test(text) &&
        !/records:\{api:`upload_media`,mediaType:`gallery`/.test(text),
    };
  });
  await page.goto(`${BASE}/companion-apply.html?covervid=${Date.now()}&v=${label}`, {
    waitUntil: "domcontentloaded",
    timeout: 90000,
  });
  await page.waitForTimeout(1500);
  const tipProbe = await page.evaluate(() => {
    // Simulate error humanize path: ensure safeErrText exists and object errors stringify.
    const safe =
      window.McjCompanionVideoUpload && typeof window.McjCompanionVideoUpload.safeErrText === "function"
        ? window.McjCompanionVideoUpload.safeErrText({ message: "测试错误文案" }, "")
        : "";
    return {
      hasHelper: !!(window.McjCompanionVideoUpload && window.McjCompanionVideoUpload.upload),
      safe,
      objectString: String({ a: 1 }),
    };
  });
  await page.screenshot({ path: path.join(ART, `${label}-apply.png`), fullPage: true });
  await page.close();
  const ok =
    src.recordsIsCover &&
    src.hasPrepare &&
    src.hasVideoUploadHelper &&
    src.labelsCover &&
    src.noLegacyRecordsGallery &&
    tipProbe.hasHelper &&
    tipProbe.safe === "测试错误文案";
  return { ok, src, tipProbe };
}

(async () => {
  console.log("BASE", BASE, "USE_LOCAL_JS", USE_LOCAL_JS);
  const { access, session } = await registerFresh();
  step("register", !!access, "ok");

  const api = await apiQuotaTests(access);
  step("api_album6_block_cover_ok_video_prepare", api.ok, JSON.stringify(api.detail));

  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || "/usr/local/bin/google-chrome",
  });
  const desk = await uiStaticChecks(browser, "desktop", { width: 1280, height: 900 }, session);
  step("desktop_ui_cover_video_path", desk.ok, JSON.stringify(desk));
  const phone = await uiStaticChecks(
    browser,
    "iphone",
    { width: 390, height: 844, isMobile: true, hasTouch: true },
    session
  );
  step("iphone_ui_cover_video_path", phone.ok, JSON.stringify(phone));
  await browser.close();

  fs.writeFileSync(path.join(ART, "results.json"), JSON.stringify({ BASE, results }, null, 2));
  const failed = results.filter((r) => r.result === "FAIL");
  console.log(`\nSUMMARY ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
})().catch((err) => {
  console.error("FAIL", err);
  process.exit(1);
});
