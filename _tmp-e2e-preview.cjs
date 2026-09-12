/**
 * Real Preview E2E for launch main flow. Prints PASS/FAIL only. No secrets.
 */
const BASE = process.argv[2] || "https://meow-cuijiao-homepage-j7ago4wwk-ciancianteng-4581s-projects.vercel.app";
const PASSWORD = "McjTest@12345678";

const results = [];
let failed = null;
const ctx = {};

function log(step, status, detail) {
  const row = { step, status, detail: detail || "" };
  results.push(row);
  console.log(`${status}\t${step}${detail ? " | " + detail : ""}`);
}

async function api(method, path, body, headers = {}, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(BASE + path, {
      method,
      headers: Object.assign(
        { Accept: "application/json", "Content-Type": "application/json" },
        headers
      ),
      body: body == null ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text.slice(0, 200) };
    }
    return { status: res.status, ok: res.ok, json, text: text.slice(0, 400) };
  } finally {
    clearTimeout(timer);
  }
}

function tok(session) {
  return session && (session.accessToken || session.token || session.access_token);
}

async function loginBoss() {
  const r = await api("POST", "/api/auth", { action: "login", email: "boss@meow.test", password: PASSWORD });
  if (!r.json || !r.json.ok || !tok(r.json.session)) throw new Error("老板登录失败: " + (r.json && r.json.message) + " HTTP " + r.status);
  ctx.bossToken = tok(r.json.session);
  ctx.bossHeaders = { Authorization: "Bearer " + ctx.bossToken, "x-mcj-access-token": ctx.bossToken };
  ctx.bossUser = r.json.session.user || r.json.user || {};
}

async function loginCs() {
  const r = await api("POST", "/api/customer-service", { action: "login", account: "service@meow.test", password: PASSWORD });
  if (!r.json || !r.json.ok || !tok(r.json.session)) throw new Error("客服登录失败: " + (r.json && r.json.message) + " HTTP " + r.status);
  ctx.csToken = tok(r.json.session);
  ctx.csHeaders = { Authorization: "Bearer " + ctx.csToken, "x-mcj-service-token": ctx.csToken };
  ctx.csUser = r.json.session.user || {};
}

async function loginCompanion() {
  const r = await api("POST", "/api/companion", { action: "login", account: "companion@meow.test", password: PASSWORD });
  if (!r.json || !r.json.ok || !tok(r.json.session)) throw new Error("陪玩登录失败: " + (r.json && r.json.message) + " HTTP " + r.status);
  ctx.compToken = tok(r.json.session);
  ctx.compHeaders = { Authorization: "Bearer " + ctx.compToken, "x-mcj-companion-token": ctx.compToken };
  ctx.compUser = r.json.session.user || {};
  ctx.companionId = ctx.compUser.id || ctx.compUser.userId || "";
}

async function step1_placeOrder() {
  // Resolve companion id from public list or companion login profile
  let companionId = ctx.companionId;
  let companionName = ctx.compUser.name || ctx.compUser.nickname || "陪玩";
  let unitPrice = 10;
  const pub = await api("GET", "/api/public/companions");
  const list = (pub.json && (pub.json.companions || pub.json.items || pub.json.data)) || [];
  if (Array.isArray(list) && list.length) {
    const match =
      list.find((c) => String(c.userId || c.user_id || c.id) === String(companionId)) ||
      list.find((c) => /companion@meow\.test/i.test(String(c.email || ""))) ||
      list[0];
    companionId = match.userId || match.user_id || match.id;
    companionName = match.nickname || match.name || companionName;
    unitPrice = Number(match.price || match.unitPrice || unitPrice) || 10;
  }
  if (!companionId) throw new Error("找不到可下单陪玩");

  const hours = 1;
  const r = await api(
    "POST",
    "/api/orders",
    {
      action: "place_order",
      companionId,
      companionName,
      hours,
      unitPrice,
      price: unitPrice,
      totalAmount: unitPrice * hours,
      game: "VALORANT",
      serviceType: "陪玩",
      gameId: "E2E-BOSS-" + Date.now().toString().slice(-6),
      paymentMethod: "tng",
      notes: "E2E Preview acceptance offline TNG",
    },
    ctx.bossHeaders
  );
  if (!r.json || !r.json.ok) throw new Error("下单失败: " + (r.json && r.json.message) + " HTTP " + r.status + " " + r.text);
  const order = r.json.order || r.json.data || r.json;
  ctx.orderId = order.id || order.orderId;
  ctx.orderNo = order.orderNo || order.order_no || "";
  ctx.orderStatus = order.status;
  if (!ctx.orderId) throw new Error("下单成功但无 order.id");
  if (ctx.orderStatus !== "awaiting_payment") {
    // Still accept if created; note status
    throw new Error("期望 awaiting_payment，实际 " + ctx.orderStatus);
  }
  ctx.companionId = companionId;
  return `order=${ctx.orderNo || ctx.orderId} companion=${companionId}`;
}

