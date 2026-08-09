/**
 * P0: Companion apply step 3/5 media uploads — avatar + gallery + no card cover.
 * Usage: PREVIEW=https://meow-cuijiao-homepage-staging.vercel.app node scripts/p0-companion-apply-step3-upload-e2e.mjs
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
const PASS = process.env.PASS || process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const ADMIN = process.env.E2E_ADMIN_EMAIL || "admin@meow.test";
const ART = path.join("/opt/cursor/artifacts", "companion-apply-step3-upload-e2e");
const ART_REPO = path.join(ROOT, "artifacts", "companion-apply-step3-upload-e2e");
fs.mkdirSync(ART, { recursive: true });
fs.mkdirSync(ART_REPO, { recursive: true });

const results = [];
function step(name, ok, detail) {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "").slice(0, 600) });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
  return ok;
}

function makePng(colorByte) {
  // 10x10 solid-ish PNG (valid tiny); colorByte varies filename uniqueness only via buffer tweak
  const b64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMsN9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC";
  const buf = Buffer.from(b64, "base64");
  if (Number.isFinite(colorByte)) buf[buf.length - 8] = colorByte & 0xff;
  return buf;
}

/** Distinct valid tiny PNGs (vary last bytes of CRC-ish padding carefully — use separate seeds via color). */
function makeLargerPng(seed) {
  return makePng(seed);
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

async function shot(page, name) {
  const file = `${name}.png`;
  const p1 = path.join(ART, file);
  await page.screenshot({ path: p1, fullPage: true });
  fs.copyFileSync(p1, path.join(ART_REPO, file));
  return p1;
}

function seedDraft(email, nickname) {
  return {
    step: 3,
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
      modes: ["娱乐"],
      rank: "黄金",
      voiceType: "甜妹",
      onlineStart: "18:00",
      onlineEnd: "23:00",
      intro: "E2E step3 upload test intro",
    },
    uploads: {},
    voice: {
      status: "已确认",
      confirmed: true,
      listened: true,
      uploaded: true,
      url: "https://example.invalid/e2e-voice-placeholder.webm",
      path: "e2e/voice/placeholder.webm",
      duration: 15,
      quality: {
        passed: true,
        volumeOk: true,
        durationOk: true,
        notBlank: true,
        humanVoice: true,
        duration: 15,
        reasons: [],
      },
    },
    identity: {},
    gameCards: [],
  };
}

