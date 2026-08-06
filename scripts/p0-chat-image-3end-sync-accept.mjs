/**
 * P0 accept: chat image sync — one Storage URL, boss / CS / companion same image.
 * Staging only: https://meow-cuijiao-homepage-staging.vercel.app/
 *
 * Usage: node scripts/p0-chat-image-3end-sync-accept.mjs
 */
import { createClient } from "@supabase/supabase-js";

const BASE = (process.env.MCJ_STAGING_URL || "https://meow-cuijiao-homepage-staging.vercel.app").replace(
  /\/$/,
  ""
);
const PASS = process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const BOSS = process.env.E2E_BOSS_EMAIL || "boss.final.1785714993009@meow.test";
const CS = process.env.E2E_CS_EMAIL || "service.final.1785714993009@meow.test";
const COMP = process.env.E2E_COMPANION_EMAIL || "companion.final.1785714993009@meow.test";

/** 10x10 PNG (red) */
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+7AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC";

const results = [];
function step(name, ok, detail = "") {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "") });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
}
function tok(j) {
  return j?.session?.accessToken || j?.session?.token || j?.accessToken || j?.token || "";
}
function bareUrl(v) {
  let s = String(v || "").trim();
  if (s.startsWith("__IMG__:")) s = s.slice("__IMG__:".length).trim();
  if (s.startsWith(":http")) s = s.slice(1);
  return s;
}
function isPublicChatUrl(u) {
  return /^https?:\/\//i.test(u) && /\/storage\/v1\/object\/public\/chat-images\//i.test(u);
}
async function api(path, token, body, method = "POST") {
  const res = await fetch(`${BASE}${path}`, {
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

function imageUrlOfMsg(m) {
  if (!m) return "";
  return bareUrl(m.imageUrl || m.image_url || m.content || "");
}

(async () => {
  console.log("STAGING", BASE);

  const mediaJs = await fetch(`${BASE}/src/mcj-chat-media.js`).then((r) => r.text());
  step(
    "client_imageUrlOf_no_slice7_bug",
    /IMG_TAG\.length|slice\(IMG_TAG\.length\)/.test(mediaJs) ||
      (!/c\.slice\(7\)/.test(mediaJs) && /__IMG__:/.test(mediaJs) && /slice\(8\)|IMG_TAG/.test(mediaJs)),
    /c\.slice\(7\)/.test(mediaJs) ? "still has slice(7)" : "ok"
  );
  step(
    "client_object_fit_contain",
    /object-fit:contain/.test(mediaJs),
    /object-fit:cover/.test(mediaJs) && !/object-fit:contain/.test(mediaJs) ? "still cover" : "contain"
  );

  const bossLogin = await api("/api/auth", null, {
    action: "login",
    email: BOSS,
    password: PASS,
    loginPortal: "boss",
  });
  const bossT = tok(bossLogin.json);
  step("boss_login", !!bossT, bossLogin.json?.message || "");

  const csLogin = await api("/api/auth", null, {
    action: "login",
    email: CS,
    password: PASS,
    loginPortal: "customer_service",
  });
  const csT = tok(csLogin.json);
  step("cs_login", !!csT, csLogin.json?.message || "");

  const compLogin = await api("/api/auth", null, {
    action: "login",
    email: COMP,
    password: PASS,
    loginPortal: "companion",
  });
  const compT = tok(compLogin.json);
  step("companion_login", !!compT, compLogin.json?.message || "");

  if (!bossT || !csT || !compT) {
    console.log(JSON.stringify({ results }, null, 2));
    process.exit(1);
  }

  // Create unpaid order → proof → CS confirm → assign companion (binds order_support.companion_id)
  const create = await api("/api/orders", bossT, {
    action: "create",
    order: {
      title: `P0-CHAT-IMG-${Date.now()}`,
      game: "VALORANT",
      game_id: `P0-IMG-${Date.now()}`,
      description: "chat image sync accept",
      hours: 1,
      unit_price: 12,
      total_amount: 12,
      order_type: "custom",
      payment_method: "tng",
    },
  });
  const orderId = create.json?.order?.id || create.json?.id || "";
  step("boss_create_order", create.ok && !!orderId, orderId || create.json?.message || "");

  if (orderId) {
    await api("/api/orders", bossT, {
      action: "submit_payment_proof",
      id: orderId,
      proofDataUrl: PNG,
      paymentMethod: "tng",
    });
    const paid = await api("/api/customer-service", csT, { action: "confirm_payment", id: orderId });
    step(
      "cs_confirm_payment",
      paid.ok && (paid.json?.order?.status === "pending" || /pending|成功|确认/.test(String(paid.json?.message || paid.json?.order?.status || ""))),
      paid.json?.order?.status || paid.json?.message || ""
    );
  } else {
    step("cs_confirm_payment", false, "no order");
  }

  const open = await api("/api/chat", bossT, {
    action: "open",
    order_id: orderId,
    forceNew: false,
  });
  let convId = open.json?.conversation?.id || open.json?.conversationId || "";
  step("boss_open_order_chat", !!convId, convId || open.json?.message || "");

  if (convId) {
    const take = await api("/api/customer-service", csT, { action: "take_conversation", id: convId });
    step("cs_take_conversation", take.ok || /已接待|接待|负责/.test(String(take.json?.message || "")), take.json?.message || "");
  } else {
    step("cs_take_conversation", false, "no conv");
  }

  // Resolve companion user id (prefer public companions list id used by assign)
  const comps = (await api("/api/public/companions", null, null, "GET")).json?.companions || [];
  const pub =
    comps.find((c) => /final\.1785714993009|Final/i.test(String(c.name || c.email || ""))) ||
    comps.find((c) => String(c.id || "") === String(compLogin.json?.session?.user?.id || "")) ||
    comps[0];
  const meRes = await fetch(`${BASE}/api/companion?action=bootstrap`, {
    headers: { Authorization: `Bearer ${compT}`, "x-mcj-companion-token": compT },
  }).then(async (r) => ({ ok: r.ok, json: await r.json().catch(() => ({})) }));
  const companionId =
    pub?.id ||
    meRes.json?.data?.player?.userId ||
    meRes.json?.data?.profile?.id ||
    compLogin.json?.session?.user?.id ||
    "";
  step("companion_user_id", !!companionId, companionId || meRes.json?.message || "");

  if (orderId && companionId) {
    const assign = await api("/api/customer-service", csT, {
      action: "assign_companion",
      id: orderId,
      order_id: orderId,
      companion_id: companionId,
      from_grabs: false,
    });
    step(
      "cs_assign_companion_to_order",
      assign.ok || /已指定|指定成功|claimed|待陪玩/.test(String(assign.json?.message || "")),
      assign.json?.message || `status=${assign.json?.order?.status || ""} companion=${companionId}`
    );
    const reopen = await api("/api/chat", bossT, { action: "open", order_id: orderId });
    convId = reopen.json?.conversation?.id || convId;
    if (convId) {
      await api("/api/customer-service", csT, { action: "take_conversation", id: convId });
    }
  } else {
    step("cs_assign_companion_to_order", false, `missing order/companion order=${orderId} comp=${companionId}`);
  }

  // Realtime listen on CS before boss sends
  const rtCfg = await fetch(`${BASE}/api/public/realtime-config`).then((r) => r.json());
  let rtGot = null;
  let rtClient = null;
  if (rtCfg?.ok && rtCfg.url && rtCfg.anonKey && convId) {
    rtClient = createClient(rtCfg.url, rtCfg.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    rtClient.realtime.setAuth(csT);
    const channel = rtClient
      .channel("p0-chat-img-" + Date.now())
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${convId}`,
        },
        (payload) => {
          const row = payload?.new;
          if (row && (row.message_type === "image" || String(row.content || "").includes("chat-images") || String(row.content || "").startsWith("__IMG__:"))) {
            rtGot = row;
          }
        }
      );
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => resolve(), 12000);
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(t);
          resolve();
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          clearTimeout(t);
          reject(new Error(status));
        }
      });
    }).catch((err) => {
      step("cs_realtime_subscribe", false, String(err.message || err));
    });
    step("cs_realtime_subscribe", true, convId);
  } else {
    step("cs_realtime_subscribe", false, "realtime config missing");
  }

  const upload = await api("/api/chat-media", bossT, {
    action: "upload",
    data_url: PNG,
    filename: `p0-chat-img-${Date.now()}.png`,
  });
  const uploadedUrl = bareUrl(upload.json?.url);
  step(
    "boss_upload_unique_storage_url",
    upload.ok && isPublicChatUrl(uploadedUrl),
    uploadedUrl.slice(0, 120) || upload.json?.message || ""
  );

  const send = await api("/api/chat", bossT, {
    action: "send",
    conversation_id: convId,
    content: uploadedUrl,
    message_type: "image",
    order_id: orderId,
  });
  const bossMsg = send.json?.appended || send.json?.row || null;
  const bossUrl = imageUrlOfMsg(bossMsg);
  step(
    "boss_send_image_message",
    send.ok && isPublicChatUrl(bossUrl) && bossUrl === uploadedUrl && !String(bossMsg?.content || "").startsWith(":"),
    `type=${bossMsg?.messageType || bossMsg?.message_type} url=${bossUrl.slice(0, 100)}`
  );

  // Wait briefly for realtime
  const waitUntil = Date.now() + 8000;
  while (!rtGot && Date.now() < waitUntil) {
    await new Promise((r) => setTimeout(r, 300));
  }
  const rtUrl = bareUrl(rtGot?.image_url || rtGot?.content || "");
  step(
    "cs_realtime_receives_same_url",
    !!rtGot && isPublicChatUrl(rtUrl) && rtUrl === uploadedUrl && !rtUrl.startsWith(":"),
    rtGot ? `url=${rtUrl.slice(0, 100)}` : "timeout"
  );
  if (rtClient) {
    try {
      await rtClient.removeAllChannels();
    } catch (_) {}
  }

  const csList = await api("/api/customer-service", csT, {
    action: "list_messages",
    id: convId,
    conversation_id: convId,
  });
  const csMsgs = csList.json?.messages || [];
  const csHit =
    csMsgs.find((m) => imageUrlOfMsg(m) === uploadedUrl) ||
    csMsgs.slice().reverse().find((m) => /chat-images|__IMG__/.test(String(m.content || m.imageUrl || "")));
  const csUrl = imageUrlOfMsg(csHit);
  step(
    "cs_list_same_image_url",
    csList.ok && isPublicChatUrl(csUrl) && csUrl === uploadedUrl && (csHit?.messageType === "image" || csHit?.message_type === "image"),
    `url=${csUrl.slice(0, 100)} type=${csHit?.messageType || csHit?.message_type || ""}`
  );

  // Companion inbox should see order room + same image
  let inbox = await api("/api/companion", compT, {
    action: "inbox",
    conversation_id: convId,
  });
  if (!inbox.ok) {
    inbox = await fetch(`${BASE}/api/companion?action=inbox&conversation_id=${encodeURIComponent(convId)}`, {
      headers: { Authorization: `Bearer ${compT}`, "x-mcj-companion-token": compT },
    }).then(async (r) => ({ ok: r.ok, json: await r.json().catch(() => ({})) }));
  }
  const inboxMsgs = inbox.json?.inbox?.messages || inbox.json?.messages || inbox.json?.data?.messages || [];
  const inboxConvs = inbox.json?.inbox?.csConversations || inbox.json?.csConversations || inbox.json?.data?.csConversations || [];
  const hasConv = (inboxConvs || []).some((c) => String(c.id) === String(convId));
  const compHit =
    inboxMsgs.find((m) => imageUrlOfMsg(m) === uploadedUrl) ||
    inboxMsgs.slice().reverse().find((m) => /chat-images|__IMG__/.test(String(m.content || m.imageUrl || "")));
  const compUrl = imageUrlOfMsg(compHit);
  step(
    "companion_sees_order_conversation",
    hasConv || !!compHit,
    `hasConv=${hasConv} msgs=${inboxMsgs.length} inboxOk=${inbox.ok}`
  );
  step(
    "companion_same_image_url",
    isPublicChatUrl(compUrl) && compUrl === uploadedUrl,
    `url=${compUrl.slice(0, 100)} type=${compHit?.messageType || ""}`
  );

  // Boss reload must normalize tagged legacy content
  const reload = await api("/api/chat", bossT, { action: "open", conversation_id: convId, order_id: orderId });
  const reloadMsgs = reload.json?.messages || [];
  const reloadHit =
    reloadMsgs.find((m) => imageUrlOfMsg(m) === uploadedUrl) ||
    reloadMsgs.slice().reverse().find((m) => /chat-images|__IMG__/.test(String(m.content || m.imageUrl || "")));
  const reloadUrl = imageUrlOfMsg(reloadHit);
  step(
    "boss_reload_same_image_url",
    isPublicChatUrl(reloadUrl) && reloadUrl === uploadedUrl && !String(reloadHit?.content || "").startsWith(":"),
    `url=${reloadUrl.slice(0, 100)} type=${reloadHit?.messageType || reloadHit?.message_type || ""}`
  );

  // HEAD fetch image is loadable
  let headOk = false;
  try {
    const head = await fetch(uploadedUrl, { method: "GET" });
    headOk = head.ok && /image\//i.test(head.headers.get("content-type") || "image/");
  } catch (_) {}
  step("storage_image_loadable", headOk, uploadedUrl.slice(0, 80));

  const failed = results.filter((r) => r.result === "FAIL");
  console.log("\nSUMMARY", { pass: results.length - failed.length, fail: failed.length, total: results.length });
  console.log(JSON.stringify({ staging: BASE, uploadedUrl, convId, orderId, results }, null, 2));
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
