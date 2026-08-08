/**
 * Real cross-role chat isolation accept against Preview/Staging.
 * Companion must NOT read boss↔CS history / images / conversation_id.
 *
 * Usage:
 *   MCJ_STAGING_URL=https://... node scripts/p0-chat-side-isolation-live-accept.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function loadEnv() {
  for (const name of [".env.local", ".env"]) {
    const p = path.join(ROOT, name);
    if (!fs.existsSync(p)) continue;
    for (const raw of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#") || !line.includes("=")) continue;
      const i = line.indexOf("=");
      const k = line.slice(0, i).trim();
      const v = line.slice(i + 1).trim().replace(/^['"]|['']$/g, "");
      if (k && v && !process.env[k]) process.env[k] = v;
    }
  }
}
loadEnv();

const BASE = (process.env.MCJ_STAGING_URL || process.env.MCJ_PREVIEW_URL || "https://meow-cuijiao-homepage-staging.vercel.app").replace(
  /\/$/,
  ""
);
const PASS = process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const BOSS = process.env.E2E_BOSS_EMAIL || "boss@meow.test";
const COMPANION = process.env.E2E_COMPANION_EMAIL || "companion.final.1785714993009@meow.test";
const COMPANION_ALT = process.env.E2E_COMPANION_ALT_EMAIL || "companion.idcard.1785715257525@meow.test";
const CS = process.env.E2E_CS_EMAIL || "service.final.1785714993009@meow.test";

const results = [];
function step(name, ok, detail) {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "") });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
  return ok;
}

async function api(pathname, token, body, method, extra = {}) {
  const m = method || (body == null ? "GET" : "POST");
  const res = await fetch(`${BASE}${pathname}`, {
    method: m,
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body != null ? { "Content-Type": "application/json" } : {}),
      ...extra,
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text.slice(0, 240) };
  }
  return { ok: res.ok && json.ok !== false, status: res.status, json, text };
}

function tokenOf(login) {
  return (
    login.json?.session?.accessToken ||
    login.json?.accessToken ||
    login.json?.session?.token ||
    login.json?.token ||
    ""
  );
}

const tinyPng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL6nQAAAABJRU5ErkJggg==";

(async () => {
  console.log("BASE", BASE);

  const bossLogin = await api("/api/auth", null, { action: "login", email: BOSS, password: PASS, loginPortal: "boss" });
  const bossTok = tokenOf(bossLogin);
  step("boss login", !!bossTok, bossLogin.json?.message || "");

  const compLogin = await api("/api/auth", null, {
    action: "login",
    email: COMPANION,
    password: PASS,
    loginPortal: "companion",
  });
  const compTok = tokenOf(compLogin);
  step("companion login", !!compTok, compLogin.json?.message || "");

  const compAltLogin = await api("/api/auth", null, {
    action: "login",
    email: COMPANION_ALT,
    password: PASS,
    loginPortal: "companion",
  });
  const compAltTok = tokenOf(compAltLogin);
  step("companion-alt login", !!compAltTok, compAltLogin.json?.message || "optional");

  const csLogin = await api("/api/customer-service", null, { action: "login", account: CS, password: PASS });
  const csTok = tokenOf(csLogin);
  step("cs login", !!csTok, csLogin.json?.message || "");

  const markerBoss = `老板私人消息 A ${Date.now()}`;
  const markerComp = `陪玩私人消息 B ${Date.now()}`;

  // Boss opens / sends CS chat
  const bossOpen = await api("/api/chat", bossTok, {
    action: "ensure_conversation",
    consult_type: "general",
    message: markerBoss,
  });
  let bossConvId =
    bossOpen.json?.conversation?.id ||
    bossOpen.json?.conversationId ||
    bossOpen.json?.id ||
    "";
  if (!bossConvId) {
    const bossSend = await api("/api/chat", bossTok, { action: "send_message", content: markerBoss });
    bossConvId = bossSend.json?.conversation?.id || bossSend.json?.conversationId || "";
    step("boss send/open conversation", !!(bossSend.ok && bossConvId), bossSend.json?.message || bossSend.status);
  } else {
    step("boss ensure conversation", !!(bossOpen.ok && bossConvId), bossConvId);
    await api("/api/chat", bossTok, {
      action: "send_message",
      conversation_id: bossConvId,
      conversationId: bossConvId,
      content: markerBoss,
    });
  }

  // Companion inbox + companion support send
  const inbox = await api(`/api/companion?action=inbox`, compTok, null, "GET");
  const inboxItems = inbox.json?.conversations || inbox.json?.items || inbox.json?.csConversations || [];
  const inboxIds = inboxItems.map((x) => String(x.id || x.conversationId || "")).filter(Boolean);
  const inboxTypes = inboxItems.map((x) => String(x.conversation_type || x.conversationType || x.type || ""));
  step(
    "companion inbox excludes boss conversation_id",
    !bossConvId || !inboxIds.includes(String(bossConvId)),
    `bossConv=${bossConvId} inbox=${inboxIds.slice(0, 5).join(",")}`
  );
  step(
    "companion inbox types are companion_support only",
    !inboxTypes.length || inboxTypes.every((t) => !t || t === "companion_support"),
    JSON.stringify(inboxTypes.slice(0, 8))
  );

  const compSend = await api("/api/companion", compTok, {
    action: "send_cs_message",
    content: markerComp,
    consult_type: "general",
  });
  const altCompSend =
    compSend.ok
      ? compSend
      : await api("/api/companion", compTok, { action: "send_message", content: markerComp, consult_type: "general" });
  const compConvId =
    (compSend.json?.conversation || compSend.json)?.id ||
    compSend.json?.conversationId ||
    (altCompSend.json?.conversation || altCompSend.json)?.id ||
    altCompSend.json?.conversationId ||
    "";
  step("companion can send own CS message", !!(compSend.ok || altCompSend.ok) && !!compConvId, compSend.json?.message || altCompSend.json?.message || compConvId);

  // Direct conversation_id access
  const directLoad = await api("/api/chat", compTok, {
    action: "get_messages",
    conversation_id: bossConvId,
    conversationId: bossConvId,
  });
  const directGet = await api(`/api/chat?action=messages&conversation_id=${encodeURIComponent(bossConvId)}`, compTok, null, "GET");
  const directMsgs =
    directLoad.json?.messages ||
    directGet.json?.messages ||
    directLoad.json?.items ||
    directGet.json?.items ||
    [];
  const leakedBossText = JSON.stringify(directLoad.json || {}) + JSON.stringify(directGet.json || {});
  step(
    "companion direct conversation_id blocked",
    (directLoad.status === 403 || directLoad.status === 404 || directLoad.json?.ok === false) &&
      (directGet.status === 403 || directGet.status === 404 || directGet.json?.ok === false) &&
      !String(leakedBossText).includes(markerBoss) &&
      !(Array.isArray(directMsgs) && directMsgs.length > 0 && directMsgs.some((m) => String(m.content || m.body || "").includes(markerBoss))),
    `load=${directLoad.status}/${directLoad.json?.message || ""} get=${directGet.status}`
  );

  // Companion cannot send into boss room
  const sendIntoBoss = await api("/api/chat", compTok, {
    action: "send_message",
    conversation_id: bossConvId,
    conversationId: bossConvId,
    content: "陪玩越权尝试写入老板会话",
  });
  step(
    "companion cannot send into boss room",
    sendIntoBoss.status === 403 || sendIntoBoss.status === 404 || sendIntoBoss.json?.ok === false,
    sendIntoBoss.status + " " + (sendIntoBoss.json?.message || "")
  );

  // Image upload into boss room
  const uploadIntoBoss = await api("/api/chat-media", compTok, {
    action: "upload",
    conversation_id: bossConvId,
    conversationId: bossConvId,
    dataUrl: tinyPng,
    fileName: "leak.png",
  });
  step(
    "companion cannot upload image into boss room",
    uploadIntoBoss.status === 403 || uploadIntoBoss.status === 404 || uploadIntoBoss.json?.ok === false,
    uploadIntoBoss.status + " " + (uploadIntoBoss.json?.message || "")
  );

  // CS can see both sides separately
  if (csTok && bossConvId) {
    const csBoss = await api("/api/customer-service", csTok, {
      action: "conversation_messages",
      conversation_id: bossConvId,
      conversationId: bossConvId,
    });
    const csBossAlt = csBoss.ok
      ? csBoss
      : await api(`/api/chat?action=messages&conversation_id=${encodeURIComponent(bossConvId)}`, csTok, null, "GET");
    const csText = JSON.stringify(csBoss.json || {}) + JSON.stringify(csBossAlt.json || {});
    step("cs can read boss room marker", csText.includes(markerBoss), `status=${csBoss.status}/${csBossAlt.status}`);
    if (compConvId) {
      step("cs boss room does not contain companion marker", !csText.includes(markerComp), "no cross-leak");
    }
  } else {
    step("cs can read boss room marker", false, "cs token/conversation missing");
  }

  // Other companion cannot access either
  if (compAltTok && bossConvId) {
    const altBoss = await api("/api/chat", compAltTok, {
      action: "get_messages",
      conversation_id: bossConvId,
      conversationId: bossConvId,
    });
    step(
      "other companion cannot read boss room",
      altBoss.status === 403 || altBoss.status === 404 || altBoss.json?.ok === false,
      altBoss.status + " " + (altBoss.json?.message || "")
    );
  }
  if (compAltTok && compConvId) {
    const altComp = await api("/api/chat", compAltTok, {
      action: "get_messages",
      conversation_id: compConvId,
      conversationId: compConvId,
    });
    step(
      "other companion cannot read companion room",
      altComp.status === 403 || altComp.status === 404 || altComp.json?.ok === false,
      altComp.status + " " + (altComp.json?.message || "")
    );
  }

  const failed = results.filter((r) => r.result === "FAIL");
  const out = { base: BASE, failed: failed.length, results };
  fs.writeFileSync(path.join(ROOT, "scripts/p0-chat-side-isolation-live-accept-results.json"), JSON.stringify(out, null, 2));
  console.log(failed.length ? `CHAT_SIDE_ISOLATION_LIVE_FAIL ${failed.length}` : "CHAT_SIDE_ISOLATION_LIVE_PASS");
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
