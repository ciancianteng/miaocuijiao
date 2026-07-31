const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];

function nowIso() {
  return new Date().toISOString();
}

function restUrl(table, query = "") {
  return `${process.env.SUPABASE_URL}/rest/v1/${table}${query}`;
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

async function supabaseJson(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    throw new Error(body?.error_description || body?.message || body?.hint || body?.details || "Supabase 请求失败");
  }
  return body;
}

function hasDb() {
  return REQUIRED_ENV.every((key) => process.env[key]);
}

async function tableRows(table, query = "") {
  if (!hasDb()) return [];
  const rows = await supabaseJson(restUrl(table, query), { headers: serviceHeaders() });
  return Array.isArray(rows) ? rows : [];
}

async function maybeRows(table, query = "") {
  try {
    return await tableRows(table, query);
  } catch {
    return [];
  }
}

function durationText(startedAt, endedAt) {
  const start = new Date(startedAt || "").getTime();
  const end = new Date(endedAt || Date.now()).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "-";
  const mins = Math.max(0, Math.round((end - start) / 60000));
  if (mins < 60) return `${mins} 分钟`;
  const hours = Math.floor(mins / 60);
  const remain = mins % 60;
  return remain ? `${hours} 小时 ${remain} 分钟` : `${hours} 小时`;
}

export async function startReceptionRecord(conversation, serviceId) {
  if (!conversation?.id || !serviceId) return null;
  try {
    const active = await maybeRows(
      "service_receptions",
      `?conversation_id=eq.${encodeURIComponent(conversation.id)}&status=eq.active&order=started_at.desc&limit=1`
    );
    if (active[0]?.customer_service_id === serviceId) return active[0];
    if (active[0]) {
      await supabaseJson(restUrl("service_receptions", `?id=eq.${encodeURIComponent(active[0].id)}`), {
        method: "PATCH",
        headers: serviceHeaders(),
        body: JSON.stringify({ status: "completed", ended_at: nowIso() }),
      }).catch(() => null);
    }
    const rows = await supabaseJson(restUrl("service_receptions"), {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify({
        conversation_id: conversation.id,
        boss_id: conversation.boss_id || null,
        customer_service_id: serviceId,
        order_id: conversation.order_id || null,
        status: "active",
        started_at: nowIso(),
        created_at: nowIso(),
      }),
    });
    return Array.isArray(rows) ? rows[0] : null;
  } catch {
    return null;
  }
}

export async function endReceptionRecord(conversationId, serviceId) {
  if (!conversationId || !serviceId) return null;
  try {
    const rows = await maybeRows(
      "service_receptions",
      `?conversation_id=eq.${encodeURIComponent(conversationId)}&customer_service_id=eq.${encodeURIComponent(serviceId)}&status=eq.active&order=started_at.desc&limit=1`
    );
    if (!rows[0]) return null;
    const patched = await supabaseJson(restUrl("service_receptions", `?id=eq.${encodeURIComponent(rows[0].id)}`), {
      method: "PATCH",
      headers: serviceHeaders(),
      body: JSON.stringify({ status: "completed", ended_at: nowIso() }),
    });
    return Array.isArray(patched) ? patched[0] : null;
  } catch {
    return null;
  }
}

export async function loadReceptionStats(serviceId, conversations = []) {
  const mine = (conversations || []).filter((c) => c.currentServiceId === serviceId || c.customer_service_id === serviceId);
  const currentReceptions = mine.length;
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const monthPrefix = now.toISOString().slice(0, 7);
  const receptions = await maybeRows(
    "service_receptions",
    `?customer_service_id=eq.${encodeURIComponent(serviceId)}&order=started_at.desc&limit=1000`
  );
  if (receptions.length) {
    return {
      currentReceptions,
      todayReceptions: receptions.filter((r) => String(r.started_at || "").slice(0, 10) === today).length,
      monthReceptions: receptions.filter((r) => String(r.started_at || "").slice(0, 7) === monthPrefix).length,
    };
  }
  // 表未建时：用本客服发出的「当前由客服…为您服务」系统消息计今日/本月接待次数。
  const monthStart = `${monthPrefix}-01T00:00:00.000Z`;
  const takeMsgs = await maybeRows(
    "messages",
    `?sender_id=eq.${encodeURIComponent(serviceId)}&message_type=eq.system&created_at=gte.${encodeURIComponent(monthStart)}&select=id,created_at,content&order=created_at.desc&limit=1000`
  );
  const starts = (takeMsgs || []).filter((m) => /当前由客服/.test(String(m.content || "")));
  return {
    currentReceptions,
    todayReceptions: starts.filter((m) => String(m.created_at || "").slice(0, 10) === today).length,
    monthReceptions: starts.length,
  };
}

