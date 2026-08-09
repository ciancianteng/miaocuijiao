/**
 * P0: CS ↔ Boss bidirectional image chat (real upload + same conversation messages).
 * Usage: PREVIEW=https://meow-cuijiao-homepage-staging.vercel.app node scripts/p0-cs-boss-image-chat-e2e.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.PREVIEW || "https://meow-cuijiao-homepage-staging.vercel.app").replace(/\/$/, "");
const PASS = process.env.PASS || process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const CS_EMAIL = process.env.E2E_CS_EMAIL || "service.final.1785714993009@meow.test";
const BOSS_A = process.env.E2E_BOSS_EMAIL || "boss.final.1785714993009@meow.test";
const BOSS_B = process.env.E2E_BOSS_B_EMAIL || "boss@meow.test";
const COMP = process.env.E2E_COMPANION_EMAIL || "companion.final.1785714993009@meow.test";
const ART = path.join("/opt/cursor/artifacts", "cs-boss-image-chat-e2e");
const ART_REPO = path.join(ROOT, "artifacts", "cs-boss-image-chat-e2e");
fs.mkdirSync(ART, { recursive: true });
fs.mkdirSync(ART_REPO, { recursive: true });

/** 10x10 red PNG */
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+7AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC";
const PNG_DATA = `data:image/png;base64,${PNG_B64}`;
/** 10x10 blue-ish PNG variant (different bytes) */
const PNG2_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+7AAAAFUlEQVR42mNkYPhfz0AEYBxVSF+FAP5FDvcfRYQwAAAAAElFTkSuQmCC";
const PNG2_DATA = `data:image/png;base64,${PNG2_B64}`;

const results = [];
function step(name, ok, detail) {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "").slice(0, 900) });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
  return ok;
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function tok(j) {
  return j?.session?.accessToken || j?.session?.token || j?.accessToken || j?.token || "";
}
function bare(v) {
  let s = String(v || "").trim();
  if (s.startsWith("__IMG__:")) s = s.slice("__IMG__:".length).trim();
  if (s.startsWith(":http")) s = s.slice(1);
  return s;
}
function imgOf(m) {
  return bare(m?.imageUrl || m?.image_url || (String(m?.messageType || m?.message_type) === "image" ? m?.content : "") || "");
}
function isHttpsImg(u) {
  return /^https?:\/\//i.test(String(u || "")) && !/^(blob:|data:)/i.test(String(u || ""));
}

async function api(pathName, token, body, method = "POST") {
  const res = await fetch(`${BASE}${pathName}`, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(token
        ? {
            Authorization: `Bearer ${token}`,
            "x-mcj-access-token": token,
            "x-mcj-service-token": token,
            "x-mcj-companion-token": token,
          }
        : {}),
    },
    body: method === "GET" || body == null ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok && json.ok !== false, status: res.status, json };
}

async function loginRole(email, roleHint) {
  const r = await api("/api/auth", null, { action: "login", email, password: PASS, role: roleHint });
  if (!r.ok) {
    const r2 = await api("/api/auth", null, { action: "login", account: email, password: PASS });
    return { ok: r2.ok, token: tok(r2.json), json: r2.json, status: r2.status };
  }
  return { ok: true, token: tok(r.json), json: r.json, status: r.status };
}

async function shot(page, name) {
  const file = `${name}.png`;
  const p1 = path.join(ART, file);
  await page.screenshot({ path: p1, fullPage: true }).catch(() => {});
  try {
    fs.copyFileSync(p1, path.join(ART_REPO, file));
  } catch (_) {}
  return p1;
}

async function writePngFixture(name, b64) {
  const p = path.join(ART, name);
  fs.writeFileSync(p, Buffer.from(b64, "base64"));
  return p;
}

