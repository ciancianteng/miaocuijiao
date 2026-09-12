/**
 * Cross-boss isolation: Boss A data must not be readable by Boss B JWT.
 * Usage: node scripts/_p0-cross-boss-isolation.mjs
 */
const BASE = "https://meow-cuijiao-homepage-staging.vercel.app";
const PASS = "McjTest@12345678";

async function login(email) {
  const res = await fetch(`${BASE}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ action: "login", email, password: PASS }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.ok || !body.session?.accessToken) {
    throw new Error(`login ${email}: ${body.message || res.status}`);
  }
  return { ...body.session, email, profileId: body.profile?.id || body.session?.user?.id || "" };
}

async function registerBoss(email) {
  const res = await fetch(`${BASE}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      action: "register",
      email,
      password: PASS,
      displayName: "ISO-B",
      role: "boss",
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.ok && body.ok && body.session?.accessToken) {
    return { ...body.session, email, profileId: body.profile?.id || "" };
  }
  throw new Error(`register ${email}: ${body.message || res.status}`);
}

async function api(token, path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method || "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

const bossA = await login("boss.final.1785714993009@meow.test");
const emailB = `boss.iso.${Date.now()}@meow.test`;
const bossB = await registerBoss(emailB);

let ordersA = await api(bossA.accessToken, "/api/orders");
let chatsA = await api(bossA.accessToken, "/api/chat?action=conversations");
let orderList = ordersA.body.orders || ordersA.body.items || [];
let convList = chatsA.body.conversations || chatsA.body.items || [];

// Ensure A has at least one conversation (general support)
if (!convList.length) {
  const open = await api(bossA.accessToken, "/api/chat", {
    method: "POST",
    body: { action: "open", message: "isolation probe A" },
  });
  if (open.body?.conversation?.id) {
    convList = [open.body.conversation];
  } else {
    // retry list
    chatsA = await api(bossA.accessToken, "/api/chat?action=conversations");
    convList = chatsA.body.conversations || chatsA.body.items || [];
  }
}

// If still no orders, create a minimal order if API allows
if (!orderList.length) {
  const create = await api(bossA.accessToken, "/api/orders", {
    method: "POST",
    body: {
      action: "create",
      game: "apex",
      title: "ISO probe order",
      hours: 1,
      unitPrice: 1,
      totalAmount: 1,
    },
  });
  if (create.body?.order?.id) {
    orderList = [create.body.order];
  } else {
    ordersA = await api(bossA.accessToken, "/api/orders");
    orderList = ordersA.body.orders || ordersA.body.items || [];
  }
}

const foreignOrderId = orderList[0]?.id || "";
const foreignConvId = convList[0]?.id || convList[0]?.conversationId || "";

const ownB = await api(bossB.accessToken, "/api/orders");
const ownBChats = await api(bossB.accessToken, "/api/chat?action=conversations");
const bOrders = ownB.body.orders || ownB.body.items || [];
const bConvs = ownBChats.body.conversations || ownBChats.body.items || [];

const aOrderIds = new Set(orderList.map((o) => o.id));
const aConvIds = new Set(convList.map((c) => c.id || c.conversationId));
const leakOrders = bOrders.some((o) => aOrderIds.has(o.id));
const leakConvs = bConvs.some((c) => aConvIds.has(c.id || c.conversationId));

let crossOrder = { status: null, body: {} };
let crossConv = { status: null, body: {} };
if (foreignOrderId) {
  crossOrder = await api(bossB.accessToken, `/api/orders?id=${encodeURIComponent(foreignOrderId)}`);
}
if (foreignConvId) {
  crossConv = await api(
    bossB.accessToken,
    `/api/chat?action=messages&conversation_id=${encodeURIComponent(foreignConvId)}`
  );
}

const orderForbidden =
  !foreignOrderId ||
  crossOrder.status === 403 ||
  (crossOrder.body?.ok === false && /无权限|403|FORBIDDEN/i.test(JSON.stringify(crossOrder.body)));
const convForbidden =
  !foreignConvId ||
  crossConv.status === 403 ||
  (crossConv.body?.ok === false && /无权限|403|FORBIDDEN/i.test(JSON.stringify(crossConv.body)));
const noOrderLeak =
  !(crossOrder.body?.orders || []).length &&
  !crossOrder.body?.order &&
  !(Array.isArray(crossOrder.body?.items) && crossOrder.body.items.length);
const noConvLeak = !(crossConv.body?.messages || []).length && !crossConv.body?.conversation;

const passD = ownB.status === 200 && !leakOrders && !leakConvs;
const passE =
  (foreignOrderId || foreignConvId) &&
  orderForbidden &&
  convForbidden &&
  noOrderLeak &&
  noConvLeak;

console.log(
  JSON.stringify(
    {
      bossA: bossA.email,
      bossB: emailB,
      bossAOrders: orderList.length,
      bossAConvs: convList.length,
      foreignOrderId: foreignOrderId || null,
      foreignConvId: foreignConvId || null,
      crossOrderStatus: crossOrder.status,
      crossOrderMsg: crossOrder.body?.message || null,
      crossConvStatus: crossConv.status,
      crossConvMsg: crossConv.body?.message || null,
      bossBOrders: bOrders.length,
      bossBConvs: bConvs.length,
      leakBossAOrdersIntoB: leakOrders,
      leakBossAConvsIntoB: leakConvs,
      "跨老板数据隔离_D": passD ? "PASS" : "FAIL",
      "URL越权跨老板_E": passE ? "PASS" : "FAIL",
    },
    null,
    2
  )
);

if (!passD || !passE) process.exit(1);