export async function listServiceRecords({ limit = 500 } = {}) {
  const [receptions, conversations, orders, profiles] = await Promise.all([
    maybeRows("service_receptions", `?order=started_at.desc&limit=${Math.min(Number(limit) || 500, 1000)}`),
    maybeRows("conversations", "?order=updated_at.desc&limit=500"),
    maybeRows("orders", "?order=created_at.desc&limit=500"),
    maybeRows("profiles", "?limit=1000"),
  ]);
  const profileMap = (profiles || []).reduce((map, row) => {
    map[row.id] = row;
    return map;
  }, {});
  const orderMap = (orders || []).reduce((map, row) => {
    map[row.id] = row;
    return map;
  }, {});
  const conversationMap = (conversations || []).reduce((map, row) => {
    map[row.id] = row;
    return map;
  }, {});

  if (receptions.length) {
    return receptions.map((row) => {
      const boss = profileMap[row.boss_id] || {};
      const service = profileMap[row.customer_service_id] || {};
      const conversation = conversationMap[row.conversation_id] || {};
      const orderId = row.order_id || conversation.order_id || "";
      const order = orderMap[orderId] || {};
      const active = row.status === "active";
      return {
        id: row.id,
        receptionId: row.id,
        receptionTime: row.started_at || row.created_at || "",
        created_at: row.started_at || row.created_at || "",
        serviceName: String(service.display_name || service.email || "").trim() || "客服",
        service_name: String(service.display_name || service.email || "").trim() || "客服",
        bossName: String(boss.display_name || boss.boss_uid || boss.email || "").trim() || "老板",
        boss_name: String(boss.display_name || boss.boss_uid || boss.email || "").trim() || "老板",
        hasOrder: !!orderId,
        orderAmount: order.total_amount != null ? order.total_amount : "",
        order_amount: order.total_amount != null ? order.total_amount : "",
        duration: durationText(row.started_at, active ? null : row.ended_at),
        status: active ? "接待中" : "已完成",
        conversationId: row.conversation_id || "",
        conversation_id: row.conversation_id || "",
        orderId: orderId || "",
        order_id: orderId || "",
        satisfaction: "-",
      };
    });
  }

  // 表未建时：至少展示当前仍在接待的会话（哪个客服接待哪个老板）。
  return (conversations || [])
    .filter((row) => row.customer_service_id)
    .map((row) => {
      const boss = profileMap[row.boss_id] || {};
      const service = profileMap[row.customer_service_id] || {};
      const order = orderMap[row.order_id] || {};
      return {
        id: row.id,
        receptionId: row.id,
        receptionTime: row.updated_at || row.created_at || "",
        created_at: row.updated_at || row.created_at || "",
        serviceName: String(service.display_name || service.email || "").trim() || "客服",
        service_name: String(service.display_name || service.email || "").trim() || "客服",
        bossName: String(boss.display_name || boss.boss_uid || boss.email || "").trim() || "老板",
        boss_name: String(boss.display_name || boss.boss_uid || boss.email || "").trim() || "老板",
        hasOrder: !!row.order_id,
        orderAmount: order.total_amount != null ? order.total_amount : "",
        order_amount: order.total_amount != null ? order.total_amount : "",
        duration: durationText(row.created_at, null),
        status: "接待中",
        conversationId: row.id,
        conversation_id: row.id,
        orderId: row.order_id || "",
        order_id: row.order_id || "",
        satisfaction: "-",
      };
    });
}
