import { ORDER_STATUS_LABELS } from "../_order-status.js";
const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
const ADMIN_ROLES = new Set(["admin", "super_admin"]);
const ORDER_STATUS_TEXT = { ...ORDER_STATUS_LABELS };
const UI_ACTION_MAP = {
  cancel: "cancel",
  refund: "refund",
  "refund-approve": "refund",
  "assign-service": "assign_service",
  "assign-player": "assign_companion",
  "change-player": "assign_companion",
  "push-hall": "push_hall",
  "confirm-start": "confirm_start",
  "confirm-complete": "confirm_complete",
  "early-end": "confirm_complete",
  update_status: "update_status",
  assign_service: "assign_service",
  assign_companion: "assign_companion",
  confirm_grab_assignment: "confirm_grab_assignment",
  unassign_companion: "unassign_companion",
  cancel_assign: "cancel_assign",
  list_grabs: "list_grabs",
  delete: "delete",
  delete_order: "delete",
};

function json(res, status, data) {
  return res.status(status).json(data);
}
function hasDb() {
  return REQUIRED_ENV.every((key) => process.env[key]);
}
function restUrl(table, query = "") {
  return `${process.env.SUPABASE_URL}/rest/v1/${table}${query}`;
}
function authUrl(path) {
  return `${process.env.SUPABASE_URL}/auth/v1/${path}`;
}
function serviceHeaders(extra = {}) {
  return {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
    ...extra,
  };
}
function anonHeaders(extra = {}) {
  return { apikey: process.env.SUPABASE_ANON_KEY, "Content-Type": "application/json", ...extra };
}
function supabaseError(body, response) {
  const parts = [body?.error_description, body?.msg, body?.message, body?.error, body?.hint, body?.details, typeof body === "string" ? body : ""].filter(Boolean);
  const base = parts[0] || "Supabase 请求失败";
  const code = body?.code ? ` [${body.code}]` : "";
  return `${base}${code} (HTTP ${response.status})`;
}
async function supabaseJson(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) throw Object.assign(new Error(supabaseError(body, response)), { status: response.status });
  return body;
}
async function parseBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    return {};
  }
}
function tokenFrom(req) {
  return String(req.headers.authorization || req.headers["x-mcj-access-token"] || "").replace(/^Bearer\s+/i, "").trim();
}
async function requireAdmin(req) {
  const token = tokenFrom(req);
  if (!token) throw Object.assign(new Error("请先使用管理员账号登录后台。"), { status: 401 });
  const user = await supabaseJson(authUrl("user"), { headers: anonHeaders({ Authorization: `Bearer ${token}` }) });
  const rows = await supabaseJson(restUrl("profiles", `?id=eq.${encodeURIComponent(user.id)}&limit=1`), { headers: serviceHeaders() });
  const profile = rows[0];
  if (!profile || !ADMIN_ROLES.has(profile.role)) throw Object.assign(new Error("无权访问后台。"), { status: 403 });
  if (profile.status !== "active") throw Object.assign(new Error("管理员账号已停用。"), { status: 403 });
  return profile;
}
function money(v) {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
function safeOrder(row, profiles, extras = {}) {
  const boss = profiles[row.boss_id] || {};
  const companion = profiles[row.companion_id] || {};
  const service = profiles[row.customer_service_id] || {};
  const status = row.status || "";
  const statusText = ORDER_STATUS_TEXT[status] || status || "-";
  const paid = !["awaiting_payment", "cancelled"].includes(status);
  const flowStatus =
    extras.flowStatus ||
    ({
      awaiting_payment: "draft",
      pending: "pending_grab",
      waiting_boss_confirm: "selecting",
      claimed: "pending_companion_confirm",
      confirmed: "confirmed",
      in_progress: "in_progress",
      completed: "completed",
      cancelled: "cancelled",
    }[status] || status);
  return {
    id: row.id || row.uuid || "",
    orderNo: row.order_no || row.orderNo || row.id || row.uuid || "",
    bossId: row.boss_id || "",
    bossUid: boss.boss_uid || "",
    bossName: boss.display_name || boss.email || boss.boss_uid || "-",
    playerName: companion.display_name || companion.email || "待分配",
    companionName: companion.display_name || companion.email || "-",
    playerUid: companion.boss_uid || companion.id || "-",
    serviceStaff: service.display_name || service.email || "-",
    serviceName: service.display_name || service.email || "-",
    game: row.game || "",
    serviceContent: row.service_name || row.title || row.description || "-",
    amount: money(row.total_amount),
    totalAmount: money(row.total_amount),
    paymentStatus: paid ? "已支付" : "未支付",
    orderStatus: statusText,
    status,
    flowStatus,
    statusText,
    grabCount: Number(extras.grabCount != null ? extras.grabCount : 0) || 0,
    grabs: extras.grabs || [],
    bossIntent: extras.bossIntent || null,
    preferredCompanionId: extras.bossIntent?.companionId || "",
    createdAt: row.created_at || "",
    serviceTime: row.scheduled_at || row.started_at || "-",
    description: row.description || "",
    orderType: row.order_type || "普通陪玩订单",
    type: row.order_type || "普通陪玩订单",
    companion_id: row.companion_id || "",
    customer_service_id: row.customer_service_id || "",
  };
}
async function addSystem(order, adminId, text) {
  try {
    const rows = await supabaseJson(restUrl("conversations", `?order_id=eq.${encodeURIComponent(order.id)}&limit=1`), { headers: serviceHeaders() });
    const conv = rows[0];
    if (!conv) return;
    await supabaseJson(restUrl("messages"), {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify({
        conversation_id: conv.id,
        sender_id: adminId,
        sender_role: "admin",
        message_type: "system",
        content: text,
        order_id: order.id,
        created_at: new Date().toISOString(),
      }),
    });
  } catch {}
}

async function logAdminOp(admin, action, targetId, beforeValue, afterValue, reason = "") {
  try {
    await supabaseJson(restUrl("admin_operation_logs"), {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify({
        admin_id: admin?.id || null,
        admin_role: admin?.role || "admin",
        action,
        target_type: "order",
        target_id: targetId,
        before_value: beforeValue || null,
        after_value: afterValue || null,
        reason: reason || "",
        created_at: new Date().toISOString(),
      }),
    });
  } catch {}
}

function isTestOrder(order = {}) {
  const blob = [order.order_no, order.title, order.description, order.note, order.order_type]
    .map((v) => String(v || ""))
    .join(" ");
  return !!order.is_test || /test|测试|MCJ_TEST|fake|demo/i.test(blob);
}

async function hardDeleteOrder(order) {
  const id = order.id;
  const convs = await supabaseJson(
    restUrl("conversations", `?order_id=eq.${encodeURIComponent(id)}&select=id`),
    { headers: serviceHeaders() }
  ).catch(() => []);
  const convIds = (Array.isArray(convs) ? convs : []).map((c) => c.id).filter(Boolean);
  if (convIds.length) {
    await supabaseJson(
      restUrl("messages", `?conversation_id=in.(${convIds.map(encodeURIComponent).join(",")})`),
      { method: "DELETE", headers: serviceHeaders({ Prefer: "return=minimal" }) }
    ).catch(() => null);
    await supabaseJson(
      restUrl("conversations", `?order_id=eq.${encodeURIComponent(id)}`),
      { method: "DELETE", headers: serviceHeaders({ Prefer: "return=minimal" }) }
    ).catch(() => null);
  }
  await supabaseJson(
    restUrl("order_grabs", `?order_id=eq.${encodeURIComponent(id)}`),
    { method: "DELETE", headers: serviceHeaders({ Prefer: "return=minimal" }) }
  ).catch(() => null);
  await supabaseJson(
    restUrl("companion_reviews", `?order_id=eq.${encodeURIComponent(id)}`),
    { method: "DELETE", headers: serviceHeaders({ Prefer: "return=minimal" }) }
  ).catch(() => null);
  await supabaseJson(restUrl("orders", `?id=eq.${encodeURIComponent(id)}`), {
    method: "DELETE",
    headers: serviceHeaders({ Prefer: "return=minimal" }),
  });
}

export default async function handler(req, res) {
  if (!hasDb()) {
    return json(res, req.method === "GET" ? 200 : 503, {
      ok: req.method === "GET",
      configured: false,
      orders: [],
      reviews: [],
      message: "未配置 Supabase，后台订单不返回假数据。",
      orderStatuses: ORDER_STATUS_TEXT,
    });
  }
  try {
    const admin = await requireAdmin(req);
    if (req.method === "GET") {
      const action = String(req.query?.action || "").trim();
      if (action === "reviews") {
        const reviewsRaw = await supabaseJson(restUrl("companion_reviews", "?order=created_at.desc&limit=300"), { headers: serviceHeaders() }).catch(() => []);
        const reviews = Array.isArray(reviewsRaw) ? reviewsRaw : [];
        const ids = [...new Set(reviews.flatMap((r) => [r.boss_id, r.companion_id]).filter(Boolean))];
        const profiles = ids.length
          ? await supabaseJson(restUrl("profiles", `?id=in.(${ids.map(encodeURIComponent).join(",")})&select=id,display_name,email,boss_uid`), { headers: serviceHeaders() }).catch(() => [])
          : [];
        const map = (profiles || []).reduce((m, p) => {
          m[p.id] = p;
          return m;
        }, {});
        return json(res, 200, {
          ok: true,
          configured: true,
          reviews: reviews.map((r) => ({
            id: r.id,
            order_id: r.order_id || "",
            user_id: r.boss_id || "",
            player_id: r.companion_id || "",
            player: (map[r.companion_id] && (map[r.companion_id].display_name || map[r.companion_id].email)) || "-",
            boss: (map[r.boss_id] && (map[r.boss_id].display_name || map[r.boss_id].boss_uid || map[r.boss_id].email)) || "-",
            rating: String(r.rating || ""),
            content: r.content || "",
            status: r.status === "published" ? "显示中" : r.status || "显示中",
            createdAt: r.created_at || "",
          })),
        });
      }
      if (req.query?.id) {
        const id = String(req.query.id);
        const rows = await supabaseJson(restUrl("orders", `?id=eq.${encodeURIComponent(id)}&limit=1`), { headers: serviceHeaders() });
        const order = rows?.[0];
        if (!order) return json(res, 404, { ok: false, message: "订单不存在。" });
        const ids = [order.boss_id, order.companion_id, order.customer_service_id].filter(Boolean);
        const profiles = ids.length
          ? await supabaseJson(restUrl("profiles", `?id=in.(${ids.map(encodeURIComponent).join(",")})`), { headers: serviceHeaders() }).catch(() => [])
          : [];
        const map = (profiles || []).reduce((m, p) => {
          m[p.id] = p;
          return m;
        }, {});
        return json(res, 200, { ok: true, configured: true, order: safeOrder(order, map) });
      }
      const [orders, profiles] = await Promise.all([
        supabaseJson(restUrl("orders", "?order=created_at.desc&limit=500"), { headers: serviceHeaders() }).catch(() => []),
        supabaseJson(restUrl("profiles", "?limit=1000"), { headers: serviceHeaders() }).catch(() => []),
      ]);
      const map = (profiles || []).reduce((m, p) => {
        m[p.id] = p;
        return m;
      }, {});
      const { createOrderGrabHelpers } = await import("../_order-grabs.js");
      const { parseBossIntent, toFlowStatus } = await import("../_order-flow.js");
      const grabsApi = createOrderGrabHelpers({ restUrl, supabaseJson, serviceHeaders });
      const list = await Promise.all(
        (orders || []).slice(0, 200).map(async (o) => {
          let grabCount = 0;
          let bossIntent = null;
          try {
            if (["pending", "waiting_boss_confirm", "claimed", "confirmed"].includes(o.status)) {
              const grabs = await grabsApi.listGrabs(o.id, o.note || o.description || "");
              grabCount = grabs.length;
            }
            bossIntent = parseBossIntent(o);
          } catch {
            /* ignore */
          }
          return safeOrder(o, map, {
            grabCount,
            bossIntent,
            flowStatus: toFlowStatus(o.status),
          });
        })
      );
      const summary = {
        total: list.length,
        todayOrders: 0,
        pendingPayment: list.filter((x) => x.status === "awaiting_payment").length,
        pendingAccept: list.filter((x) => x.status === "pending" || x.status === "claimed").length,
        inProgress: list.filter((x) => x.status === "in_progress").length,
        completed: list.filter((x) => x.status === "completed").length,
        afterSale: list.filter((x) => x.status === "refund_requested").length,
        revenue: list.reduce((n, x) => {
          if (x.status === "awaiting_payment" || x.status === "cancelled") return n;
          return n + x.amount;
        }, 0),
        profit: 0,
      };
      return json(res, 200, { ok: true, configured: true, orders: list, summary, orderStatuses: ORDER_STATUS_TEXT });
    }

    if (req.method !== "POST") return json(res, 405, { ok: false, message: "Method Not Allowed" });
    const body = await parseBody(req);
    const id = String(body.id || body.order_id || body.orderId || body.uuid || "").trim();
    const rawAction = String(body.action || "");
    const action = UI_ACTION_MAP[rawAction] || rawAction;
    const payload = body.payload && typeof body.payload === "object" ? body.payload : {};

    if (!id || id === "undefined" || id === "null") {
      return json(res, 400, { ok: false, message: "缺少订单 id（请刷新列表后重试）" });
    }
    if (action === "list_grabs" || action === "grab_applicants") {
      const rows0 = await supabaseJson(restUrl("orders", `?id=eq.${encodeURIComponent(id)}&limit=1`), { headers: serviceHeaders() });
      const order = rows0[0];
      if (!order) return json(res, 404, { ok: false, message: "订单不存在。" });
      const { createOrderGrabHelpers } = await import("../_order-grabs.js");
      const { enrichGrabCompanions, parseBossIntent } = await import("../_order-flow.js");
      const grabsApi = createOrderGrabHelpers({ restUrl, supabaseJson, serviceHeaders });
      const grabs = await grabsApi.listGrabs(order.id, order.note || order.description || "");
      const intent = parseBossIntent(order);
      const enriched = await enrichGrabCompanions({ restUrl, supabaseJson, serviceHeaders }, grabs);
      const ids = [order.boss_id, order.companion_id, order.customer_service_id].filter(Boolean);
      const profiles = ids.length
        ? await supabaseJson(restUrl("profiles", `?id=in.(${ids.map(encodeURIComponent).join(",")})`), { headers: serviceHeaders() }).catch(() => [])
        : [];
      const map = (profiles || []).reduce((m, p) => {
        m[p.id] = p;
        return m;
      }, {});
      return json(res, 200, {
        ok: true,
        grabCount: enriched.length,
        bossIntent: intent,
        grabs: enriched.map((g) => ({
          ...g,
          bossPreferred: !!(intent && intent.companionId === g.companionId),
          companion: g.companion
            ? { ...g.companion, bossPreferred: !!(intent && intent.companionId === g.companionId) }
            : null,
        })),
        order: safeOrder(order, map, { grabCount: enriched.length, grabs: enriched, bossIntent: intent }),
      });
    }

    const rows = await supabaseJson(restUrl("orders", `?id=eq.${encodeURIComponent(id)}&limit=1`), { headers: serviceHeaders() });
    const before = rows[0];
    if (!before) return json(res, 404, { ok: false, message: "订单不存在。" });

    let patch = {};
    if (action === "delete") {
      const test = isTestOrder(before);
      await hardDeleteOrder(before);
      await logAdminOp(
        admin,
        "delete_order",
        id,
        {
          order_no: before.order_no,
          status: before.status,
          amount: before.total_amount,
          boss_id: before.boss_id,
          companion_id: before.companion_id,
          is_test: test,
        },
        { deleted: true },
        String(payload.reason || body.reason || (test ? "测试订单彻底删除" : "管理员永久删除订单"))
      );
      return json(res, 200, {
        ok: true,
        message: test ? "测试订单已彻底删除。" : "订单已永久删除（已记日志）。",
        deleted: true,
        isTest: test,
      });
    } else if (action === "update_status") {
      patch.status = String(body.status || payload.status || "");
    } else if (action === "assign_service") {
      patch.customer_service_id = String(body.customer_service_id || payload.customer_service_id || payload.service_id || "") || null;
    } else if (action === "assign_companion" || action === "confirm_grab_assignment") {
      const companionId = String(body.companion_id || payload.companion_id || payload.player_id || "").trim();
      if (!companionId) return json(res, 400, { ok: false, message: "请指定陪玩 ID。" });
      // BOSS_PICK_LOCK
      if (before.companion_id && ["claimed", "confirmed", "in_progress"].includes(before.status)) {
        return json(res, 409, {
          ok: false,
          code: "BOSS_PICK_LOCK",
          message: "老板已选定陪玩，后台不可再次指定。",
        });
      }
      if (before.status === "waiting_boss_confirm") {
        return json(res, 409, {
          ok: false,
          code: "BOSS_MUST_PICK",
          message: "公开抢单请由老板选择陪玩，后台不可代选。",
        });
      }
      const fromGrabs = body.from_grabs === true || body.fromGrabs === true || action === "confirm_grab_assignment";
      if (fromGrabs || ["pending", "waiting_boss_confirm"].includes(before.status)) {
        const { createOrderGrabHelpers } = await import("../_order-grabs.js");
        const grabsApi = createOrderGrabHelpers({ restUrl, supabaseJson, serviceHeaders });
        const grabs = await grabsApi.listGrabs(before.id, before.note || before.description || "");
        if (grabs.length) {
          const hit = grabs.find((g) => g.companionId === companionId);
          if (!hit) return json(res, 409, { ok: false, message: "只能从已抢单陪玩中指定。" });
          await grabsApi.finalizeGrabSelection(before, companionId);
        }
      }
      patch.companion_id = companionId;
      // Align with CS push: paid → claimed (waiting companion confirm); unpaid stay awaiting_payment.
      patch.status = before.status === "awaiting_payment" ? "awaiting_payment" : "claimed";
      patch.accepted_at = null;
    } else if (action === "unassign_companion" || action === "cancel_assign") {
      if (["in_progress", "completed"].includes(before.status)) {
        return json(res, 409, { ok: false, message: "订单已开始，不能取消指定。" });
      }
      patch.companion_id = null;
      patch.status = before.status === "awaiting_payment" ? "awaiting_payment" : "pending";
      patch.accepted_at = null;
    } else if (action === "push_hall") {
      patch.companion_id = null;
      patch.status = before.status === "awaiting_payment" ? "awaiting_payment" : "pending";
    } else if (action === "confirm_start") {
      patch.status = "in_progress";
      patch.started_at = new Date().toISOString();
    } else if (action === "confirm_complete") {
      patch.status = "completed";
      patch.completed_at = new Date().toISOString();
    } else if (action === "cancel") {
      patch.status = "cancelled";
      patch.cancelled_at = new Date().toISOString();
    } else if (action === "refund") {
      patch.status = "refunded";
    } else if (action === "update_status") {
      // fallthrough uses patch.status already set above — validate graph
    } else {
      return json(res, 400, { ok: false, message: `未知订单操作：${rawAction}` });
    }

    if (!Object.keys(patch).length) return json(res, 400, { ok: false, message: "未知订单操作。" });
    if (patch.status && patch.status !== before.status && (action === "update_status" || action === "cancel" || action === "refund" || action === "confirm_start" || action === "confirm_complete" || action === "push_hall" || action === "assign_companion" || action === "confirm_grab_assignment" || action === "unassign_companion" || action === "cancel_assign")) {
      try {
        const { assertCsStatusTransition, writeOrderStatusLog } = await import("../_order-status.js");
        if (action === "update_status") assertCsStatusTransition(before.status, patch.status);
        await writeOrderStatusLog(
          { restUrl, supabaseJson, serviceHeaders },
          {
            orderId: id,
            fromStatus: before.status,
            toStatus: patch.status,
            operatorRole: "admin",
            operatorId: admin.id,
            note: String(payload.reason || body.reason || action),
          }
        );
      } catch (err) {
        if (action === "update_status") return json(res, err.status || 400, { ok: false, message: err.message || "非法状态跳转。" });
      }
    }
    const updated = await supabaseJson(restUrl("orders", `?id=eq.${encodeURIComponent(id)}`), {
      method: "PATCH",
      headers: serviceHeaders(),
      body: JSON.stringify(patch),
    });
    const after = updated[0] || { ...before, ...patch };
    const ids = [after.boss_id, after.companion_id, after.customer_service_id].filter(Boolean);
    const profiles = ids.length
      ? await supabaseJson(restUrl("profiles", `?id=in.(${ids.map(encodeURIComponent).join(",")})`), { headers: serviceHeaders() }).catch(() => [])
      : [];
    const map = (profiles || []).reduce((m, p) => {
      m[p.id] = p;
      return m;
    }, {});
    if (action === "assign_companion") {
      const name = map[after.companion_id]?.display_name || map[after.companion_id]?.email || "陪玩";
      await addSystem(after, admin.id, `已推送陪玩：${name}，请陪玩尽快接单`);
      await logAdminOp(admin, action, id, { status: before.status }, { status: after.status, ...patch }, String(payload.reason || ""));
      return json(res, 200, { ok: true, message: "指定成功", order: safeOrder(after, map) });
    }
    await addSystem(after, admin.id, `后台更新订单：${ORDER_STATUS_TEXT[patch.status] || patch.status || action}`);
    await logAdminOp(admin, action, id, { status: before.status }, { status: after.status, ...patch }, String(payload.reason || ""));
    return json(res, 200, { ok: true, message: "订单已更新。", order: safeOrder(after, map) });
  } catch (error) {
    return json(res, error.status || 500, { ok: false, message: error.message || "后台订单接口异常。" });
  }
}