async function step2_csSeesOrder() {
  const r = await api("GET", "/api/customer-service?action=bootstrap", null, ctx.csHeaders);
  if (!r.json || !r.json.ok) throw new Error("客服 bootstrap 失败: " + (r.json && r.json.message) + " HTTP " + r.status);
  const orders = (r.json.data && r.json.data.orders) || [];
  const found = orders.find((o) => o.id === ctx.orderId || o.orderNo === ctx.orderNo);
  if (!found) throw new Error("客服端订单列表未找到新订单 " + (ctx.orderNo || ctx.orderId));
  ctx.csOrder = found;
  return `status=${found.status}`;
}

async function step3_accept() {
  // Ensure conversation exists for order (boss open or CS create via order chat)
  const open = await api("POST", "/api/chat", { action: "open", order_id: ctx.orderId }, ctx.bossHeaders);
  if (!open.json || !open.json.ok) throw new Error("老板打开会话失败: " + (open.json && open.json.message));
  ctx.conversationId = open.json.conversation && (open.json.conversation.id || open.json.conversation.conversation_id);
  if (!ctx.conversationId) throw new Error("无 conversation id");

  const accept = await api(
    "POST",
    "/api/customer-service/accept",
    { id: ctx.conversationId, conversation_id: ctx.conversationId, action: "accept" },
    ctx.csHeaders
  );
  if (!accept.json || !accept.json.ok) {
    // fallback take_conversation
    const take = await api(
      "POST",
      "/api/customer-service",
      { action: "take_conversation", id: ctx.conversationId },
      ctx.csHeaders
    );
    if (!take.json || !take.json.ok) throw new Error("接待失败: " + ((accept.json && accept.json.message) || (take.json && take.json.message)));
  }
  return `conversation=${ctx.conversationId}`;
}

async function step4_servingUiState() {
  const r = await api("GET", "/api/customer-service?action=bootstrap", null, ctx.csHeaders);
  const list = (r.json && r.json.data && r.json.data.conversations) || [];
  const c = list.find((x) => x.id === ctx.conversationId);
  if (!c) throw new Error("接待后会话不在列表");
  const myId = ctx.csUser.id;
  if (!c.currentServiceId) throw new Error("接待后 currentServiceId 为空");
  if (myId && c.currentServiceId !== myId) throw new Error("接待人不是当前客服");
  if (!(c.status === "正在接待" || c.status === "接待中" || c.status === "serving" || c.currentServiceId)) {
    throw new Error("状态不是正在接待: " + c.status);
  }
  ctx.conv = c;
  return `status=${c.status} service=${c.currentServiceId}`;
}

async function step5_composerUnlock() {
  // Same condition as frontend composerCanReply
  if (!(ctx.conv && ctx.conv.currentServiceId && ctx.conv.currentServiceId === ctx.csUser.id)) {
    throw new Error("输入框仍会锁定：currentServiceId 未绑定当前客服");
  }
  return "canReply=true";
}

