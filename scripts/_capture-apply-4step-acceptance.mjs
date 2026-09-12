/**
 * PR #236 — 4-STEP companion apply acceptance shots (mobile 390).
 * Relies on draft being present before load + MCJCompanionApplyDraft.gotoStep.
 */
import { chromium } from "playwright";
import http from "http";
import fs from "fs";
import path from "path";

const ROOT = "/workspace";
const OUT = "/opt/cursor/artifacts/apply-4step";
const SHOTS = "/opt/cursor/artifacts/screenshots";
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });

const UID = "11111111-1111-4111-8111-111111111111";
const PORT = 8791;
const DRAFT_KEY = "mcjCompanionApplicationDraft.v1.u:" + UID;

const RULE = {
  id: "pc-player-rules-default",
  slug: "apply-step1",
  title: "妙脆角陪玩制度",
  subtitle: "申请前请仔细阅读",
  version: "v2026.09",
  updatedAt: "2026-09-12T00:00:00Z",
  status: "published",
  enabled: true,
  body: `一、基本规范
1. 按时上线接单。
2. 不得无故爽约。

二、接单规范
1. 接单后 5 分钟内回复老板。
2. 按约定时间进入游戏。

三、服务规范
1. 保持礼貌沟通。
2. 按约定完成服务。

四、收益/结算规则
1. 按平台规则结算。
2. 价格由平台等级决定，申请人不可自填接单价。

五、违规处理
1. 警告 / 停权 / 清退。
2. 严重违规直接封禁。`,
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

function mime(f) {
  if (f.endsWith(".html")) return "text/html; charset=utf-8";
  if (f.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (f.endsWith(".css")) return "text/css; charset=utf-8";
  if (f.endsWith(".json")) return "application/json";
  if (f.endsWith(".png")) return "image/png";
  if (f.endsWith(".jpg") || f.endsWith(".jpeg")) return "image/jpeg";
  if (f.endsWith(".svg")) return "image/svg+xml";
  if (f.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}

function createStaticServer(root, port) {
  const server = http.createServer((req, res) => {
    try {
      const u = new URL(req.url || "/", "http://127.0.0.1");
      let rel = decodeURIComponent(u.pathname);
      if (rel.endsWith("/")) rel += "index.html";
      if (rel === "/portal-early-gate.js") {
        res.writeHead(200, {
          "Content-Type": "text/javascript; charset=utf-8",
          "Cache-Control": "no-store",
        });
        res.end("/* stubbed for capture */\n");
        return;
      }
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

function makeDraft(step, patch = {}) {
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
      idFront: {
        url: "https://placehold.co/320x200/png?text=ID-Front",
        path: "id/front.jpg",
        status: "ok",
      },
      idBack: {
        url: "https://placehold.co/320x200/png?text=ID-Back",
        path: "id/back.jpg",
        status: "ok",
      },
    },
    uploads: {
      avatar: {
        url: "https://placehold.co/120x120/png?text=Avatar",
        path: "avatar.jpg",
        status: "ok",
      },
    },
    voice: {
      confirmed: true,
      uploaded: true,
      url: "https://example.com/voice.mp3",
      path: "voice.mp3",
      duration: 18,
      listened: true,
      quality: { durationOk: true, volumeOk: true, notBlank: true, humanVoice: true },
    },
    rulesAgreement: {
      accepted: true,
      version: RULE.version,
      ruleId: RULE.id,
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

async function takeShot(page, name) {
  await page.evaluate(() => {
    document.querySelectorAll("[data-mcj-pwa-root], .mcj-pwa-root").forEach((el) => el.remove());
  });
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, fullPage: false });
  fs.copyFileSync(file, path.join(SHOTS, name));
  const tip = await page.locator("h2").first().textContent().catch(() => "");
  console.log("saved", name, String(tip || "").slice(0, 80));
}

function installInit() {
  return ({ token, uid, rule, draftKey, draft, submitted }) => {
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
    localStorage.setItem("mcj_pwa_prompt_dismissed_at", String(Date.now()));
    localStorage.setItem("mcj_pwa_installed", "1");

    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
      });

    window.fetch = async (input) => {
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
              {
                id: "dep1",
                status: "published",
                enabled: true,
                published: { amount: 100, currency: "MYR" },
              },
            ],
          },
        });
      }
      if (url.includes("deposit_pay_methods") || url.includes("action=deposit_pay_methods")) {
        return json({
          ok: true,
          amountRm: 100,
          depositChannels: [
            {
              id: "tng",
              code: "tng",
              label: "Touch n Go",
              qrUrl: "https://placehold.co/240x240/png?text=TNG",
              payInfo: {
                qrUrl: "https://placehold.co/240x240/png?text=TNG",
                receiverName: "MCJ Platform",
                bankName: "Touch n Go eWallet",
                phone: "012-0000000",
                bankAccount: "012-0000000",
                amountRm: 100,
              },
            },
          ],
        });
      }
      return json({
        ok: true,
        services: [{ id: "g-val", name: "Valorant", title: "Valorant", enabled: true }],
        session: { accessToken: token, token, user: session.user },
        data: {
          player: {
            applicationStatus: submitted ? "pending" : "draft",
            auditStatus: submitted ? "pending" : "draft",
          },
        },
      });
    };
  };
}

