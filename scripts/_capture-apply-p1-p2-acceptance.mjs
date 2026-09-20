/**
 * P1+P2 companion-apply acceptance — real photo fixtures, no placehold dimension text.
 * Serves repo root + public/ so /icons/* resolves like production.
 */
import { chromium } from "playwright";
import http from "http";
import fs from "fs";
import path from "path";

const ROOT = "/workspace";
const PUBLIC = path.join(ROOT, "public");
const OUT = "/opt/cursor/artifacts/apply-p1-p2-accept";
const FIX = path.join(ROOT, "scripts/fixtures/apply-media");
for (const d of ["", "mobile", "desktop", "pwa"].map((x) => path.join(OUT, x))) {
  fs.mkdirSync(d, { recursive: true });
}

const UID = "11111111-1111-4111-8111-111111111111";
const PORT = 8793;
const DRAFT_KEY = "mcjCompanionApplicationDraft.v1.u:" + UID;

function fakeJwt(sub) {
  const h = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const p = Buffer.from(
    JSON.stringify({
      sub,
      exp: Math.floor(Date.now() / 1000) + 86400,
      role: "authenticated",
      email: "demo@example.com",
    })
  ).toString("base64url");
  return `${h}.${p}.x`;
}

function mime(f) {
  if (f.endsWith(".html")) return "text/html; charset=utf-8";
  if (f.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (f.endsWith(".css")) return "text/css; charset=utf-8";
  if (f.endsWith(".json") || f.endsWith(".webmanifest")) return "application/json";
  if (f.endsWith(".png")) return "image/png";
  if (f.endsWith(".jpg") || f.endsWith(".jpeg")) return "image/jpeg";
  if (f.endsWith(".webp")) return "image/webp";
  if (f.endsWith(".svg")) return "image/svg+xml";
  if (f.endsWith(".wav")) return "audio/wav";
  return "application/octet-stream";
}

function resolveFile(rel) {
  const clean = decodeURIComponent(rel).replace(/^\/+/, "");
  const candidates = [path.join(ROOT, clean), path.join(PUBLIC, clean)];
  for (const file of candidates) {
    if (!file.startsWith(ROOT)) continue;
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return file;
  }
  return null;
}

function createStaticServer(port) {
  const server = http.createServer((req, res) => {
    try {
      const u = new URL(req.url || "/", "http://127.0.0.1");
      let rel = u.pathname;
      if (rel.endsWith("/")) rel += "index.html";
      if (rel === "/portal-early-gate.js") {
        res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" });
        res.end("/* stub */\n");
        return;
      }
      const file = resolveFile(rel);
      if (!file) {
        res.writeHead(404);
        res.end("not found " + rel);
        return;
      }
      res.writeHead(200, { "Content-Type": mime(file), "Cache-Control": "no-store" });
      fs.createReadStream(file).pipe(res);
    } catch (e) {
      res.writeHead(500);
      res.end(String(e));
    }
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

function fixture(name) {
  return {
    url: `/scripts/fixtures/apply-media/${name}`,
    path: `apply/${name}`,
    status: "ok",
  };
}

function makeDraft(step, patch = {}) {
  const avatar = fixture("avatar.jpg");
  const p1 = Object.assign({ id: "p1" }, fixture("photo-1.jpg"));
  const p2 = Object.assign({ id: "p2" }, fixture("photo-2.jpg"));
  const voice = fixture("voice.wav");
  const base = {
    step,
    _applyStepsV4: true,
    _applyStepsV3: true,
    _p2StepMigrated: true,
    ownerUserId: UID,
    certification_method: "id_card",
    data: {
      nickname: "小喵测试",
      age: "22",
      gender: "女",
      region: "Kuala Lumpur",
      phone: "0123456789",
      email: "demo@example.com",
      contactPublic: "不公开，仅平台可见",
      personalTags: ["温柔", "娱乐"],
      gameNickname: "MeowAce",
      mainGames: ["Valorant"],
      positions: ["输出"],
      modes: ["娱乐"],
      rank: "黄金",
      voiceType: "甜妹",
      onlineStart: "20:00",
      onlineEnd: "02:00",
      intro: "热爱游戏，声音温柔。",
    },
    identity: {
      authMode: "id_card",
      certification_method: "id_card",
      documentType: "马来西亚身份证",
      settlementMethod: "银行卡",
      settlementBank: "Maybank",
      settlementName: "Demo User",
      settlementAccount: "1234567890",
      idFront: avatar,
      idBack: avatar,
    },
    uploads: {
      avatar,
      photos: [p1, p2],
    },
    voice: {
      confirmed: true,
      uploaded: true,
      hasLocal: false,
      url: voice.url,
      path: voice.path,
      fileUpload: voice,
      duration: 18,
      listened: true,
      status: "已保存",
      quality: {
        durationOk: true,
        volumeOk: true,
        notBlank: true,
        humanVoice: true,
        reasons: [],
      },
    },
    rulesAgreement: {
      accepted: true,
      version: "v2026.09",
      ruleId: "pc-player-rules-default",
      agreedAt: new Date().toISOString(),
    },
    ui: { rulesOpenId: "" },
  };
  const out = Object.assign({}, base, patch);
  out.data = Object.assign({}, base.data, patch.data || {});
  out.identity = Object.assign({}, base.identity, patch.identity || {});
  out.uploads = Object.assign({}, base.uploads, patch.uploads || {});
  out.voice = Object.assign({}, base.voice, patch.voice || {});
  out.rulesAgreement = Object.assign({}, base.rulesAgreement, patch.rulesAgreement || {});
  out.ui = Object.assign({}, base.ui, patch.ui || {});
  out.step = step;
  return out;
}

function installInit() {
  return ({ token, uid, draftKey, draft }) => {
    const session = {
      token,
      accessToken: token,
      user: { id: uid, email: "demo@example.com", nickname: "小喵测试" },
      remember: true,
    };
    localStorage.setItem("mcjCompanionSession", JSON.stringify(session));
    sessionStorage.setItem("mcjCompanionSession", JSON.stringify(session));
    localStorage.setItem("companionAuthToken", token);
    localStorage.setItem("mcjAuthAccessToken", token);
    sessionStorage.setItem("mcjAuthAccessToken", token);
    localStorage.setItem(draftKey, JSON.stringify(draft));
    localStorage.setItem("mcjCompanionApplicationDraft.lastAuthUserId", uid);

    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

    window.fetch = async (input) => {
      const url = String(typeof input === "string" ? input : (input && input.url) || "");
      if (url.includes("/api/platform/content") || url.includes("player_rules")) {
        return json({
          ok: true,
          byType: {
            player_rules: [
              {
                id: "pc-player-rules-default",
                slug: "apply-step1",
                status: "published",
                enabled: true,
                published: {
                  id: "pc-player-rules-default",
                  version: "v2026.09",
                  title: "妙脆角陪玩制度",
                  body: "一、基本规范\n1. 按时上线接单。",
                },
                draft: {},
              },
            ],
            voice_types: [
              {
                id: "vt1",
                title: "甜妹",
                name: "甜妹",
                status: "published",
                enabled: true,
                published: { name: "甜妹" },
              },
            ],
            player_deposit_settings: [
              { id: "dep1", status: "published", enabled: true, published: { amount: 100, currency: "MYR" } },
            ],
          },
        });
      }
      return json({
        ok: true,
        services: [{ id: "g-val", name: "Valorant", title: "Valorant", enabled: true }],
        session: { accessToken: token, token, user: session.user },
        data: { player: { applicationStatus: "draft", auditStatus: "draft" } },
      });
    };
  };
}

async function openApply(browser, draft, viewport, opts = {}) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    isMobile: viewport.width < 800,
    hasTouch: viewport.width < 800,
  });
  const token = fakeJwt(UID);
  await context.addInitScript(installInit(), {
    token,
    uid: UID,
    draftKey: DRAFT_KEY,
    draft,
  });
  if (opts.clearPwaDismiss) {
    await context.addInitScript(() => {
      try {
        localStorage.removeItem("mcj_pwa_prompt_dismissed_at");
        localStorage.removeItem("mcj_pwa_installed");
        sessionStorage.removeItem("mcj_pwa_prompt_session_shown");
      } catch (e) {}
    });
  }
  if (opts.standalone) {
    await context.addInitScript(() => {
      Object.defineProperty(window.navigator, "standalone", {
        configurable: true,
        get: () => true,
      });
      const orig = window.matchMedia.bind(window);
      window.matchMedia = (q) => {
        if (String(q).includes("display-mode: standalone")) {
          return {
            matches: true,
            media: q,
            addListener() {},
            removeListener() {},
            addEventListener() {},
            removeEventListener() {},
            onchange: null,
            dispatchEvent() {
              return false;
            },
          };
        }
        return orig(q);
      };
    });
  }
  const page = await context.newPage();
  page.on("pageerror", (err) => console.log("PAGEERR", err.message));
  await page.goto(`http://127.0.0.1:${PORT}/companion-apply.html`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForSelector("#companionApplyRoot", { timeout: 30000 });
  await page.waitForFunction(
    () => !!(window.MCJCompanionApplyDraft && window.MCJCompanionApplyDraft.gotoStep),
    { timeout: 20000 }
  );
  await page.evaluate(
    ({ step, draftJson, draftKey }) => {
      const d = Object.assign({}, JSON.parse(draftJson), { step });
      localStorage.setItem(draftKey, JSON.stringify(d));
      window.MCJCompanionApplyDraft.gotoStep(step, { alignStepNav: true });
    },
    { step: draft.step, draftJson: JSON.stringify(draft), draftKey: DRAFT_KEY }
  );
  await page.waitForTimeout(900);
  return { context, page };
}

async function shot(page, file, fullPage = true) {
  await page.waitForTimeout(250);
  await page.screenshot({ path: file, fullPage });
  console.log("saved", file);
}

async function main() {
  if (!fs.existsSync(path.join(FIX, "avatar.jpg"))) {
    throw new Error("missing fixtures in " + FIX);
  }
  const server = await createStaticServer(PORT);
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROME || "/usr/local/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  try {
    // empty media
    {
      const draft = makeDraft(2, {
        uploads: { avatar: null, photos: [] },
        voice: {
          uploaded: false,
          confirmed: false,
          hasLocal: false,
          url: "",
          duration: 0,
          listened: false,
          status: "尚未录制",
          quality: {},
        },
      });
      const { context, page } = await openApply(browser, draft, { width: 390, height: 844 });
      await shot(page, path.join(OUT, "mobile/01-step3-top.png"), false);
      await page.evaluate(() => {
        const el = document.querySelector('[data-apply-section="photos"], .apply-media-fields, .apply-section');
        if (el) el.scrollIntoView({ block: "start" });
      });
      await shot(page, path.join(OUT, "mobile/02-photos-before.png"), false);
      await page.evaluate(() => {
        const el = document.querySelector('#applyVoicePanel, [data-apply-section="voice"]');
        if (el) el.scrollIntoView({ block: "start" });
      });
      await shot(page, path.join(OUT, "mobile/04-voice-before.png"), false);
      await context.close();
    }

    // filled
    {
      const draft = makeDraft(2);
      const { context, page } = await openApply(browser, draft, { width: 390, height: 844 });
      await page.evaluate(() => {
        const el = document.querySelector('[data-apply-section="photos"], .apply-media-fields');
        if (el) el.scrollIntoView({ block: "start" });
      });
      await shot(page, path.join(OUT, "mobile/03-photos-after.png"), false);
      await page.evaluate(() => {
        const el = document.querySelector('#applyVoicePanel, [data-apply-section="voice"]');
        if (el) el.scrollIntoView({ block: "start" });
      });
      await shot(page, path.join(OUT, "mobile/05-voice-done.png"), false);
      await page.evaluate(() => {
        const el = document.querySelector('[data-apply-section="video"]');
        if (el) el.scrollIntoView({ block: "center" });
      });
      await shot(page, path.join(OUT, "mobile/06-video.png"), false);
      await shot(page, path.join(OUT, "mobile/07-step3-full.png"), true);
      await context.close();
    }

    // desktop
    {
      const draft = makeDraft(2);
      const { context, page } = await openApply(browser, draft, { width: 1280, height: 900 });
      await shot(page, path.join(OUT, "desktop/08-step3-full.png"), true);
      await context.close();
    }

    // pwa normal web — must NOT auto-open
    {
      const draft = makeDraft(2, {
        uploads: { avatar: null, photos: [] },
        voice: {
          uploaded: false,
          confirmed: false,
          hasLocal: false,
          url: "",
          duration: 0,
          listened: false,
          status: "尚未录制",
          quality: {},
        },
      });
      const { context, page } = await openApply(
        browser,
        draft,
        { width: 390, height: 844 },
        { clearPwaDismiss: true }
      );
      await page.waitForTimeout(4500);
      const autoOpen = await page.evaluate(
        () => !!document.querySelector(".mcj-pwa-root.is-open, [data-mcj-pwa-root].is-open")
      );
      await shot(page, path.join(OUT, "pwa/09-normal-web-no-autosheet.png"), false);
      fs.writeFileSync(path.join(OUT, "pwa/09-autosheet.json"), JSON.stringify({ autoOpen }, null, 2));

      await page.evaluate(() => {
        if (window.MCJPwaInstall && typeof window.MCJPwaInstall.openGuide === "function") {
          window.MCJPwaInstall.openGuide();
        }
      });
      await page.waitForTimeout(600);
      const iconInfo = await page.evaluate(() => {
        const img = document.querySelector(".mcj-pwa-logo");
        return {
          src: img ? img.getAttribute("src") : null,
          naturalWidth: img ? img.naturalWidth : 0,
          naturalHeight: img ? img.naturalHeight : 0,
          open: !!document.querySelector(".mcj-pwa-root.is-open"),
        };
      });
      await shot(page, path.join(OUT, "pwa/10-manual-guide-icon.png"), false);
      fs.writeFileSync(path.join(OUT, "pwa/10-icon.json"), JSON.stringify(iconInfo, null, 2));
      await context.close();
    }

    // standalone — never show
    {
      const draft = makeDraft(2);
      const { context, page } = await openApply(
        browser,
        draft,
        { width: 390, height: 844 },
        { clearPwaDismiss: true, standalone: true }
      );
      await page.waitForTimeout(3500);
      await page.evaluate(() => {
        if (window.MCJPwaInstall && window.MCJPwaInstall.openGuide) window.MCJPwaInstall.openGuide();
      });
      await page.waitForTimeout(400);
      const open = await page.evaluate(
        () => !!document.querySelector(".mcj-pwa-root.is-open, [data-mcj-pwa-root].is-open")
      );
      await shot(page, path.join(OUT, "pwa/11-standalone-no-prompt.png"), false);
      fs.writeFileSync(path.join(OUT, "pwa/11-standalone.json"), JSON.stringify({ open }, null, 2));
      await context.close();
    }

    console.log("DONE", OUT);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
