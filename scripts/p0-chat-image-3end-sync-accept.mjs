/**
 * P0 accept: chat image sync — one Storage URL, boss / CS / companion same image.
 * Staging only: https://meow-cuijiao-homepage-staging.vercel.app/
 *
 * Usage: node scripts/p0-chat-image-3end-sync-accept.mjs
 */
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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

(async () => {
  console.log("STAGING", BASE);

  const mediaJs = await fetch(`${BASE}/src/mcj-chat-media.js?v=20260806chatImg1`).then((r) => r.text());
  const mediaJsLegacy = await fetch(`${BASE}/src/mcj-chat-media.js?v=20260801chatImg`).then((r) => r.text());
  const mediaOk =
    /IMG_TAG/.test(mediaJs) && !/c\.slice\(7\)/.test(mediaJs) && /object-fit:contain/.test(mediaJs);
  step("client_imageUrlOf_fixed", mediaOk, mediaOk ? "IMG_TAG + contain" : "missing fix markers");
  step(
    "client_cache_url_serves_fix",
    /IMG_TAG/.test(mediaJsLegacy) && !/c\.slice\(7\)/.test(mediaJsLegacy),
    /c\.slice\(7\)/.test(mediaJsLegacy) ? "legacy query still old content" : "legacy query also fixed content"
  );

  const bossLogin = await api("/api/auth", null, {
    action: "login",
    email: BOSS,
    password: PASS,
    loginPortal: "boss",
  });
  const bossT = tok(bossLogin.json);
  step("boss_login", !!bossT, bossLogin.json?.message || "");

  const csLogin = await api("/api/customer-service", null, {
    action: "login",
    account: CS,
    password: PASS,
  });
  const csT = tok(csLogin.json);
  step("cs_login", !!csT, csLogin.json?.message || "");

  const compLogin = await api("/api/companion", null, {
    action: "login",
    account: COMP,
    password: PASS,
  });
  const compT = tok(compLogin.json);
  step("companion_login", !!compT, compLogin.json?.message || "");

  if (!bossT || !csT || !compT) {
    console.log(JSON.stringify({ results }, null, 2));
    process.exit(1);
  }

  const companionId = compLogin.json?.session?.user?.id || compLogin.json?.user?.id || "";
  step("companion_user_id", !!companionId, companionId || "");

  // VIP direct designate at create → order_support.companion_id bound (skips grab hall).
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
      order_type: "direct_companion",
      payment_method: "tng",
      companion_id: companionId,
      companionId,
    },
  });
  const orderId = create.json?.order?.id || create.json?.id || "";
  const createComp =
    create.json?.order?.companionId || create.json?.order?.companion_id || "";
  step(
    "boss_create_vip_order",
    create.ok && !!orderId && String(createComp) === String(companionId),
    `${orderId || create.json?.message || ""} companion=${createComp}`
  );

  if (orderId) {
    await api("/api/orders", bossT, {
      action: "submit_payment_proof",
      id: orderId,
      proofDataUrl: PNG,
      paymentMethod: "tng",
    });
    const paid = await api("/api/customer-service", csT, { action: "confirm_payment", id: orderId });
    const paidComp = paid.json?.order?.companionId || paid.json?.order?.companion_id || createComp;
    step(
      "cs_confirm_payment_keeps_companion",
      paid.ok && String(paidComp) === String(companionId),
      `status=${paid.json?.order?.status || ""} companion=${paidComp} msg=${paid.json?.message || ""}`
    );
  } else {
    step("cs_confirm_payment_keeps_companion", false, "no order");
  }

  const open = await api("/api/chat", bossT, {
    action: "open",
    order_id: orderId,
    forceNew: false,
  });
  let convId = open.json?.conversation?.id || open.json?.conversationId || "";
  const convComp =
    open.json?.conversation?.companion_id || open.json?.conversation?.companionId || "";
  step(
    "boss_open_order_chat",
    !!convId && (!!convComp || !!companionId),
    `conv=${convId || open.json?.message || ""} companion=${convComp || "(ensure will patch)"}`
  );

  // Ensure conversation companion_id via CS ensure path (assign/ensureConversation patch).
  if (orderId && companionId) {
    const ensure = await api("/api/customer-service", csT, {
      action: "assign_companion",
      id: orderId,
      order_id: orderId,
      companion_id: companionId,
      from_grabs: false,
    });
    step(
      "cs_bind_companion_on_order_room",
      ensure.ok ||
        /已指定|指定成功|claimed|待陪玩|deduped|成功|已选定陪玩/.test(String(ensure.json?.message || "")) ||
        String(ensure.json?.order?.companionId || ensure.json?.order?.companion_id || "") === String(companionId),
      ensure.json?.message || `status=${ensure.json?.order?.status || ""}`
    );
    const reopen = await api("/api/chat", bossT, { action: "open", order_id: orderId });
    convId = reopen.json?.conversation?.id || convId;
  } else {
    step("cs_bind_companion_on_order_room", false, "missing ids");
  }

  if (convId) {
    const take = await api("/api/customer-service", csT, { action: "take_conversation", id: convId });
    step(
      "cs_take_conversation",
      take.ok || /已接待|接待|负责/.test(String(take.json?.message || "")),
      take.json?.message || ""
    );
  } else {
    step("cs_take_conversation", false, "no conv");
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

  const tSend = Date.now();
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
    send.ok &&
      isPublicChatUrl(bossUrl) &&
      bossUrl === uploadedUrl &&
      !String(bossMsg?.content || "").startsWith(":") &&
      (bossMsg?.messageType === "image" || bossMsg?.message_type === "image"),
    `type=${bossMsg?.messageType || bossMsg?.message_type} url=${bossUrl.slice(0, 100)}`
  );

  let csHit = null;
  let csUrl = "";
  let csLatency = null;
  for (let i = 0; i < 10; i++) {
    const csList = await api("/api/customer-service", csT, {
      action: "list_messages",
      id: convId,
      conversation_id: convId,
    });
    const csMsgs = csList.json?.messages || [];
    csHit =
      csMsgs.find((m) => imageUrlOfMsg(m) === uploadedUrl) ||
      csMsgs
        .slice()
        .reverse()
        .find((m) => /chat-images|__IMG__/.test(String(m.content || m.imageUrl || "")));
    csUrl = imageUrlOfMsg(csHit);
    if (isPublicChatUrl(csUrl) && csUrl === uploadedUrl) {
      csLatency = Date.now() - tSend;
      break;
    }
    await sleep(250);
  }
  step(
    "cs_receives_same_image_without_refresh",
    isPublicChatUrl(csUrl) &&
      csUrl === uploadedUrl &&
      (csHit?.messageType === "image" || csHit?.message_type === "image") &&
      csLatency != null &&
      csLatency < 5000,
    `url=${csUrl.slice(0, 100)} type=${csHit?.messageType || csHit?.message_type || ""} latencyMs=${csLatency}`
  );

  let inbox = await api("/api/companion", compT, {
    action: "inbox",
    conversation_id: convId,
  });
  if (!inbox.ok) {
    inbox = await fetch(`${BASE}/api/companion?action=inbox&conversation_id=${encodeURIComponent(convId)}`, {
      headers: { Authorization: `Bearer ${compT}`, "x-mcj-companion-token": compT },
    }).then(async (r) => ({ ok: r.ok, json: await r.json().catch(() => ({})) }));
  }
  let inboxMsgs = inbox.json?.inbox?.messages || inbox.json?.messages || inbox.json?.data?.messages || [];
  let inboxConvs =
    inbox.json?.inbox?.csConversations || inbox.json?.csConversations || inbox.json?.data?.csConversations || [];
  for (let i = 0; i < 6 && !inboxMsgs.some((m) => imageUrlOfMsg(m) === uploadedUrl); i++) {
    await sleep(400);
    inbox = await fetch(`${BASE}/api/companion?action=inbox&conversation_id=${encodeURIComponent(convId)}`, {
      headers: { Authorization: `Bearer ${compT}`, "x-mcj-companion-token": compT },
    }).then(async (r) => ({ ok: r.ok, json: await r.json().catch(() => ({})) }));
    inboxMsgs = inbox.json?.inbox?.messages || inbox.json?.messages || inbox.json?.data?.messages || [];
    inboxConvs =
      inbox.json?.inbox?.csConversations || inbox.json?.csConversations || inbox.json?.data?.csConversations || [];
  }
  const hasConv = (inboxConvs || []).some((c) => String(c.id) === String(convId));
  const compHit =
    inboxMsgs.find((m) => imageUrlOfMsg(m) === uploadedUrl) ||
    inboxMsgs
      .slice()
      .reverse()
      .find((m) => /chat-images|__IMG__/.test(String(m.content || m.imageUrl || "")));
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

  const reload = await api("/api/chat", bossT, { action: "open", conversation_id: convId, order_id: orderId });
  const reloadMsgs = reload.json?.messages || [];
  const reloadHit =
    reloadMsgs.find((m) => imageUrlOfMsg(m) === uploadedUrl) ||
    reloadMsgs
      .slice()
      .reverse()
      .find((m) => /chat-images|__IMG__/.test(String(m.content || m.imageUrl || "")));
  const reloadUrl = imageUrlOfMsg(reloadHit);
  step(
    "boss_reload_same_image_url",
    isPublicChatUrl(reloadUrl) &&
      reloadUrl === uploadedUrl &&
      !String(reloadHit?.content || "").startsWith(":") &&
      (reloadHit?.messageType === "image" || reloadHit?.message_type === "image"),
    `url=${reloadUrl.slice(0, 100)} type=${reloadHit?.messageType || reloadHit?.message_type || ""}`
  );

  let headOk = false;
  try {
    const head = await fetch(uploadedUrl, { method: "GET" });
    headOk = head.ok;
  } catch (_) {}
  step("storage_image_loadable", headOk, uploadedUrl.slice(0, 80));

  const sameThree =
    bossUrl === uploadedUrl && csUrl === uploadedUrl && compUrl === uploadedUrl && isPublicChatUrl(uploadedUrl);
  step("three_ends_identical_url", sameThree, uploadedUrl.slice(0, 120));

  const failed = results.filter((r) => r.result === "FAIL");
  console.log("\nSUMMARY", { pass: results.length - failed.length, fail: failed.length, total: results.length });
  console.log(JSON.stringify({ staging: BASE, uploadedUrl, convId, orderId, results }, null, 2));
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
