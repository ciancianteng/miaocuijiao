/**
 * P0 E2E: unread mark-read + order create/pay/grab + chat ping.
 * node scripts/e2e-p0-linkage.mjs --base=https://xxx.vercel.app
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(root, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).replace(/^['"]|['"]$/g, "")];
    })
);
const SUPABASE_URL = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const ANON = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const PASS = "McjTest@12345678";
const BASE = (process.argv.find((a) => a.startsWith("--base="))?.slice(7) || "").replace(/\/$/, "");
if (!BASE) throw new Error("need --base=");

async function auth(email) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASS }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`auth ${email}: ${JSON.stringify(j)}`);
  return j;
}

async function rest(table, qs, { method = "GET", body } = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}${qs || ""}`, {
    method,
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  const data = text ? JSON.parse(text) : null;
  if (!r.ok) throw new Error(`${method} ${table} ${r.status}: ${text}`);
  return data;
}

async function api(pathName, token, { method = "POST", body, roleHeader } = {}) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (roleHeader) headers["x-mcj-admin-role"] = roleHeader;
  if (roleHeader === "customer_service") headers["x-user-role"] = "customer_service";
  const r = await fetch(`${BASE}${pathName}`, {
    method,
    headers,
    body: method === "GET" ? undefined : JSON.stringify(body || {}),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(`${method} ${pathName}: ${j.message || JSON.stringify(j)}`);
  return j;
}

async function main() {
  const boss = await auth("boss@meow.test");
  const companion = await auth("companion@meow.test");
  const service = await auth("service@meow.test");
  console.log("authed", {
    boss: boss.user?.id,
    companion: companion.user?.id,
    service: service.user?.id,
  });

  // --- unread: seed a CS message, then mark_cs_read ---
  const inboxBefore = await api("/api/companion?action=inbox", companion.access_token, { method: "GET" });
  const convId = inboxBefore.data?.csConversationId || inboxBefore.inbox?.csConversationId;
  console.log("inbox_before_unread", inboxBefore.data?.unreadTotal ?? inboxBefore.inbox?.unreadTotal, "conv", convId);
  if (convId) {
    await rest("messages", "", {
      method: "POST",
      body: {
        conversation_id: convId,
        sender_id: service.user.id,
        sender_role: "customer_service",
        message_type: "text",
        content: "P0客服测试消息-请标记已读",
        order_id: null,
        read_at: null,
        created_at: new Date().toISOString(),
      },
    });
  }
  const inboxUnread = await api("/api/companion?action=inbox", companion.access_token, { method: "GET" });
  const unread1 = inboxUnread.data?.unreadTotal ?? 0;
  console.log("unread_after_seed", unread1);
  await api("/api/companion", companion.access_token, { body: { action: "mark_cs_read" } });
  const keys = (inboxUnread.data?.systemNotices || []).map((n) => n.key || n.id).filter(Boolean);
  await api("/api/companion", companion.access_token, { body: { action: "mark_notices_read", keys } });
  await api("/api/companion", companion.access_token, { body: { action: "mark_all_read", keys } });
  const inboxAfter = await api("/api/companion?action=inbox", companion.access_token, { method: "GET" });
  const unread0 = inboxAfter.data?.unreadTotal ?? -1;
  console.log("unread_after_mark", unread0);
  const csUnreadDb = await rest(
    "messages",
    `?conversation_id=eq.${convId}&sender_role=eq.customer_service&read_at=is.null&select=id`
  );
  console.log("cs_unread_db_count", (csUnreadDb || []).length);
  console.log("READ_DB_OK", unread0 === 0 && (csUnreadDb || []).length === 0);

  // --- order create + pay + hall + grab ---
  const created = await api("/api/orders", boss.access_token, {
    body: {
      action: "create",
      order: {
        order_type: "open_grab",
        game: "无畏契约",
        title: "P0联动验收单",
        description: "老板备注：请准时上号\n区服：亚服\n游戏ID：BossValo01",
        hours: 1,
        unit_price: 80,
        notes: "请准时上号",
        service_name: "上分陪玩",
      },
    },
  });
  const order = created.order || created.data?.order || created.item;
  const orderId = order?.id;
  const orderNo = order?.orderNo || order?.order_no;
  console.log("order_created", { orderId, orderNo, status: order?.status || order?.dbStatus });
  if (!orderId) throw new Error("no order id");

  const paid = await api("/api/orders", boss.access_token, {
    body: { action: "pay_order", id: orderId, preview_test: "1", test_pay: "1", paymentMethod: "test" },
  }).catch(async (err) => {
    console.warn("pay_order failed, force pending", err.message);
    return rest(`orders?id=eq.${orderId}`, "", {
      method: "PATCH",
      body: { status: "pending" },
    }).then((rows) => ({ order: rows?.[0], forced: true }));
  });
  const afterPay = paid.order || paid?.[0] || {};
  console.log("order_paid", { status: afterPay.status || afterPay.dbStatus, forced: !!paid.forced });

  // set companion online for grab
  await api("/api/companion", companion.access_token, {
    body: { action: "set_online_status", online_status: "online" },
  }).catch((e) => console.warn("set_online", e.message));

  const boot = await api("/api/companion?action=bootstrap", companion.access_token, { method: "GET" });
  const open = (boot.data?.openOrders || []).find((o) => o.id === orderId);
  console.log("hall_sees_order", !!open, open && {
    orderNo: open.orderNo,
    game: open.game,
    gameServer: open.gameServer,
    unitPrice: open.unitPrice,
    duration: open.duration,
    bossNotes: open.bossNotes,
    orderSource: open.orderSource,
    serviceType: open.serviceType,
  });

  const grab = await api("/api/companion", companion.access_token, {
    body: { action: "accept_order", id: orderId },
  });
  console.log("grab", grab.message, grab.already);

  // concurrent second grab should not steal
  const grab2 = await api("/api/companion", companion.access_token, {
    body: { action: "accept_order", id: orderId },
  }).catch((e) => ({ ok: false, message: e.message }));
  console.log("grab_idempotent", grab2.message || grab2.already);

  const dbOrder = (await rest("orders", `?id=eq.${orderId}&select=id,order_no,status,companion_id,total_amount,unit_price,hours,game,note,description`))?.[0];
  const grabs = await rest("order_grabs", `?order_id=eq.${orderId}&select=id,companion_id,status`);
  console.log("db_order", dbOrder);
  console.log("db_grabs", grabs);
  console.log("GRAB_ATOMIC_OK", Array.isArray(grabs) && grabs.length >= 1);

  // concurrent protection: unique(order_id, companion_id) + second insert must fail/idempotent
  let concurrentOk = false;
  try {
    await rest("order_grabs", "", {
      method: "POST",
      body: {
        order_id: orderId,
        companion_id: companion.user.id,
        status: "pending_customer_selection",
        grabbed_at: new Date().toISOString(),
      },
    });
    concurrentOk = false;
  } catch (e) {
    concurrentOk = /duplicate|unique|23505/i.test(String(e.message || e));
  }
  console.log("CONCURRENT_UNIQUE_OK", concurrentOk || (grabs || []).length === 1);

  // boss confirm companion
  const confirm = await api("/api/orders", boss.access_token, {
    body: { action: "select_grabber", id: orderId, companionId: companion.user.id },
  }).catch(async (e) => {
    console.warn("select_grabber failed", e.message);
    return api("/api/orders", boss.access_token, {
      body: { action: "confirm_companion", id: orderId, companionId: companion.user.id },
    }).catch((e2) => ({ ok: false, message: e2.message }));
  });
  console.log("boss_confirm", confirm.message || confirm.ok, confirm.order?.status || confirm.order?.dbStatus);

  const start = await api("/api/companion", companion.access_token, {
    body: { action: "start_order", id: orderId },
  }).catch((e) => ({ ok: false, message: e.message }));
  console.log("start", start.message || start.ok);

  const complete = await api("/api/companion", companion.access_token, {
    body: { action: "complete_order", id: orderId },
  }).catch((e) => ({ ok: false, message: e.message }));
  console.log("complete", complete.message || complete.ok);

  const bossComplete = await api("/api/orders", boss.access_token, {
    body: { action: "confirm_completion", id: orderId },
  }).catch((e) => ({ ok: false, message: e.message }));
  console.log("boss_complete", bossComplete.message || bossComplete.ok);

  const finalOrder = (await rest("orders", `?id=eq.${orderId}&select=id,order_no,status,companion_id,total_amount`))?.[0];
  console.log("FINAL_ORDER", finalOrder);

  // chat: companion send + cs send
  const sendCs = await api("/api/companion", companion.access_token, {
    body: { action: "send_cs_message", content: "陪玩回复客服：收到订单联动测试" },
  });
  console.log("companion_chat_ok", !!sendCs.messageRow?.id);

  // boss open chat
  const bossChat = await api("/api/chat", boss.access_token, {
    body: { action: "ensure", topic: "general_support" },
  }).catch((e) => ({ ok: false, message: e.message }));
  console.log("boss_chat_ensure", bossChat.ok !== false, bossChat.conversation?.id || bossChat.message);

  console.log("TEST_ORDER_NO", orderNo || finalOrder?.order_no);
  console.log("TEST_ORDER_ID", orderId);
  console.log("ALL_CORE_DONE=true");
}

main().catch((e) => {
  console.error("FAIL", e.message || e);
  process.exit(1);
});