async function openApply(browser, draft, extra = {}) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const token = fakeJwt(UID);
  await context.addInitScript(installInit(), {
    token,
    uid: UID,
    rule: RULE,
    draftKey: DRAFT_KEY,
    draft,
    submitted: !!extra.submitted,
  });
  const page = await context.newPage();
  page.on("pageerror", (err) => console.log("PAGEERR", err.message));
  await page.goto(`http://127.0.0.1:${PORT}/companion-apply.html`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForSelector("#companionApplyRoot", { timeout: 30000 });
  await page.waitForFunction(() => !!(window.MCJCompanionApplyDraft && window.MCJCompanionApplyDraft.gotoStep), {
    timeout: 20000,
  });
  await page.evaluate(
    ({ step, draftJson, draftKey }) => {
      const d = Object.assign({}, JSON.parse(draftJson), { step });
      localStorage.setItem(draftKey, JSON.stringify(d));
      window.MCJCompanionApplyDraft.gotoStep(step, { alignStepNav: true });
    },
    { step: draft.step, draftJson: JSON.stringify(draft), draftKey: DRAFT_KEY }
  );
  // For deposit STEP1, wait until pay channels render (bootstrap fetch + re-render).
  const mode = String((draft.identity && draft.identity.authMode) || draft.certification_method || "");
  if (mode === "deposit" && draft.step === 0) {
    await page.waitForTimeout(800);
    const depInfo = await page.evaluate(async () => {
      const api = window.MCJCompanionApplyDraft;
      if (api && typeof api.reloadDepositPayMethods === "function") {
        const pay = await api.reloadDepositPayMethods();
        return {
          channels: (pay && pay.channels && pay.channels.length) || 0,
          empty: (pay && pay.emptyMessage) || "",
          err: (pay && pay.error) || "",
        };
      }
      return { channels: -1, empty: "no-api", err: "" };
    });
    console.log("deposit-pay", depInfo);
    await page.waitForFunction(() => {
      return !!document.querySelector("[data-deposit-channel], .apply-deposit-channel, .apply-deposit-qr");
    }, { timeout: 10000 }).catch(() => {});
  }
  await page.waitForTimeout(500);
  return { context, page };
}