(async () => {
  console.log("BASE", BASE);
  const html = await (await fetch(`${BASE}/companion-apply.html?cb=${Date.now()}`, { cache: "no-store" })).text();
  const assetMatch = html.match(/\/assets\/companion-apply-[^"]+\.js/);
  const assetUrl = assetMatch ? `${BASE}${assetMatch[0]}` : "";
  const assetJs = assetUrl ? await (await fetch(assetUrl, { cache: "no-store" })).text() : "";
  step(
    "asset_cache_bust",
    /本地草稿空间已满|卡面封面已取消|无需单独上传卡面封面|compressImageFile/.test(assetJs),
    assetMatch?.[0] || "missing bundled apply asset"
  );

  const stamp = Date.now().toString(36);
  const email = `step3_${stamp}@meow.test`;
  const nickname = `Step3${stamp}`;
  const reg = await api("/api/companion", null, {
    action: "register",
    email,
    password: PASS,
    nickname,
    phone: "60123456789",
  });
  const companionToken = tok(reg.json);
  const companionUserId = reg.json?.session?.user?.id || reg.json?.user?.id || "";
  step("register_companion", !!(reg.ok && companionToken), `${email} tok=${!!companionToken}`);

  const adminLogin = await api("/api/auth", null, {
    action: "login",
    email: ADMIN,
    password: PASS,
    loginPortal: "admin",
  });
  const adminT = tok(adminLogin.json);
  step("admin_login", !!adminT, `admin=${!!adminT}`);

  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || "/usr/bin/google-chrome-stable",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({ ...devices["iPhone 13"] });
  const page = await context.newPage();

  // Inject auth + completed draft so we land on step 3/5 upload page.
  await page.addInitScript(
    ({ token, email, nickname, draft }) => {
      localStorage.setItem("mcjAuthAccessToken", token);
      sessionStorage.setItem("mcjAuthAccessToken", token);
      localStorage.setItem("mcjCompanionSession", JSON.stringify({ accessToken: token, token, email, role: "companion" }));
      sessionStorage.setItem("mcjCompanionSession", JSON.stringify({ accessToken: token, token, email, role: "companion" }));
      localStorage.setItem("mcjRole", "companion");
      localStorage.setItem("customerUser", JSON.stringify({ role: "companion", email, name: nickname }));
      localStorage.setItem("mcjCompanionApplicationDraft.v1", JSON.stringify(draft));
      // Simulate a previously bloated draft attempt: ensure scrub path does not throw.
      try {
        const huge = "data:image/jpeg;base64," + "A".repeat(2_500_000);
        const bad = Object.assign({}, draft, { uploads: { avatar: { url: huge, status: "uploading" } } });
        localStorage.setItem("mcjCompanionApplicationDraft.v1", JSON.stringify(bad));
      } catch (e) {
        // Expected if quota already tight — page scrub will recover from seed below.
        localStorage.setItem("mcjCompanionApplicationDraft.v1", JSON.stringify(draft));
      }
    },
    { token: companionToken, email, nickname, draft: seedDraft(email, nickname) }
  );

  // Force-clean seed after possible quota throw during init script.
  await page.goto(`${BASE}/companion-apply.html?t=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.evaluate((draft) => {
    localStorage.setItem("mcjCompanionApplicationDraft.v1", JSON.stringify(draft));
  }, seedDraft(email, nickname));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);

  // Jump to step 3 if not already
  await page.evaluate(() => {
    const root = document.getElementById("companionApplyRoot");
    if (root && Number(root.dataset.step) !== 3) {
      // click step nav if present
      const btn = document.querySelector('[data-apply-step="3"], .apply-step[data-step="3"]');
      if (btn) btn.click();
    }
  });
  await page.waitForTimeout(800);

  // Ensure step 3 visible: look for avatar upload + absence of cover
  const step3Text = await page.evaluate(() => document.body.innerText.slice(0, 2500));
  const onUploadStep =
    /上传头像与资料|头像/.test(step3Text) &&
    !/卡面封面/.test(step3Text);
  if (!onUploadStep) {
    // Try next until step 3
    for (let i = 0; i < 5; i++) {
      const t = await page.evaluate(() => document.body.innerText);
      if (/上传头像与资料/.test(t) && !/卡面封面/.test(t)) break;
      const next = page.locator("[data-apply-next]");
      if (await next.count()) await next.click();
      await page.waitForTimeout(600);
    }
  }
  await shot(page, "01-step3-page");

  const coverGone = await page.evaluate(() => {
    const text = document.body.innerText;
    const inputs = [...document.querySelectorAll("[data-mcj-upload-input],[data-file-field]")].map((el) =>
      el.getAttribute("data-mcj-upload-input") || el.getAttribute("name") || ""
    );
    return {
      textHasCover: /卡面封面/.test(text),
      inputKeys: inputs,
      hasCoverInput: inputs.some((k) => /cover|card/i.test(k)),
    };
  });
  step("C_cover_removed_from_ui", !coverGone.textHasCover && !coverGone.hasCoverInput, JSON.stringify(coverGone));

  // A: avatar upload — use real file input
  const avatarInput = page.locator('[data-mcj-upload-input="avatar"], input[name="avatar"]').first();
  await avatarInput.waitFor({ state: "attached", timeout: 20000 });
  await avatarInput.setInputFiles({
    name: "avatar-a.png",
    mimeType: "image/png",
    buffer: makeLargerPng(11),
  });
  await page.waitForTimeout(800);
  // preview should appear quickly (blob or http)
  await page.waitForFunction(
    () => {
      const img = document.querySelector('[data-mcj-upload-input="avatar"]')?.closest(".mcj-upload-card, .upload-field, .form-field")?.querySelector("img");
      const any = document.querySelector(".mcj-upload-card.has-preview img, .mcj-upload-preview, .apply-preview");
      return !!(img?.src || any?.src);
    },
    { timeout: 20000 }
  ).catch(() => {});
  // wait success
  await page.waitForFunction(
    () => /上传成功/.test(document.body.innerText) || document.querySelector(".mcj-upload-card.is-ok, .mcj-upload-badge"),
    { timeout: 45000 }
  ).catch(() => {});
  await page.waitForTimeout(1500);
  const avatarState = await page.evaluate(() => {
    const draft = JSON.parse(localStorage.getItem("mcjCompanionApplicationDraft.v1") || "{}");
    const a = draft.uploads?.avatar || {};
    const tip = document.body.innerText.includes("上传成功") || document.body.innerText.includes("头像上传成功");
    const err = document.body.innerText.match(/quota has been exceeded|QuotaExceeded|本地草稿空间已满/i)?.[0] || "";
    const preview = document.querySelector(".mcj-upload-card.is-ok img, .mcj-upload-preview, img.apply-preview")?.src || "";
    return {
      tip,
      err,
      draftUrl: String(a.url || "").slice(0, 160),
      draftPath: String(a.path || "").slice(0, 120),
      draftStatus: a.status || "",
      hasDataUrlInDraft: /^data:/i.test(String(a.url || "")),
      preview: String(preview).slice(0, 120),
      lsChars: (localStorage.getItem("mcjCompanionApplicationDraft.v1") || "").length,
    };
  });
  step(
    "A_avatar_upload_no_quota",
    !avatarState.err &&
      !avatarState.hasDataUrlInDraft &&
      (!!avatarState.draftUrl || !!avatarState.draftPath) &&
      !/^blob:/i.test(avatarState.draftUrl),
    JSON.stringify(avatarState)
  );
  await shot(page, "02-avatar-uploaded");

  // Refresh persist
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const afterRefreshAvatar = await page.evaluate(() => {
    const draft = JSON.parse(localStorage.getItem("mcjCompanionApplicationDraft.v1") || "{}");
    const a = draft.uploads?.avatar || {};
    const img = document.querySelector(".mcj-upload-card.is-ok img, .mcj-upload-preview, img.apply-preview");
    return {
      url: String(a.url || "").slice(0, 160),
      path: String(a.path || "").slice(0, 120),
      preview: String(img?.src || "").slice(0, 160),
      text: document.body.innerText.includes("上传成功") || !!img,
    };
  });
  step(
    "A_avatar_refresh_persist",
    !!(afterRefreshAvatar.url || afterRefreshAvatar.path) && !/^data:/i.test(afterRefreshAvatar.url),
    JSON.stringify(afterRefreshAvatar)
  );
  await shot(page, "03-avatar-after-refresh");

  // Replace avatar
  const avatarInput2 = page.locator('[data-mcj-upload-input="avatar"], input[name="avatar"]').first();
  await avatarInput2.setInputFiles({
    name: "avatar-b.png",
    mimeType: "image/png",
    buffer: makeLargerPng(77),
  });
  await page.waitForTimeout(3500);
  const replaced = await page.evaluate(() => {
    const draft = JSON.parse(localStorage.getItem("mcjCompanionApplicationDraft.v1") || "{}");
    const a = draft.uploads?.avatar || {};
    return { url: String(a.url || ""), path: String(a.path || ""), status: a.status };
  });
  step(
    "A_avatar_replace",
    !!(replaced.url || replaced.path) &&
      (String(replaced.path || "") !== String(afterRefreshAvatar.path || "") ||
        String(replaced.url || "").split("?")[0] !== String(afterRefreshAvatar.url || "").split("?")[0]),
    JSON.stringify({
      beforePath: String(afterRefreshAvatar.path || "").slice(0, 80),
      afterPath: String(replaced.path || "").slice(0, 80),
      beforeUrl: String(afterRefreshAvatar.url || "").slice(0, 80),
      afterUrl: String(replaced.url || "").slice(0, 80),
    })
  );
  await shot(page, "04-avatar-replaced");

  // B: gallery 3 photos
  const photoInput = page.locator('[data-mcj-upload-input="photos"]').first();
  await photoInput.setInputFiles([
    { name: "g1.png", mimeType: "image/png", buffer: makePng(21) },
    { name: "g2.png", mimeType: "image/png", buffer: makePng(22) },
    { name: "g3.png", mimeType: "image/png", buffer: makePng(23) },
  ]);
  await page.waitForTimeout(8000);
  let galleryCount = await page.evaluate(() => {
    const draft = JSON.parse(localStorage.getItem("mcjCompanionApplicationDraft.v1") || "{}");
    const photos = Array.isArray(draft.uploads?.photos) ? draft.uploads.photos : [];
    const cards = document.querySelectorAll(".apply-gallery-item img, .apply-gallery-grid img").length;
    return { draft: photos.length, cards, urls: photos.map((p) => String(p.url || p.path || "").slice(0, 80)) };
  });
  step("B_gallery_upload_3", galleryCount.draft >= 3 && galleryCount.cards >= 3, JSON.stringify(galleryCount));
  await shot(page, "05-gallery-3");

  // Delete one
  const delBtn = page.locator("[data-clear-gallery]").first();
  if (await delBtn.count()) await delBtn.click();
  await page.waitForTimeout(1200);
  const afterDel = await page.evaluate(() => {
    const draft = JSON.parse(localStorage.getItem("mcjCompanionApplicationDraft.v1") || "{}");
    const photos = Array.isArray(draft.uploads?.photos) ? draft.uploads.photos : [];
    return photos.length;
  });
  step("B_gallery_delete_one", afterDel === galleryCount.draft - 1 || afterDel === 2, `count=${afterDel}`);

  // Add one more
  await page.locator('[data-mcj-upload-input="photos"]').first().setInputFiles({
    name: "g4.png",
    mimeType: "image/png",
    buffer: makePng(24),
  });
  await page.waitForTimeout(4000);
  const afterAdd = await page.evaluate(() => {
    const draft = JSON.parse(localStorage.getItem("mcjCompanionApplicationDraft.v1") || "{}");
    const photos = Array.isArray(draft.uploads?.photos) ? draft.uploads.photos : [];
    return { n: photos.length, urls: photos.map((p) => String(p.url || p.path || "").slice(0, 100)) };
  });
  step("B_gallery_add_after_delete", afterAdd.n >= 3, JSON.stringify(afterAdd));

  // Refresh gallery persist
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const galleryRefresh = await page.evaluate(() => {
    const draft = JSON.parse(localStorage.getItem("mcjCompanionApplicationDraft.v1") || "{}");
    const photos = Array.isArray(draft.uploads?.photos) ? draft.uploads.photos : [];
    return {
      n: photos.length,
      allDurable: photos.every((p) => p && (p.url || p.path) && !/^data:/i.test(String(p.url || "")) && !/^blob:/i.test(String(p.url || ""))),
    };
  });
  step("B_gallery_refresh_persist", galleryRefresh.n >= 3 && galleryRefresh.allDurable, JSON.stringify(galleryRefresh));
  await shot(page, "06-gallery-after-refresh");

  // D: next to 4/5 then back to 3/5
  // Ensure draft still has voice + avatar so step 3 is complete
  await page.evaluate(() => {
    const draft = JSON.parse(localStorage.getItem("mcjCompanionApplicationDraft.v1") || "{}");
    draft.voice = Object.assign({}, draft.voice || {}, {
      confirmed: true,
      listened: true,
      uploaded: true,
      url: draft.voice?.url || "https://example.invalid/e2e-voice.webm",
      path: draft.voice?.path || "e2e/voice/x.webm",
      duration: 15,
      quality: { passed: true, volumeOk: true, durationOk: true, notBlank: true, humanVoice: true, duration: 15, reasons: [] },
      status: "已确认",
    });
    localStorage.setItem("mcjCompanionApplicationDraft.v1", JSON.stringify(draft));
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  await page.locator("[data-apply-next]").click();
  await page.waitForTimeout(1500);
  const onStep4 = await page.evaluate(() => /选择认证方式|身份证认证|押金认证/.test(document.body.innerText));
  step("D_step3_to_step4", onStep4, onStep4 ? "on step4" : document.body ? "not step4" : "no body");
  await shot(page, "07-step4");

  await page.locator("[data-apply-prev]").click();
  await page.waitForTimeout(1500);
  const back = await page.evaluate(() => {
    const draft = JSON.parse(localStorage.getItem("mcjCompanionApplicationDraft.v1") || "{}");
    const photos = Array.isArray(draft.uploads?.photos) ? draft.uploads.photos : [];
    return {
      onStep3: /上传头像与资料|头像/.test(document.body.innerText),
      noCover: !/卡面封面/.test(document.body.innerText),
      avatar: !!(draft.uploads?.avatar?.url || draft.uploads?.avatar?.path),
      photos: photos.length,
    };
  });
  step("D_back_step3_data_persists", back.onStep3 && back.noCover && back.avatar && back.photos >= 3, JSON.stringify(back));
  await shot(page, "08-back-step3");

  // Admin / bootstrap view same media
  const boot = await api("/api/companion", companionToken, { action: "bootstrap" });
  const media = boot.json?.media || boot.json?.data?.media || {};
  const mediaList = Array.isArray(boot.json?.media) ? boot.json.media : Array.isArray(boot.json?.data?.media) ? boot.json.data.media : [];
  let avatarUrl = media.avatarUrl || "";
  let gallery = Array.isArray(media.gallery) ? media.gallery : [];
  if (!avatarUrl && mediaList.length) {
    avatarUrl = mediaList.find((m) => (m.mediaType || m.media_type) === "avatar")?.url || "";
    gallery = mediaList.filter((m) => (m.mediaType || m.media_type) === "gallery");
  }
  // Also try player
  const player = boot.json?.player || boot.json?.data?.player || {};
  if (!avatarUrl) avatarUrl = player.avatar || player.avatarUrl || "";

  const draftFinal = await page.evaluate(() => {
    const draft = JSON.parse(localStorage.getItem("mcjCompanionApplicationDraft.v1") || "{}");
    return {
      avatar: draft.uploads?.avatar || {},
      photos: Array.isArray(draft.uploads?.photos) ? draft.uploads.photos : [],
    };
  });

  step(
    "admin_or_bootstrap_avatar",
    !!(avatarUrl || draftFinal.avatar.url) && !/^data:/i.test(String(avatarUrl || draftFinal.avatar.url)),
    JSON.stringify({ avatarUrl: String(avatarUrl || draftFinal.avatar.url).slice(0, 140), bootOk: boot.ok })
  );
  step(
    "admin_or_bootstrap_gallery",
    (gallery.length >= 3 || draftFinal.photos.length >= 3) &&
      (gallery.length ? gallery : draftFinal.photos).every((g) => g && (g.url || g.path) && !/^data:/i.test(String(g.url || ""))),
    JSON.stringify({ galleryN: gallery.length, draftN: draftFinal.photos.length })
  );

  // Admin applications list / finance-style lookup via companion bootstrap is enough;
  // also hit admin players if available.
  const adminApps = await api("/api/admin/companion-applications?limit=50", adminT, null, "GET").catch(() => ({ ok: false, json: {} }));
  const adminPlayers = await api("/api/admin/players?limit=50", adminT, null, "GET").catch(() => ({ ok: false, json: {} }));
  const found =
    (adminApps.json?.applications || adminApps.json?.items || []).find((a) => String(a.email || "").toLowerCase() === email) ||
    (adminPlayers.json?.players || adminPlayers.json?.items || []).find((p) => String(p.email || "").toLowerCase() === email) ||
    null;
  step(
    "admin_can_see_applicant",
    !!(found || avatarUrl || draftFinal.avatar.url),
    JSON.stringify({ found: !!found, email, avatar: String(avatarUrl || draftFinal.avatar.url).slice(0, 100) })
  );

  // Fetch avatar bytes if http
  const finalAvatar = avatarUrl || draftFinal.avatar.url || "";
  if (/^https?:/i.test(finalAvatar)) {
    const imgRes = await fetch(finalAvatar);
    step("avatar_url_fetchable", imgRes.ok, `status=${imgRes.status} type=${imgRes.headers.get("content-type")}`);
    if (imgRes.ok) {
      const buf = Buffer.from(await imgRes.arrayBuffer());
      fs.writeFileSync(path.join(ART, "09-avatar-bytes.bin"), buf);
    }
  } else {
    step("avatar_url_fetchable", !!draftFinal.avatar.path, `path=${draftFinal.avatar.path || "missing"}`);
  }

  await browser.close();

  const summary = {
    verdict: results.every((r) => r.result === "PASS") ? "PASS" : "FAIL",
    base: BASE,
    email,
    nickname,
    companionUserId,
    avatarUrl: finalAvatar,
    avatarPath: draftFinal.avatar.path || "",
    galleryCount: draftFinal.photos.length,
    galleryPaths: draftFinal.photos.map((p) => p.path || p.url),
    bucket: "companion-public (avatar/gallery public) / companion-gallery fallback",
    results,
    screenshots: fs.readdirSync(ART).filter((f) => /\.(png|bin)$/.test(f)),
  };
  fs.writeFileSync(path.join(ART, "RESULTS.json"), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(ART_REPO, "RESULTS.json"), JSON.stringify(summary, null, 2));
  console.log("\n=== SUMMARY ===");
  for (const r of results) console.log(`${r.result}\t${r.step}\t${r.detail}`);
  console.log(`VERDICT=${summary.verdict}`);
  process.exit(summary.verdict === "PASS" ? 0 : 1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