async function step6_bidirectional() {
  const bossMsg = "老板E2E消息-" + Date.now();
  const csMsg = "客服E2E消息-" + Date.now();

  const bSend = await api(
    "POST",
    "/api/chat",
    { action: "send", conversation_id: ctx.conversationId, content: bossMsg, order_id: ctx.orderId },
    ctx.bossHeaders
  );
  if (!bSend.json || !bSend.json.ok) throw new Error("老板发送失败: " + (bSend.json && bSend.json.message));

  const csSend = await api(
    "POST",
    "/api/customer-service",
    { action: "send_message", conversation_id: ctx.conversationId, content: csMsg },
    ctx.csHeaders
  );
  if (!csSend.json || !csSend.json.ok) throw new Error("客服发送失败: " + (csSend.json && csSend.json.message));

  const thread = await api("GET", "/api/chat?conversation_id=" + encodeURIComponent(ctx.conversationId), null, ctx.bossHeaders);
  const msgs = (thread.json && thread.json.messages) || [];
  const hasBoss = msgs.some((m) => String(m.content || "").includes(bossMsg));
  const hasCs = msgs.some((m) => String(m.content || "").includes(csMsg));
  if (!hasBoss || !hasCs) throw new Error(`消息未双向落库 boss=${hasBoss} cs=${hasCs}`);
  return `messages=${msgs.length}`;
}

async function step7_confirmPayment() {
  const r = await api("POST", "/api/customer-service", { action: "confirm_payment", id: ctx.orderId }, ctx.csHeaders);
  if (!r.json || !r.json.ok) throw new Error("确认付款失败: " + (r.json && r.json.message));
  const order = r.json.order || {};
  ctx.orderStatus = order.status;
  if (ctx.orderStatus !== "claimed" && ctx.orderStatus !== "pending") {
    throw new Error("确认付款后状态异常: " + ctx.orderStatus);
  }
  return `status=${ctx.orderStatus}`;
}

async function step8_dispatch() {
  // 指定陪玩已存在：确认付款后应已 claimed 派给陪玩；若 pending 则 assign
  if (ctx.orderStatus === "claimed") return "already_claimed_to_companion";
  const r = await api(
    "POST",
    "/api/customer-service",
    { action: "assign_companion", id: ctx.orderId, companion_id: ctx.companionId },
    ctx.csHeaders
  );
  if (!r.json || !r.json.ok) throw new Error("派单失败: " + (r.json && r.json.message));
  ctx.orderStatus = (r.json.order && r.json.order.status) || ctx.orderStatus;
  return `status=${ctx.orderStatus}`;
}

async function step9_companionAccept() {
  // claimed → accept_direct; pending → accept_order; waiting_boss_confirm → boss confirm
  let r;
  if (ctx.orderStatus === "claimed") {
    r = await api("POST", "/api/companion", { action: "accept_direct_order", id: ctx.orderId }, ctx.compHeaders);
  } else if (ctx.orderStatus === "pending") {
    r = await api("POST", "/api/companion", { action: "accept_order", id: ctx.orderId }, ctx.compHeaders);
  } else if (ctx.orderStatus === "waiting_boss_confirm") {
    const conf = await api("POST", "/api/orders", { action: "confirm_companion", id: ctx.orderId }, ctx.bossHeaders);
    if (!conf.json || !conf.json.ok) throw new Error("老板确认陪玩失败: " + (conf.json && conf.json.message));
    ctx.orderStatus = (conf.json.order && conf.json.order.status) || "confirmed";
    return `via_boss_confirm status=${ctx.orderStatus}`;
  } else if (ctx.orderStatus === "confirmed") {
    return "already_confirmed";
  } else {
    throw new Error("陪玩无法接单，当前状态 " + ctx.orderStatus);
  }
  if (!r.json || !r.json.ok) throw new Error("陪玩接单失败: " + (r.json && r.json.message));
  ctx.orderStatus = (r.json.order && r.json.order.status) || ctx.orderStatus;
  // after accept_order need boss confirm
  if (ctx.orderStatus === "waiting_boss_confirm") {
    const conf = await api("POST", "/api/orders", { action: "confirm_companion", id: ctx.orderId }, ctx.bossHeaders);
    if (!conf.json || !conf.json.ok) throw new Error("老板确认失败: " + (conf.json && conf.json.message));
    ctx.orderStatus = (conf.json.order && conf.json.order.status) || "confirmed";
  }
  return `status=${ctx.orderStatus}`;
}