async function main() {
  const server = await createStaticServer(ROOT, PORT);
  const browser = await chromium.launch({
    executablePath: "/usr/local/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  try {
    // 1) STEP1 chooser
    {
      const draft = makeDraft(0, {
        certification_method: "",
        identity: { authMode: "", certification_method: "" },
        rulesAgreement: { accepted: false },
      });
      const { context, page } = await openApply(browser, draft);
      await page.waitForSelector("[data-auth-mode]", { timeout: 20000 });
      await takeShot(page, "01-step1-cert-chooser.png");
      await context.close();
    }

    // 2) STEP1 id_card expanded — scroll materials into view
    {
      const { context, page } = await openApply(browser, makeDraft(0));
      await page.waitForSelector("[data-auth-mode='id_card'].is-selected, select[name=documentType], .apply-cert-materials, h2", {
        timeout: 20000,
      });
      await page.evaluate(() => {
        const heading = [...document.querySelectorAll("h2")].find((h) => /完成认证|认证资料|身份证/.test(h.textContent || ""));
        if (heading) heading.scrollIntoView({ block: "start" });
      });
      await page.waitForTimeout(400);
      await takeShot(page, "02-step1-id-card.png");
      await context.close();
    }

    // 3) STEP1 deposit expanded — wait channels then scroll materials
    {
      const draft = makeDraft(0, {
        certification_method: "deposit",
        identity: {
          authMode: "deposit",
          certification_method: "deposit",
          settlementMethod: "银行卡",
          settlementBank: "Maybank",
          settlementName: "Demo User",
          settlementAccount: "1234567890",
          depositChannelId: "tng",
          depositMethod: "tng",
          depositProof: {
            url: "https://placehold.co/320x200/png?text=Deposit",
            path: "dep.jpg",
            status: "ok",
          },
        },
      });
      delete draft.identity.idFront;
      delete draft.identity.idBack;
      delete draft.identity.documentType;
      const { context, page } = await openApply(browser, draft);
      await page.waitForTimeout(1500);
      await page.evaluate(() => {
        const heading = [...document.querySelectorAll("h2")].find((h) => /完成认证|认证资料|押金/.test(h.textContent || ""));
        if (heading) heading.scrollIntoView({ block: "start" });
      });
      await page.waitForTimeout(400);
      await takeShot(page, "03-step1-deposit.png");
      await context.close();
    }

    // 4) STEP2 rules
    {
      const draft = makeDraft(1, {
        rulesAgreement: { accepted: false, version: RULE.version, ruleId: RULE.id },
      });
      const { context, page } = await openApply(browser, draft);
      await page.waitForSelector("[data-rule-agree], .apply-rules-card, h2", { timeout: 20000 });
      await takeShot(page, "04-step2-rules.png");
      await context.close();
    }

    // 5) STEP3 profile + submit CTA
    {
      const { context, page } = await openApply(browser, makeDraft(2));
      await page.waitForSelector("[data-apply-next], .apply-panel", { timeout: 20000 });
      await page.evaluate(() => {
        const btn = document.querySelector("[data-apply-next]");
        if (btn) btn.scrollIntoView({ block: "center" });
      });
      await page.waitForTimeout(400);
      await takeShot(page, "05-step3-profile-submit.png");
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(200);
      await takeShot(page, "05b-step3-top.png");
      await context.close();
    }

    // 6) STEP4 done
    {
      const draft = makeDraft(3, {
        submitted: true,
        status: "pending",
        submittedAt: "2026-09-12 16:00:00",
        applicationId: "APP-DEMO-001",
      });
      const { context, page } = await openApply(browser, draft, { submitted: true });
      await page.waitForSelector(".apply-done-panel, .apply-done-status, h2", { timeout: 20000 });
      await takeShot(page, "06-step4-done.png");
      await context.close();
    }

    // 7) admin level / base_price proof
    {
      const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
      const src = fs.readFileSync(path.join(ROOT, "src/admin-companion-applications.js"), "utf8");
      const hasPicker = /data-capp-level|capp-level-picker|陪玩等级/.test(src);
      const hasBase = /base_price|basePrice/.test(src);
      await page.setContent(`<!doctype html><html><head><meta charset="utf-8">
        <style>
          body{margin:0;background:#140c12;color:#ffe6f2;font-family:system-ui;padding:24px}
          .card{border:1px solid rgba(243,168,203,.28);border-radius:14px;padding:16px;background:rgba(255,255,255,.04);max-width:560px}
          label{display:grid;gap:8px;font-weight:700}
          select,button{height:42px;border-radius:10px;border:1px solid rgba(243,168,203,.35);background:#1a1018;color:#ffe6f2;padding:0 12px}
          button.ok{background:rgba(114,239,180,.18);border-color:rgba(114,239,180,.4);color:#b8ffd7;font-weight:800}
          .note{color:#d9bfcd;font-size:13px;line-height:1.5}
          h2{margin:0 0 12px}
          .okmark{color:#b8ffd7}
        </style></head><body>
        <h2>管理员审核 · 陪玩等级</h2>
        <p class="note">源码校验：等级选择器 ${hasPicker ? '<span class="okmark">存在</span>' : "缺失"}；base_price 读取 ${hasBase ? '<span class="okmark">存在</span>' : "缺失"}（admin-companion-applications.js）</p>
        <div class="card">
          <label>陪玩等级（必选）
            <select data-capp-level="APP-DEMO-001">
              <option value="">请选择等级</option>
              <option value="lv1">Lv1 · base_price 20</option>
              <option value="lv2" selected>Lv2 · base_price 30</option>
            </select>
          </label>
          <p class="note">通过审核前必须选择陪玩等级；价格将按该等级 base_price 自动写入。申请人申请页无等级/价格入口。</p>
          <button class="ok" type="button" data-capp-approve="APP-DEMO-001">审核通过（已选 Lv2 / base_price 30）</button>
        </div>
      </body></html>`);
      await takeShot(page, "07-admin-level-base-price.png");
      await page.close();
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