(async () => {
  console.log("STAGING", BASE);
  const marker = `IMGCHAT-${Date.now()}`;
  let csTok = "";
  let bossATok = "";
  let bossBTok = "";
  let compTok = "";
  let convId = "";
  let csImgUrl = "";
  let bossImgUrl = "";
  let csStorageRef = "";
  let bossStorageRef = "";

  // --- Auth ---
  {
    const cs = await loginRole(CS_EMAIL, "customer_service");
    csTok = cs.token;
    step("auth_cs", !!csTok, csTok ? "ok" : JSON.stringify(cs.json).slice(0, 200));
    const ba = await loginRole(BOSS_A, "boss");
    bossATok = ba.token;
    step("auth_boss_a", !!bossATok, bossATok ? "ok" : JSON.stringify(ba.json).slice(0, 200));
    const bb = await loginRole(BOSS_B, "boss");
    bossBTok = bb.token;
    step("auth_boss_b", !!bossBTok, bossBTok ? "ok" : `status=${bb.status}`);
    const cp = await loginRole(COMP, "companion");
    compTok = cp.token;
    step("auth_companion", !!compTok, compTok ? "ok" : `status=${cp.status}`);
  }

  // --- Ensure boss A ↔ CS conversation ---
  {
    const open = await api("/api/chat", bossATok, { action: "open", forceNew: false });
    convId = open.json?.conversation?.id || open.json?.conversationId || "";
    if (!convId) {
      const list = await api("/api/chat?action=conversations", bossATok, null, "GET");
      const rows = list.json?.conversations || list.json?.data || [];
      convId = rows[0]?.id || "";
    }
    step("boss_a_conversation", !!convId, convId || JSON.stringify(open.json).slice(0, 240));
  }

  // CS accept / lock conversation (required before CS can send)
  {
    const acc = await api("/api/customer-service", csTok, { action: "accept", conversation_id: convId, id: convId });
    const ok =
      acc.ok ||
      /已接待|已在接待|正在接待/i.test(String(acc.json?.message || ""));
    step("cs_accept", ok, acc.json?.message || JSON.stringify(acc.json).slice(0, 200));
  }

  // ========== TEST 1: CS → Boss image ==========
  {
    const up = await api("/api/chat-media", csTok, {
      action: "upload",
      conversation_id: convId,
      data_url: PNG_DATA,
      filename: `${marker}-cs.png`,
    });
    csImgUrl = up.json?.url || "";
    csStorageRef = up.json?.storageRef || "";
    step("cs_upload", up.ok && isHttpsImg(csImgUrl) && !!csStorageRef, `url=${!!csImgUrl} ref=${csStorageRef}`);

    const send = await api("/api/customer-service", csTok, {
      action: "send_message",
      conversation_id: convId,
      content: csStorageRef || csImgUrl,
      message_type: "image",
    });
    const row = send.json?.messageRow || {};
    const sentUrl = imgOf(row);
    step(
      "cs_send_image_message",
      send.ok && String(row.messageType || row.message_type) === "image" && isHttpsImg(sentUrl),
      `type=${row.messageType || row.message_type} url=${String(sentUrl).slice(0, 80)}`
    );

    await sleep(800);
    const bossMsgs = await api(`/api/chat?action=messages&conversation_id=${encodeURIComponent(convId)}`, bossATok, null, "GET");
    const list = bossMsgs.json?.messages || [];
    const images = list.filter((m) => String(m.messageType || m.message_type) === "image" && isHttpsImg(imgOf(m)));
    const hit =
      images.find((m) => {
        const u = imgOf(m);
        const ref = String(m.storageRef || m.content || "");
        return (
          (csStorageRef && ref.includes(csStorageRef.split(":")[1] || "___")) ||
          (sentUrl && u.split("?")[0] === sentUrl.split("?")[0]) ||
          (csImgUrl && u.split("?")[0] === csImgUrl.split("?")[0])
        );
      }) || images.slice(-1)[0];
    const bossSees = hit && isHttpsImg(imgOf(hit));
    step("boss_receives_cs_image", !!bossSees, bossSees ? imgOf(hit).slice(0, 100) : `msgs=${list.length} imgs=${images.length}`);
    if (bossSees) csImgUrl = imgOf(hit) || csImgUrl;
  }

  // ========== TEST 2: Boss → CS image ==========
  {
    const up = await api("/api/chat-media", bossATok, {
      action: "upload",
      conversation_id: convId,
      data_url: PNG2_DATA,
      filename: `${marker}-boss.png`,
    });
    bossImgUrl = up.json?.url || "";
    bossStorageRef = up.json?.storageRef || "";
    step("boss_upload", up.ok && isHttpsImg(bossImgUrl) && !!bossStorageRef, `ref=${bossStorageRef}`);

    const send = await api("/api/chat", bossATok, {
      action: "send",
      conversation_id: convId,
      content: bossStorageRef || bossImgUrl,
      message_type: "image",
    });
    const row = send.json?.appended || send.json?.row || {};
    const sentUrl = imgOf(row);
    step(
      "boss_send_image_message",
      send.ok && String(row.messageType || row.message_type) === "image" && isHttpsImg(sentUrl),
      `url=${String(sentUrl).slice(0, 80)}`
    );

    await sleep(800);
    const csMsgs = await api("/api/customer-service", csTok, { action: "list_messages", conversation_id: convId, id: convId });
    const list = csMsgs.json?.messages || [];
    const images = list.filter((m) => String(m.messageType || m.message_type) === "image");
    const hit = images.slice(-1)[0];
    const csSees = hit && isHttpsImg(imgOf(hit));
    step("cs_receives_boss_image", !!csSees && images.length >= 2, `images=${images.length} last=${csSees ? imgOf(hit).slice(0, 80) : "none"}`);
    if (csSees) bossImgUrl = imgOf(hit) || bossImgUrl;
  }

  // ========== TEST 3: refresh persist (re-list / re-sign) ==========
  {
    const csMsgs = await api("/api/customer-service", csTok, { action: "list_messages", conversation_id: convId, id: convId });
    const bossMsgs = await api(`/api/chat?action=messages&conversation_id=${encodeURIComponent(convId)}`, bossATok, null, "GET");
    const csImgs = (csMsgs.json?.messages || []).filter((m) => String(m.messageType || m.message_type) === "image" && isHttpsImg(imgOf(m)));
    const bossImgs = (bossMsgs.json?.messages || []).filter((m) => String(m.messageType || m.message_type) === "image" && isHttpsImg(imgOf(m)));
    step("refresh_persist_cs", csImgs.length >= 2, `csImages=${csImgs.length}`);
    step("refresh_persist_boss", bossImgs.length >= 2, `bossImages=${bossImgs.length}`);

    // Fetch actual image bytes via signed URL
    let fetchOk = false;
    if (csImgs[0]) {
      const r = await fetch(imgOf(csImgs[0]));
      fetchOk = r.ok && Number(r.headers.get("content-length") || 1) > 0;
    }
    step("signed_url_fetchable", fetchOk, fetchOk ? "https image OK" : "fetch failed");
  }

  // ========== TEST 4: re-login history ==========
  {
    const cs2 = await loginRole(CS_EMAIL, "customer_service");
    const ba2 = await loginRole(BOSS_A, "boss");
    const csMsgs = await api("/api/customer-service", cs2.token, { action: "list_messages", conversation_id: convId, id: convId });
    const bossMsgs = await api(`/api/chat?action=messages&conversation_id=${encodeURIComponent(convId)}`, ba2.token, null, "GET");
    const csImgs = (csMsgs.json?.messages || []).filter((m) => String(m.messageType || m.message_type) === "image" && isHttpsImg(imgOf(m)));
    const bossImgs = (bossMsgs.json?.messages || []).filter((m) => String(m.messageType || m.message_type) === "image" && isHttpsImg(imgOf(m)));
    step("relogin_history_cs", csImgs.length >= 2, `csImages=${csImgs.length}`);
    step("relogin_history_boss", bossImgs.length >= 2, `bossImages=${bossImgs.length}`);
  }

  // ========== TEST 5: boss B isolation ==========
  {
    if (!bossBTok) {
      step("boss_b_isolation", false, "boss B login failed");
    } else {
      const openB = await api("/api/chat", bossBTok, { action: "open", forceNew: false });
      const convB = openB.json?.conversation?.id || "";
      const msgsB = convB
        ? await api("/api/chat", bossBTok, { action: "messages", conversation_id: convB })
        : { json: { messages: [] } };
      const leaked = (msgsB.json?.messages || []).some((m) => {
        const u = imgOf(m);
        return u && (u === csImgUrl || u === bossImgUrl || (csStorageRef && String(m.storageRef || m.content || "").includes(csStorageRef.split(":")[1] || "___")));
      });
      const sameConv = convB && convB === convId;
      step("boss_b_isolation", !sameConv && !leaked, `convB=${convB || "none"} same=${!!sameConv} leaked=${!!leaked}`);

      // Boss B cannot sign boss A storage ref
      if (csStorageRef) {
        const sign = await api("/api/chat-media", bossBTok, {
          action: "sign",
          conversation_id: convId,
          storageRef: csStorageRef,
          url: csStorageRef,
        });
        step("boss_b_cannot_sign_a", !sign.ok || sign.status === 403, `status=${sign.status}`);
      } else {
        step("boss_b_cannot_sign_a", true, "skipped no storageRef");
      }
    }
  }

  // ========== TEST 6: companion privacy ==========
  {
    if (!compTok) {
      step("companion_privacy", false, "companion login failed");
    } else {
      const inbox = await api("/api/companion-inbox", compTok, { action: "bootstrap" });
      const convs = inbox.json?.conversations || inbox.json?.data?.conversations || [];
      const leakConv = convs.some((c) => c.id === convId);
      const msgs = await api("/api/companion-inbox", compTok, { action: "messages", conversation_id: convId, id: convId });
      const leakMsgs = (msgs.json?.messages || []).length > 0 && msgs.ok;
      const sign = await api("/api/chat-media", compTok, {
        action: "sign",
        conversation_id: convId,
        storageRef: csStorageRef || bossStorageRef,
        url: csStorageRef || bossStorageRef || csImgUrl,
      });
      step(
        "companion_privacy",
        !leakConv && !leakMsgs && (!sign.ok || sign.status === 403),
        `leakConv=${leakConv} leakMsgs=${!!leakMsgs} sign=${sign.status}`
      );
    }
  }

  // ========== TEST 7: text chat still works ==========
  {
    const text = `${marker}-text-ping`;
    const csSend = await api("/api/customer-service", csTok, {
      action: "send_message",
      conversation_id: convId,
      content: text,
      message_type: "text",
    });
    await sleep(500);
    const bossMsgs = await api(`/api/chat?action=messages&conversation_id=${encodeURIComponent(convId)}`, bossATok, null, "GET");
    const bossSees = (bossMsgs.json?.messages || []).some((m) => String(m.content || "") === text);
    const reply = `${marker}-text-pong`;
    const bossSend = await api("/api/chat", bossATok, {
      action: "send",
      conversation_id: convId,
      content: reply,
      message_type: "text",
    });
    await sleep(500);
    const csMsgs = await api("/api/customer-service", csTok, { action: "list_messages", conversation_id: convId, id: convId });
    const csSees = (csMsgs.json?.messages || []).some((m) => String(m.content || "") === reply);
    step("text_chat_still_works", csSend.ok && bossSend.ok && bossSees && csSees, `cs→boss=${bossSees} boss→cs=${csSees}`);
  }

  // ========== UI: media component + image button present ==========
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: process.env.PLAYWRIGHT_CHROMIUM || "/usr/bin/chromium-browser",
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
  } catch {
    try {
      browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    } catch (e) {
      step("ui_browser", false, String(e.message || e));
      browser = null;
    }
  }

  if (browser) {
    const pngPath = await writePngFixture("ui-upload.png", PNG_B64);

    // --- CS UI (isolated context) ---
    const csCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const csPage = await csCtx.newPage();
    await csPage.goto(`${BASE}/customer-service/login/?t=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await csPage.waitForSelector('input[name="account"]', { timeout: 30000 });
    await csPage.fill('input[name="account"]', CS_EMAIL);
    await csPage.fill('input[name="password"]', PASS);
    await Promise.all([
      csPage.waitForURL(/\/customer-service\/(dashboard|orders|conversations)/i, { timeout: 60000 }),
      csPage.click('button[type="submit"]'),
    ]);
    await csPage.waitForTimeout(1500);
    const convNav = csPage.locator('.cs-nav button:has-text("统一会话池"), a:has-text("统一会话池")');
    if (await convNav.count()) await convNav.first().click();
    else await csPage.goto(`${BASE}/customer-service/conversations/?t=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await csPage.waitForFunction(() => !!(window.MCJChatMedia && window.MCJChatMedia.pickAndSendImages), null, { timeout: 30000 }).catch(() => {});
    await csPage.waitForTimeout(1500);
    const mediaReady = await csPage.evaluate(() => !!(window.MCJChatMedia && window.MCJChatMedia.pickAndSendImages));
    step("ui_cs_media_loaded", mediaReady, mediaReady ? "MCJChatMedia ready" : "missing MCJChatMedia");

    await csPage.locator('[data-conv-filter="active"]').click().catch(() => {});
    await csPage.waitForTimeout(600);
    let opened = false;
    for (let i = 0; i < 50 && !opened; i++) {
      const row = csPage.locator(`[data-conversation="${convId}"]`);
      if (await row.count()) {
        await row.first().click();
        opened = true;
        break;
      }
      await csPage.evaluate(() => {
        const body =
          document.querySelector("[data-cs-virt-body]") ||
          document.querySelector(".cs-chat-list") ||
          document.querySelector("[data-cs-chat-list]");
        if (body) body.scrollTop = (body.scrollTop || 0) + 480;
      });
      await csPage.waitForTimeout(150);
    }
    if (!opened) {
      const any = csPage.locator("[data-conversation]").first();
      if (await any.count()) await any.click();
    }
    await csPage.waitForTimeout(2000);
    // If still empty pane, click "打开会话列表" then first row.
    if (!(await csPage.locator("[data-cs-image]").count())) {
      const openList = csPage.locator('button:has-text("打开会话列表")');
      if (await openList.count()) await openList.first().click();
      await csPage.waitForTimeout(500);
      const row2 = csPage.locator(`[data-conversation="${convId}"]`);
      if (await row2.count()) await row2.first().click();
      else if (await csPage.locator("[data-conversation]").count()) await csPage.locator("[data-conversation]").first().click();
      await csPage.waitForTimeout(1500);
    }
    await csPage.waitForSelector("[data-cs-image]", { timeout: 15000 }).catch(() => {});
    const imgBtn = csPage.locator("[data-cs-image]");
    const btnOk = (await imgBtn.count()) > 0;
    step("ui_cs_image_button", btnOk, btnOk ? await imgBtn.first().innerText().catch(() => "btn") : "missing");
    await shot(csPage, "cs-conversations");

    if (btnOk && mediaReady) {
      const [fileChooser] = await Promise.all([
        csPage.waitForEvent("filechooser", { timeout: 10000 }).catch(() => null),
        imgBtn.first().click(),
      ]);
      if (fileChooser) {
        await fileChooser.setFiles(pngPath);
        await csPage.waitForTimeout(6000);
        const hasImg = await csPage.locator(".cs-chat-messages .mcj-chat-img, .cs-chat-messages [data-chat-image]").count();
        step("ui_cs_image_send_visible", hasImg > 0, `thumbs=${hasImg}`);
        await shot(csPage, "cs-after-image-send");
      } else {
        step("ui_cs_image_send_visible", false, "filechooser not opened");
      }
    } else {
      step("ui_cs_image_send_visible", false, "button/media missing");
    }
    await csCtx.close();

    // --- Boss UI (isolated context + portal JWT) ---
    const bossCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const bossPage = await bossCtx.newPage();
    await bossPage.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await bossPage.evaluate(
      async ({ email, pass }) => {
        const res = await fetch("/api/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "login", email, password: pass, role: "boss" }),
        });
        const body = await res.json();
        const session = body.session || {};
        const token = session.accessToken || session.token || body.token || "";
        const refresh = session.refreshToken || session.refresh_token || "";
        const expiresAt = session.expiresAt || session.expires_at || "";
        const user = body.user || session.user || { email, role: "boss" };
        [localStorage, sessionStorage].forEach((store) => {
          try {
            if (token) store.setItem("mcjAuthAccessToken", token);
            if (refresh) store.setItem("mcjAuthRefreshToken", refresh);
            if (expiresAt) store.setItem("mcjAuthExpiresAt", String(expiresAt));
            store.setItem("mcjRole", "boss");
            store.setItem("customerAuthToken", token);
            store.setItem("customerUser", JSON.stringify(user));
            store.setItem("mcjCurrentUser", JSON.stringify(user));
            store.setItem("mcjBossSession", JSON.stringify(session));
            store.setItem("mcjCustomerSession", JSON.stringify(session));
          } catch (_) {}
        });
      },
      { email: BOSS_A, pass: PASS }
    );
    await bossPage.goto(`${BASE}/support.html?conversation=${encodeURIComponent(convId)}&t=${Date.now()}`, {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });
    await bossPage.waitForFunction(() => !!(window.MCJChatMedia && window.MCJChatMedia.pickAndSendImages), null, {
      timeout: 30000,
    }).catch(() => {});
    await bossPage.waitForTimeout(2500);
    if (!(await bossPage.locator("[data-chat-image-btn]").count())) {
      const item = bossPage.locator(`[data-select-conversation="${convId}"], [data-conversation="${convId}"]`);
      if (await item.count()) await item.first().click();
      else if (await bossPage.locator("[data-select-conversation]").count()) {
        await bossPage.locator("[data-select-conversation]").first().click();
      }
      await bossPage.waitForTimeout(2000);
    }
    const bossMedia = await bossPage.evaluate(() => !!(window.MCJChatMedia && window.MCJChatMedia.pickAndSendImages));
    step("ui_boss_media_loaded", bossMedia, bossMedia ? "ok" : `url=${bossPage.url()}`);
    await bossPage.waitForSelector("[data-chat-image-btn]", { timeout: 15000 }).catch(() => {});
    const bossBtn = bossPage.locator("[data-chat-image-btn]");
    step("ui_boss_image_button", (await bossBtn.count()) > 0, "图片按钮");
    const bossImgs = await bossPage.locator(".mcj-chat-img, [data-chat-image]").count();
    step("ui_boss_sees_history_images", bossImgs >= 1, `imgs=${bossImgs}`);
    await shot(bossPage, "boss-support-chat");
    await bossCtx.close();

    await browser.close();
  }

  // Matrix summary required by the task
  const by = Object.fromEntries(results.map((r) => [r.step, r.result === "PASS"]));
  const matrix = {
    "客服→老板图片": by.cs_send_image_message && by.boss_receives_cs_image,
    "老板→客服图片": by.boss_send_image_message && by.cs_receives_boss_image,
    "刷新后持久化": by.refresh_persist_cs && by.refresh_persist_boss && by.signed_url_fetchable,
    "重新登录历史图片": by.relogin_history_cs && by.relogin_history_boss,
    "会话隔离": by.boss_b_isolation && by.boss_b_cannot_sign_a,
    "陪玩隐私隔离": by.companion_privacy,
    "原文字聊天": by.text_chat_still_works,
  };

  console.log("\n======== MATRIX ========");
  for (const [k, v] of Object.entries(matrix)) {
    console.log(`${k}: ${v ? "PASS" : "FAIL"}`);
  }
  const allPass = Object.values(matrix).every(Boolean);
  console.log(`ALL: ${allPass ? "PASS" : "FAIL"}`);

  const out = { base: BASE, convId, marker, results, matrix, allPass };
  fs.writeFileSync(path.join(ART, "results.json"), JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(ART_REPO, "results.json"), JSON.stringify(out, null, 2));
  process.exit(allPass ? 0 : 1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
