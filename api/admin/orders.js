const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const TABLE = "orders";
const LOG_TABLE = "admin_operation_logs";
const ADMIN_ROLES = new Set(["super_admin", "admin", "order_admin", "finance_admin", "customer_service"]);
const ORDER_STATUSES = ["待支付", "待接单", "待老板确认陪玩", "待开始", "进行中", "待确认完成", "已完成", "已取消", "售后处理中", "退款处理中", "已退款", "异常订单"];
const PAYMENT_STATUSES = ["未支付", "支付中", "已支付", "支付失败", "部分退款", "已退款"];
const ORDER_TYPES = ["普通陪玩订单", "更多玩法固定单", "自定义订单", "护航订单", "跑刀订单", "代肝订单", "趣味订单", "客服创建订单"];
const ORDER_SOURCES = ["平台直营", "合作俱乐部", "推广渠道", "客服创建", "老板自助下单"];

function json(res, status, data) {
  res.status(status).json(data);
}

function roleFrom(req) {
  return String(req.headers["x-mcj-admin-role"] || req.headers["x-user-role"] || "").trim();
}

function hasDatabaseConfig() {
  return REQUIRED_ENV.every((key) => process.env[key]);
}

function headers() {
  return {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=representation"
  };
}

function endpoint(path = "") {
  return `${process.env.SUPABASE_URL}/rest/v1/${TABLE}${path}`;
}

function money(value) {
  const n = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function computeOrder(row = {}) {
  const paid = money(row.actual_paid_amount ?? row.paid_amount ?? row.amount);
  const commissionRate = Number(row.player_commission_rate ?? 80);
  const playerIncome = money(row.player_income) || paid * (Number.isFinite(commissionRate) ? commissionRate : 80) / 100;
  const rebate = money(row.direct_rebate);
  const refund = money(row.refund_amount);
  const platformProfit = money(row.platform_profit) || Math.max(0, paid - playerIncome - rebate - refund);
  return {
    ...row,
    amount: paid,
    player_income: playerIncome,
    platform_profit: platformProfit,
    order_status: row.order_status || row.status || "待支付",
    payment_status: row.payment_status || "未支付",
    order_type: row.order_type || "普通陪玩订单",
    order_source: row.order_source || "平台直营"
  };
}

async function supabaseFetch(path, init = {}) {
  const response = await fetch(endpoint(path), { ...init, headers: { ...headers(), ...(init.headers || {}) } });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) throw new Error(body?.message || body?.hint || body?.details || "订单数据库请求失败");
  return body;
}

async function logAction(req, action, orderId, beforeValue, afterValue, reason) {
  try {
    await fetch(`${process.env.SUPABASE_URL}/rest/v1/${LOG_TABLE}`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        module: "orders",
        action,
        target_type: "order",
        target_id: orderId,
        operator_role: roleFrom(req),
        before_value: beforeValue || null,
        after_value: afterValue || null,
        reason: reason || "",
        created_at: new Date().toISOString()
      })
    });
  } catch {}
}

function summary(rows) {
  const now = new Date().toISOString().slice(0, 10);
  const today = rows.filter((row) => String(row.created_at || row.createdAt || "").slice(0, 10) === now);
  return {
    total: rows.length,
    todayOrders: today.length,
    pendingPayment: rows.filter((x) => x.order_status === "待支付").length,
    pendingAccept: rows.filter((x) => x.order_status === "待接单").length,
    inProgress: rows.filter((x) => x.order_status === "进行中").length,
    completed: rows.filter((x) => x.order_status === "已完成").length,
    afterSale: rows.filter((x) => x.order_status === "售后处理中").length,
    revenue: today.reduce((n, x) => n + money(x.amount), 0),
    profit: today.reduce((n, x) => n + money(x.platform_profit), 0)
  };
}

export default async function handler(req, res) {
  const role = roleFrom(req);
  if (!ADMIN_ROLES.has(role)) return json(res, 403, { ok: false, message: "没有订单管理权限" });

  if (req.method === "GET") {
    if (!hasDatabaseConfig()) {
      return json(res, 200, {
        ok: true,
        configured: false,
        orders: [],
        summary: summary([]),
        message: "真实订单数据库未配置，未返回任何模拟订单",
        enums: { orderStatuses: ORDER_STATUSES, paymentStatuses: PAYMENT_STATUSES, orderTypes: ORDER_TYPES, orderSources: ORDER_SOURCES },
        requiredTable: TABLE
      });
    }
    const id = String(req.query.id || "");
    const query = id
      ? `?id=eq.${encodeURIComponent(id)}&limit=1`
      : "?order=created_at.desc&limit=100";
    const rows = await supabaseFetch(query);
    const orders = (Array.isArray(rows) ? rows : []).map(computeOrder);
    if (id) return json(res, 200, { ok: true, configured: true, order: orders[0] || null });
    return json(res, 200, { ok: true, configured: true, orders, summary: summary(orders), enums: { orderStatuses: ORDER_STATUSES, paymentStatuses: PAYMENT_STATUSES, orderTypes: ORDER_TYPES, orderSources: ORDER_SOURCES } });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return json(res, 405, { ok: false, message: "Method Not Allowed" });
  }

  const action = String(req.body?.action || "");
  const id = String(req.body?.id || "");
  const reason = String(req.body?.payload?.reason || "");
  const risky = /cancel|refund|early-end|confirm-complete|return-service|compensate|reject|approve|partial/.test(action);
  if (risky && !reason.trim()) return json(res, 400, { ok: false, message: "危险订单操作必须填写原因" });
  if (action === "create-test-order" && process.env.VERCEL_ENV === "production") {
    return json(res, 403, { ok: false, message: "正式环境禁止创建测试订单" });
  }
  if (!hasDatabaseConfig()) {
    return json(res, 503, { ok: false, message: "真实订单数据库未配置，订单操作未保存" });
  }

  if (action === "export") {
    await logAction(req, "export", "all", null, null, reason);
    return json(res, 200, { ok: true, message: "已记录导出请求，请接入导出任务队列" });
  }
  if (action === "service-create") {
    return json(res, 501, { ok: false, message: "客服创建订单需要接入统一建单流程和支付流程" });
  }
  if (!id) return json(res, 400, { ok: false, message: "缺少订单号" });

  const beforeRows = await supabaseFetch(`?id=eq.${encodeURIComponent(id)}&limit=1`);
  const before = Array.isArray(beforeRows) ? beforeRows[0] : null;
  if (!before) return json(res, 404, { ok: false, message: "订单不存在" });

  const patch = { updated_at: new Date().toISOString(), last_admin_action: action, last_admin_reason: reason };
  const statusMap = {
    cancel: "已取消",
    "confirm-start": "进行中",
    "early-end": "待确认完成",
    "confirm-complete": "已完成",
    "after-sale": "售后处理中",
    "refund-approve": "已退款",
    "partial-refund": "退款处理中"
  };
  if (statusMap[action]) patch.order_status = statusMap[action];
  const rows = await supabaseFetch(`?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });
  await logAction(req, action, id, before, rows?.[0] || patch, reason);
  return json(res, 200, { ok: true, message: "已提交到真实订单数据库", order: rows?.[0] || patch });
}