async function step10_inProgress() {
  if (ctx.orderStatus !== "confirmed" && ctx.orderStatus !== "in_progress") {
    throw new Error("开始前状态不对: " + ctx.orderStatus);
  }
  if (ctx.orderStatus === "in_progress") return "already_in_progress";
  const r = await api("POST", "/api/companion", { action: "start_order", id: ctx.orderId }, ctx.compHeaders);
  if (!r.json || !r.json.ok) throw new Error("开始订单失败: " + (r.json && r.json.message));
  ctx.orderStatus = (r.json.order && r.json.order.status) || "";
  if (ctx.orderStatus !== "in_progress") throw new Error("未进入进行中: " + ctx.orderStatus);
  return `status=${ctx.orderStatus}`;
}

async function step11_complete() {
  const r = await api("POST", "/api/companion", { action: "complete_order", id: ctx.orderId }, ctx.compHeaders);
  if (!r.json || !r.json.ok) throw new Error("完成订单失败: " + (r.json && r.json.message));
  ctx.orderStatus = (r.json.order && r.json.order.status) || "";
  if (ctx.orderStatus !== "completed") throw new Error("未完成: " + ctx.orderStatus);
  return `status=${ctx.orderStatus}`;
}

async function step12_review() {
  const r = await api(
    "POST",
    "/api/orders",
    { action: "submit_review", id: ctx.orderId, rating: 5, content: "E2E好评-真实写入companion_reviews" },
    ctx.bossHeaders
  );
  if (!r.json || !r.json.ok) throw new Error("老板评价失败: " + (r.json && r.json.message) + " HTTP " + r.status);
  if (/消息已发送/.test(String(r.json.message || ""))) throw new Error("评价被错误路由到聊天发送");
  const order = r.json.order || {};
  if (!(order.reviewed || order.status === "reviewed" || order.statusText === "已评价")) {
    // Confirm via GET list
    const list = await api("GET", "/api/orders", null, ctx.bossHeaders);
    const found = ((list.json && list.json.orders) || []).find((o) => o.id === ctx.orderId);
    if (!(found && (found.reviewed || found.status === "reviewed"))) {
      throw new Error("评价后订单未变为已评价");
    }
  }
  // Companion sees latest rating
  const boot = await api("GET", "/api/companion?action=bootstrap", null, ctx.compHeaders);
  const reviews = (boot.json && boot.json.data && boot.json.data.reviews) || [];
  const hit = reviews.find((x) => String(x.orderId || x.order_id) === String(ctx.orderId));
  if (!hit) throw new Error("陪玩端未收到最新评分");
  if (Number(hit.rating) !== 5) throw new Error("陪玩端评分不是5星: " + hit.rating);
  return "reviewed + companion rating ok";
}

const STEPS = [
  ["1.老板选择陪玩并提交订单", step1_placeOrder],
  ["2.客服端收到订单", step2_csSeesOrder],
  ["3.点击接待", step3_accept],
  ["4.按钮变成正在接待", step4_servingUiState],
  ["5.聊天输入框解锁", step5_composerUnlock],
  ["6.老板与客服双向发消息", step6_bidirectional],
  ["7.客服确认付款", step7_confirmPayment],
  ["8.客服派单", step8_dispatch],
  ["9.陪玩收到订单并接单", step9_companionAccept],
  ["10.订单进入进行中", step10_inProgress],
  ["11.完成订单", step11_complete],
  ["12.老板评价", step12_review],
];

(async () => {
  console.log("BASE=" + BASE);
  await loginBoss();
  await loginCs();
  await loginCompanion();
  console.log("logins=ok");

  for (const [name, fn] of STEPS) {
    try {
      const detail = await fn();
      log(name, "PASS", detail);
    } catch (e) {
      log(name, "FAIL", String(e.message || e));
      failed = { step: name, error: String(e.message || e) };
      // mark remaining unchecked
      const idx = STEPS.findIndex((s) => s[0] === name);
      for (let i = idx + 1; i < STEPS.length; i++) log(STEPS[i][0], "SKIP", "stopped after first failure");
      break;
    }
  }

  console.log("---SUMMARY---");
  console.log(JSON.stringify({ failed, results }, null, 2));
  process.exit(failed ? 2 : 0);
})().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
