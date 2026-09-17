/**
 * PR #236 — capture compact top chrome + full 4-step labels at 375/390/430.
 */
import { chromium } from "playwright";
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = "/opt/cursor/artifacts/pr236-stepper-ui";
const SHOTS = "/opt/cursor/artifacts/screenshots";
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });

const UID = "11111111-1111-4111-8111-111111111111";
const PORT = 8791;

const RULE = {
  id: "pc-player-rules-default",
  slug: "apply-step1",
  title: "妙脆角陪玩制度",
  subtitle: "申请前请仔细阅读",
  version: "v2026.09",
  updatedAt: "2026-09-12T00:00:00Z",
  status: "published",
  enabled: true,
  body: `一、基本规范\n1. 按时上线接单。\n2. 不得无故爽约。\n\n二、接单规范\n1. 接单后 5 分钟内回复老板。\n2. 按约定时间进入游戏。`,
};

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

function mime(p) {
  if (p.endsWith(".html")) return "text/html; charset=utf-8";
  if (p.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (p.endsWith(".css")) return "text/css; charset=utf-8";
  if (p.endsWith(".json")) return "application/json";
  if (p.endsWith(".svg")) return "image/svg+xml";
  if (p.endsWith(".png")) return "image/png";
  if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
  if (p.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}

function createStaticServer(root, port) {
  const server = http.createServer((req, res) => {
    try {
      const u = new URL(req.url || "/", `http://127.0.0.1:${port}`);
      let rel = decodeURIComponent(u.pathname);
      if (rel.endsWith("/")) rel += "index.html";
      const file = path.join(root, rel.replace(/^\//, ""));
      if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404);
        res.end("not found");
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

function filledDraft(step, patch = {}) {
  const base = {
    step,
    ownerUserId: UID,
    certification_method: "id_card",
    identity: {
      authMode: "id_card",
      certification_method: "id_card",
      documentType: "马来西亚身份证",
      settlementMethod: "银行卡",
      settlementBank: "Maybank",
      settlementName: "Demo User",
      settlementAccount: "1234567890",
      idFront: { url: "https://placehold.co/320x200/png?text=ID-Front", path: "id/front.jpg", status: "ok" },
      idBack: { url: "https://placehold.co/320x200/png?text=ID-Back", path: "id/back.jpg", status: "ok" },
    },
    rulesAgreement: {
      accepted: true,
      version: RULE.version,
      ruleId: RULE.id,
      agreedAt: new Date().toISOString(),
    },
    data: {
      nickname: "小喵测试",
      age: "22",
      gender: "女",
      region: "Kuala Lumpur",
      phone: "0123456789",
      email: "demo@example.com",
      personalTags: ["随和", "娱乐"],
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
    uploads: {
      avatar: { url: "https://placehold.co/120x120/png?text=Avatar", path: "avatar.jpg", status: "ok" },
    },
    voice: {
      confirmed: true,
      url: "https://example.com/voice.mp3",
      path: "voice.mp3",
      storagePath: "voice.mp3",
      duration: 18,
    },
  };
  const out = Object.assign({}, base, patch);
  out.identity = Object.assign({}, base.identity, patch.identity || {});
  out.rulesAgreement = Object.assign({}, base.rulesAgreement, patch.rulesAgreement || {});
  out.data = Object.assign({}, base.data, patch.data || {});
  out.uploads = Object.assign({}, base.uploads, patch.uploads || {});
  out.voice = Object.assign({}, base.voice, patch.voice || {});
  out.step = step;
  return out;
}

function installInit({ token, uid, draft, rule, appStatus }) {
  const session = {
    token,
    accessToken: token,
    refreshToken: "refresh-demo",
    expiresAt: Math.floor(Date.now() / 1000) + 86400,
    user: { id: uid, email: "demo@example.com", nickname: "小喵测试" },
    remember: true,
  };
  localStorage.setItem("mcjCompanionSession", JSON.stringify(session));
  sessionStorage.setItem("mcjCompanionSession", JSON.stringify(session));
  localStorage.setItem("mcjCompanionApplicationDraft.v1.u:" + uid, JSON.stringify(draft));
  localStorage.setItem("mcjCompanionApplicationDraft.lastAuthUserId", uid);
  localStorage.setItem("mcj_pwa_prompt_dismissed_at", String(Date.now()));
  localStorage.setItem("mcj_pwa_installed", "1");

  const json = (data, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

  window.fetch = async (input, init) => {
    const url = String(typeof input === "string" ? input : (input && input.url) || "");
    if (url.includes("/api/platform/content") || url.includes("player_rules")) {
      return json({
        ok: true,
        byType: {
          player_rules: [
            {
              id: rule.id,
              slug: rule.slug,
              status: "published",
              enabled: true,
              published: rule,
              draft: rule,
            },
          ],
          voice_types: [
            { id: "vt1", title: "甜妹", name: "甜妹", status: "published", enabled: true, published: { name: "甜妹" } },
          ],
          player_deposit_settings: [
            {
              id: "dep1",
              status: "published",
              enabled: true,
              published: { amount: 100, currency: "MYR", paymentDescription: "申请押金 100 MYR" },
            },
          ],
        },
      });
    }
    if (url.includes("/api/companion") || url.includes("action=bootstrap")) {
      return json({
        ok: true,
        data: {
          player: {
            applicationStatus: appStatus || "draft",
            auditStatus: appStatus || "draft",
          },
        },
      });
    }
    if (url.includes("/api/auth") || url.includes("/api/platform") || url.includes("deposit")) {
      return json({ ok: true, session: session, amountRm: 100, depositChannels: [] });
    }
    return json({ ok: true });
  };
}

async function shot(page, name, meta) {
  await page.evaluate(() => {
    document.querySelectorAll("[data-mcj-pwa-root], .mcj-pwa-root, .pwa-install-banner").forEach((el) => el.remove());
  });
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, fullPage: false });
  fs.copyFileSync(file, path.join(SHOTS, name));
  const info = await page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll(".apply-stepper-label")).map((el) => el.textContent.trim());
    const ox = Math.max(
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
      document.body.scrollWidth - document.body.clientWidth
    );
    const hasChip = !!document.querySelector(".apply-step-chip, .apply-step-chip-row");
    const back = (document.querySelector(".apply-back-link") || {}).textContent || "";
    const hero = (document.querySelector(".apply-hero h1") || {}).textContent || "";
    const sub = (document.querySelector(".apply-hero p") || {}).textContent || "";
    return { labels, ox, hasChip, back: back.trim(), hero: hero.trim(), sub: sub.trim() };
  });
  console.log(JSON.stringify({ name, ...meta, ...info }));
  return info;
}

async function openAt(browser, width, step, draftPatch = {}, appStatus = "draft") {
  const context = await browser.newContext({
    viewport: { width, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const draft = filledDraft(step, draftPatch);
  const token = fakeJwt(UID);
  await context.addInitScript(installInit, {
    token,
    uid: UID,
    draft,
    rule: RULE,
    appStatus,
  });
  const page = await context.newPage();
  page.on("pageerror", (err) => console.log("PAGEERR", err.message));
  await page.goto(`http://127.0.0.1:${PORT}/companion-apply.html`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForFunction(() => {
    return !!(window.MCJCompanionApplyDraft && document.querySelector("#companionApplyRoot .apply-layout, #companionApplyRoot .apply-stepper, #companionApplyRoot [data-apply-auth-gate]"));
  }, { timeout: 20000 });
  await page.waitForTimeout(700);
  await page.evaluate((target) => {
    if (window.MCJCompanionApplyDraft && window.MCJCompanionApplyDraft.gotoStep) {
      window.MCJCompanionApplyDraft.gotoStep(target);
    }
  }, step);
  await page.waitForTimeout(500);
  await page.waitForSelector(".apply-stepper-label", { timeout: 10000 });
  return { context, page };
}

async function main() {
  const server = await createStaticServer(ROOT, PORT);
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM || "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  const cases = [
    {
      name: "01-375-step1-top.png",
      width: 375,
      step: 0,
      patch: {
        certification_method: "",
        identity: { authMode: "", certification_method: "" },
        rulesAgreement: {},
      },
      status: "draft",
    },
    {
      name: "02-390-step2-top.png",
      width: 390,
      step: 1,
      patch: { rulesAgreement: { accepted: false, version: RULE.version, ruleId: RULE.id } },
      status: "draft",
    },
    {
      name: "03-430-step3-top.png",
      width: 430,
      step: 2,
      patch: {},
      status: "draft",
    },
    {
      name: "04-390-step4-done.png",
      width: 390,
      step: 3,
      patch: { submitted: true, status: "pending", step: 3 },
      status: "pending",
    },
  ];

  const results = [];
  for (const c of cases) {
    const { context, page } = await openAt(browser, c.width, c.step, c.patch, c.status);
    const info = await shot(page, c.name, { width: c.width, step: c.step });
    results.push({ ...c, info });
    await context.close();
  }

  const summary = {
    ok: results.every((r) => {
      const labels = r.info.labels || [];
      return (
        labels.join(",") === "认证,须知,资料,完成" &&
        r.info.ox === 0 &&
        !r.info.hasChip &&
        !/认\.|须\.|资\.|完\./.test(labels.join(""))
      );
    }),
    results,
  };
  fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 2));
  console.log("SUMMARY", JSON.stringify(summary, null, 2));

  await browser.close();
  server.close();
  if (!summary.ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
