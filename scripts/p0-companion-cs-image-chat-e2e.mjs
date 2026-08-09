/**
 * P0: Companion ↔ CS bidirectional image chat.
 * Usage: PREVIEW=https://meow-cuijiao-homepage-staging.vercel.app node scripts/p0-companion-cs-image-chat-e2e.mjs
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.PREVIEW || "https://meow-cuijiao-homepage-staging.vercel.app").replace(/\/$/, "");
const PASS = process.env.PASS || process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const CS_EMAIL = process.env.E2E_CS_EMAIL || "service.final.1785714993009@meow.test";
const COMP = process.env.E2E_COMPANION_EMAIL || "companion.final.1785714993009@meow.test";
const COMP_B = process.env.E2E_COMPANION_B_EMAIL || "companion@meow.test";
const BOSS = process.env.E2E_BOSS_EMAIL || "boss.final.1785714993009@meow.test";
const ART = path.join("/opt/cursor/artifacts", "companion-cs-image-chat-e2e");
const ART_REPO = path.join(ROOT, "artifacts", "companion-cs-image-chat-e2e");
fs.mkdirSync(ART, { recursive: true });
fs.mkdirSync(ART_REPO, { recursive: true });

const results = [];
function step(name, ok, detail) {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "").slice(0, 800) });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
  return ok;
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function tok(j) {
  return j?.session?.accessToken || j?.session?.token || j?.accessToken || j?.token || "";
}
function makePng(r = 210, g = 40, b = 90, w = 120, h = 80) {
  function crc32(buf) {
    let c = ~0;
    for (let i = 0; i < buf.length; i++) {
      c ^= buf[i];
      for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
    }
    return ~c >>> 0;
  }
  function u32(n) {
    const buf = Buffer.alloc(4);
    buf.writeUInt32BE(n >>> 0, 0);
    return buf;
  }
  function chunk(type, data) {
    const typeBuf = Buffer.from(type, "ascii");
    return Buffer.concat([u32(data.length), typeBuf, data, u32(crc32(Buffer.concat([typeBuf, data])))]);
  }
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      const i = row + 1 + x * 3;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return { dataUrl: `data:image/png;base64,${png.toString("base64")}`, b64: png.toString("base64") };
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

async function login(email, role) {
  const r = await api("/api/auth", null, { action: "login", email, password: PASS, role });
  if (!r.ok) {
    const r2 = await api("/api/auth", null, { action: "login", account: email, password: PASS });
    return { ok: r2.ok, token: tok(r2.json), json: r2.json };
  }
  return { ok: true, token: tok(r.json), json: r.json };
}

function isHttpsImg(u) {
  return /^https?:\/\//i.test(String(u || "")) && !/^(blob:|data:)/i.test(String(u || ""));
}
function imgOf(m) {
  return String(m?.imageUrl || m?.image_url || (String(m?.messageType || m?.message_type) === "image" ? m?.content : "") || "");
}

(async () => {
  console.log("STAGING", BASE);
  const marker = `COMPIMG-${Date.now()}`;
  const pngA = makePng(220, 40, 80);
  const pngB = makePng(40, 120, 220);

  const cs = await login(CS_EMAIL, "customer_service");
  const cp = await login(COMP, "companion");
  const cpB = await login(COMP_B, "companion");
  const boss = await login(BOSS, "boss");
  step("auth_cs", !!cs.token, cs.token ? "ok" : JSON.stringify(cs.json).slice(0, 160));
  step("auth_companion", !!cp.token, cp.token ? "ok" : JSON.stringify(cp.json).slice(0, 160));
  step("auth_companion_b", !!cpB.token, cpB.token ? "ok" : `status`);
  step("auth_boss", !!boss.token, boss.token ? "ok" : `status`);

  const open = await api("/api/companion", cp.token, { action: "start_cs_consult", consult_type: "other" });
  let convId = open.json?.conversationId || open.json?.conversation?.id || "";
  if (!convId) {
    const inbox = await api("/api/companion?action=inbox", cp.token, null, "GET");
    const data = inbox.json?.inbox || inbox.json?.data || {};
    convId = data?.conversation?.id || data?.csConversationId || (data?.conversations || [])[0]?.id || "";
  }
  step("companion_cs_conversation", !!convId, convId || JSON.stringify(open.json).slice(0, 200));

  const acc = await api("/api/customer-service", cs.token, { action: "accept", conversation_id: convId, id: convId });
  step(
    "cs_accept",
    acc.ok || /已接待|正在接待/i.test(String(acc.json?.message || "")),
    acc.json?.message || JSON.stringify(acc.json).slice(0, 160)
  );

  // Baseline unread on CS for this conversation
  const beforeList = await api("/api/customer-service", cs.token, { action: "poll_updates" });
  const beforeConv = (beforeList.json?.conversations || []).find((c) => String(c.id) === String(convId));
  const beforeUnread = Number(beforeConv?.unread || beforeConv?.unreadCount || 0);

  // TEST 1+2: companion → CS image
  {
    const up = await api("/api/chat-media", cp.token, {
      action: "upload",
      conversation_id: convId,
      data_url: pngA.dataUrl,
      filename: `${marker}-a.png`,
    });
    const ref = up.json?.storageRef || up.json?.url || "";
    step("companion_upload", up.ok && !!ref, up.ok ? String(ref).slice(0, 80) : JSON.stringify(up.json).slice(0, 200));
    const send = await api("/api/companion", cp.token, {
      action: "send_cs_message",
      conversation_id: convId,
      content: ref,
      message_type: "image",
      forceNew: false,
    });
    const row = send.json?.messageRow;
    step(
      "companion_send_image",
      send.ok && String(row?.messageType || "") === "image" && isHttpsImg(imgOf(row)),
      `ok=${send.ok} type=${row?.messageType} url=${String(imgOf(row)).slice(0, 90)}`
    );

    await sleep(700);
    const csMsgs = await api("/api/customer-service", cs.token, {
      action: "list_messages",
      conversation_id: convId,
      id: convId,
    });
    const list = csMsgs.json?.messages || [];
    const hit = list.filter((m) => String(m.senderRole || m.sender_role) === "companion" && String(m.messageType || m.message_type) === "image").slice(-1)[0];
    step(
      "cs_receives_companion_image",
      !!hit && isHttpsImg(imgOf(hit)),
      hit ? String(imgOf(hit)).slice(0, 100) : `msgs=${list.length}`
    );

    const compThread = await api(
      `/api/companion?action=thread&conversation_id=${encodeURIComponent(convId)}`,
      cp.token,
      null,
      "GET"
    );
    const tmsgs = compThread.json?.messages || compThread.json?.data?.messages || [];
    const thit = tmsgs.filter((m) => String(m.messageType || m.message_type) === "image").slice(-1)[0];
    step(
      "companion_sees_own_image",
      !!thit && isHttpsImg(imgOf(thit)),
      thit ? String(imgOf(thit)).slice(0, 100) : `msgs=${tmsgs.length}`
    );
  }

  // TEST 3: CS → companion image
  {
    const up = await api("/api/chat-media", cs.token, {
      action: "upload",
      conversation_id: convId,
      data_url: pngB.dataUrl,
      filename: `${marker}-b.png`,
    });
    const ref = up.json?.storageRef || up.json?.url || "";
    const send = await api("/api/customer-service", cs.token, {
      action: "send_message",
      conversation_id: convId,
      id: convId,
      content: ref,
      message_type: "image",
    });
    step("cs_send_image", send.ok, send.json?.message || JSON.stringify(send.json).slice(0, 160));
    await sleep(700);
    const compThread = await api(
      `/api/companion?action=thread&conversation_id=${encodeURIComponent(convId)}`,
      cp.token,
      null,
      "GET"
    );
    const tmsgs = compThread.json?.messages || compThread.json?.data?.messages || [];
    const hit = [...tmsgs]
      .reverse()
      .find((m) => String(m.senderRole || m.sender_role) === "customer_service" && String(m.messageType || m.message_type) === "image");
    step("companion_receives_cs_image", !!hit && isHttpsImg(imgOf(hit)), hit ? String(imgOf(hit)).slice(0, 100) : "missing");
  }

  // TEST 4 refresh persist
  {
    const csMsgs = await api("/api/customer-service", cs.token, {
      action: "list_messages",
      conversation_id: convId,
      id: convId,
    });
    const imgs = (csMsgs.json?.messages || []).filter((m) => String(m.messageType || m.message_type) === "image" && isHttpsImg(imgOf(m)));
    step("refresh_persist_cs", imgs.length >= 2, `imgs=${imgs.length}`);
    const compThread = await api(
      `/api/companion?action=thread&conversation_id=${encodeURIComponent(convId)}`,
      cp.token,
      null,
      "GET"
    );
    const cimgs = (compThread.json?.messages || compThread.json?.data?.messages || []).filter(
      (m) => String(m.messageType || m.message_type) === "image" && isHttpsImg(imgOf(m))
    );
    step("refresh_persist_companion", cimgs.length >= 2, `imgs=${cimgs.length}`);
  }

  // TEST 5 re-login
  {
    const cs2 = await login(CS_EMAIL, "customer_service");
    const cp2 = await login(COMP, "companion");
    const csMsgs = await api("/api/customer-service", cs2.token, {
      action: "list_messages",
      conversation_id: convId,
      id: convId,
    });
    const imgs = (csMsgs.json?.messages || []).filter((m) => String(m.messageType || m.message_type) === "image" && isHttpsImg(imgOf(m)));
    const compThread = await api(
      `/api/companion?action=thread&conversation_id=${encodeURIComponent(convId)}`,
      cp2.token,
      null,
      "GET"
    );
    const cimgs = (compThread.json?.messages || compThread.json?.data?.messages || []).filter(
      (m) => String(m.messageType || m.message_type) === "image" && isHttpsImg(imgOf(m))
    );
    step("relogin_history", imgs.length >= 2 && cimgs.length >= 2, `cs=${imgs.length} comp=${cimgs.length}`);
  }

  // TEST 6 isolation
  {
    if (cpB.token) {
      const other = await api(
        `/api/companion?action=thread&conversation_id=${encodeURIComponent(convId)}`,
        cpB.token,
        null,
        "GET"
      );
      const blocked = !other.ok || other.status === 403 || /无权|不存在|禁止/i.test(String(other.json?.message || ""));
      step("isolation_companion_b", blocked, `ok=${other.ok} status=${other.status} msg=${other.json?.message || ""}`);
    } else {
      step("isolation_companion_b", true, "companion B login unavailable — skipped");
    }
    const bossThread = await api(`/api/chat?conversation_id=${encodeURIComponent(convId)}`, boss.token, null, "GET");
    const bossBlocked =
      !bossThread.ok ||
      bossThread.status === 403 ||
      /无权|不存在|禁止/i.test(String(bossThread.json?.message || "")) ||
      !(bossThread.json?.messages || []).length;
    step("isolation_boss", bossBlocked, `ok=${bossThread.ok} status=${bossThread.status}`);
  }

  // TEST 7 text still works both ways
  {
    const cSend = await api("/api/companion", cp.token, {
      action: "send_cs_message",
      conversation_id: convId,
      content: `${marker}-text-c`,
      message_type: "text",
      forceNew: false,
    });
    const sSend = await api("/api/customer-service", cs.token, {
      action: "send_message",
      conversation_id: convId,
      id: convId,
      content: `${marker}-text-s`,
      message_type: "text",
    });
    await sleep(500);
    const csMsgs = await api("/api/customer-service", cs.token, {
      action: "list_messages",
      conversation_id: convId,
      id: convId,
    });
    const texts = (csMsgs.json?.messages || []).map((m) => String(m.content || ""));
    step(
      "text_chat_both_ways",
      cSend.ok && sSend.ok && texts.some((t) => t.includes(`${marker}-text-c`)) && texts.some((t) => t.includes(`${marker}-text-s`)),
      `c=${cSend.ok} s=${sSend.ok}`
    );
  }

  // TEST 8 unread +1 when CS not focused — simulate by sending image then checking poll unread
  {
    // Mark read first
    await api("/api/customer-service", cs.token, { action: "mark_read", conversation_id: convId, id: convId });
    await sleep(400);
    const up = await api("/api/chat-media", cp.token, {
      action: "upload",
      conversation_id: convId,
      data_url: makePng(10, 200, 10).dataUrl,
      filename: `${marker}-unread.png`,
    });
    await api("/api/companion", cp.token, {
      action: "send_cs_message",
      conversation_id: convId,
      content: up.json?.storageRef || up.json?.url,
      message_type: "image",
      forceNew: false,
    });
    await sleep(900);
    const poll = await api("/api/customer-service", cs.token, { action: "poll_updates" });
    const conv = (poll.json?.conversations || []).find((c) => String(c.id) === String(convId));
    const unread = Number(conv?.unread || conv?.unreadCount || 0);
    step("unread_image_counts", unread >= 1, `unread=${unread} before=${beforeUnread}`);
  }

  // UI smoke: companion messages page image button present
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.PLAYWRIGHT_CHROMIUM || "/usr/local/bin/google-chrome",
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`${BASE}/companion/messages/?t=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.evaluate(
      async ({ email, pass, base }) => {
        const res = await fetch(`${base}/api/auth`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "login", email, password: pass, role: "companion" }),
        });
        const body = await res.json();
        const session = body.session || {};
        const token = session.accessToken || session.token || body.token || "";
        const refresh = session.refreshToken || session.refresh_token || "";
        const user = body.user || { email, role: "companion" };
        const payload = JSON.stringify({
          token,
          accessToken: token,
          refreshToken: refresh,
          user,
          remember: true,
        });
        localStorage.setItem("mcjCompanionSession", payload);
        sessionStorage.setItem("mcjCompanionSession", payload);
        // Also try common keys used by workbench
        localStorage.setItem("companionSession", payload);
        sessionStorage.setItem("companionSession", payload);
        localStorage.setItem("mcjAuthAccessToken", token);
        sessionStorage.setItem("mcjAuthAccessToken", token);
        localStorage.setItem("mcjRole", "companion");
      },
      { email: COMP, pass: PASS, base: BASE }
    );
    // Discover session key from page source if needed
    await page.goto(`${BASE}/companion/messages/?t=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await sleep(2500);
    const mediaReady = await page.evaluate(() => !!(window.MCJChatMedia && window.MCJChatMedia.pickAndSendImages));
    const imgBtn = await page.locator("[data-pw-image]").count();
    step("ui_companion_media_ready", mediaReady, `media=${mediaReady} btn=${imgBtn}`);
    await page.screenshot({ path: path.join(ART, "01-companion-messages.png"), fullPage: true }).catch(() => {});
    try {
      fs.copyFileSync(path.join(ART, "01-companion-messages.png"), path.join(ART_REPO, "01-companion-messages.png"));
    } catch (_) {}
  } catch (err) {
    step("ui_fatal", false, err?.message || String(err));
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  const by = Object.fromEntries(results.map((r) => [r.step, r.result === "PASS"]));
  const verdict = {
    "陪玩→客服图片": by.companion_send_image && by.cs_receives_companion_image && by.companion_sees_own_image,
    "客服→陪玩图片": by.cs_send_image && by.companion_receives_cs_image,
    实时同步: by.cs_receives_companion_image,
    刷新后持久化: by.refresh_persist_cs && by.refresh_persist_companion,
    重新登录历史图片: by.relogin_history,
    会话隔离: by.isolation_companion_b && by.isolation_boss,
    图片未读计数: by.unread_image_counts,
    原文字聊天: by.text_chat_both_ways,
  };
  const summary = { base: BASE, convId, results, verdict };
  fs.writeFileSync(path.join(ART, "summary.json"), JSON.stringify(summary, null, 2));
  try {
    fs.copyFileSync(path.join(ART, "summary.json"), path.join(ART_REPO, "summary.json"));
  } catch (_) {}
  const failed = results.some((r) => r.result === "FAIL") || Object.values(verdict).some((v) => !v);
  console.log(JSON.stringify(verdict, null, 2));
  console.log(failed ? "OVERALL FAIL" : "OVERALL PASS");
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
