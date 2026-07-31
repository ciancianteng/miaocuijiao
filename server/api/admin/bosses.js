const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const RESERVED_BOSS_IDS = ["admin", "system", "official", "root", "support", "service"];

const STATUS_LABEL = {
  active: "正常",
  disabled: "冻结",
  pending: "待审核",
};

const ORDER_STATUS_TEXT = {
  awaiting_payment: "待付款",
  pending: "等待陪玩确认",
  claimed: "等待陪玩确认",
  waiting_boss_confirm: "待老板确认",
  confirmed: "待开始",
  in_progress: "进行中",
  completed: "已完成",
  cancelled: "已取消",
  refund_requested: "售后",
  refunded: "退款",
  after_sale: "售后",
};

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

function roleFrom(req) {
  return req.headers["x-mcj-admin-role"] || req.headers["x-user-role"] || "";
}

function canManageBosses(req) {
  return roleFrom(req) === "super_admin" || roleFrom(req) === "finance_admin" || roleFrom(req) === "admin";
}

function validateBossId(value) {
  const id = String(value || "");
  if (!/^[A-Za-z0-9_]{4,20}$/.test(id)) return "老板 ID 只能使用 4-20 位字母、数字和下划线";
  if (RESERVED_BOSS_IDS.includes(id.toLowerCase())) return "老板 ID 属于系统保留词";
  return "";
}

function supabaseError(body, response) {
  const parts = [
    body?.error_description,
    body?.msg,
    body?.message,
    body?.error,
    body?.hint,
    body?.details,
    typeof body === "string" ? body : "",
  ].filter(Boolean);
  const base = parts[0] || "Supabase 请求失败";
  const code = body?.code ? ` [${body.code}]` : "";
  return `${base}${code} (HTTP ${response.status})`;
}

function money(v) {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
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
  if (!response.ok) throw Object.assign(new Error(supabaseError(body, response)), { status: response.status, body });
  return body;
}

function isMissingRelation(error) {
  const msg = String(error?.message || error || "");
  return /does not exist|Could not find the table|relation .* does not exist|PGRST205|42P01/i.test(msg);
}

async function maybeRows(table, query) {
  try {
    const rows = await supabaseJson(restUrl(table, query), { headers: serviceHeaders() });
    return Array.isArray(rows) ? rows : [];
  } catch (error) {
    if (isMissingRelation(error)) return [];
    throw error;
  }
}

function mapBoss(row, wallet, extras = {}) {
  const bossUid = row.boss_uid || "";
  const w = wallet || {};
  const statusKey = row.status || "active";
  return {
    id: row.id,
    uid: bossUid || row.id,
    boss_uid: bossUid,
    bossUid: bossUid,
    bossId: bossUid || row.id,
    nickname: row.display_name || row.email || "-",
    name: row.display_name || row.email || "-",
    displayName: row.display_name || "",
    email: row.email || "",
    phone: row.phone || "",
    avatar: row.avatar_url || "",
    avatar_url: row.avatar_url || "",
    status: STATUS_LABEL[statusKey] || statusKey || "正常",
    accountStatus: STATUS_LABEL[statusKey] || statusKey || "正常",
    account_status: statusKey,
    created_at: row.created_at,
    registered_at: row.created_at,
    lastLoginAt: row.last_login_at || extras.lastLoginAt || "",
    last_login_at: row.last_login_at || extras.lastLoginAt || "",
    role: row.role,
    vip: extras.vip || "VIP0",
    vipLevel: extras.vip || "VIP0",
    balance: `${money(w.total_balance)}猫粮`,
    walletBalance: money(w.total_balance),
    paidBalance: money(w.paid_balance),
    bonusBalance: money(w.bonus_balance),
    totalRecharge: `RM${money(w.total_recharge_rm).toFixed(2)}`,
    total_recharge: money(w.total_recharge_rm),
    totalSpent: `${money(w.total_spent)}猫粮`,
    total_spent: money(w.total_spent),
    totalCompensation: money(w.total_compensation),
    totalOrders: extras.totalOrders || 0,
    walletFrozen: !!w.frozen,
    remark: row.remark || "",
  };
}

function computeVip(totalSpent, levels) {
  const spent = money(totalSpent);
  const sorted = (levels || [])
    .map((row) => {
      const data = row.data || row.draft || row || {};
      return {
        code: data.code || data.name || "VIP0",
        name: data.name || data.code || "VIP0",
        threshold: money(data.spendThreshold || data.threshold || 0),
        benefits: data.benefits || "",
        couponBenefits: data.couponBenefits || "",
        servicePriority: data.servicePriority || "",
        description: data.description || "",
      };
    })
    .sort((a, b) => a.threshold - b.threshold);
  let current = sorted[0] || { code: "VIP0", name: "VIP0", threshold: 0, benefits: "", couponBenefits: "", servicePriority: "", description: "" };
  for (const level of sorted) {
    if (spent >= level.threshold) current = level;
  }
  const idx = sorted.findIndex((l) => l.code === current.code);
  const next = idx >= 0 && idx < sorted.length - 1 ? sorted[idx + 1] : null;
  return {
    current: current.code || current.name || "VIP0",
    currentName: current.name || current.code || "VIP0",
    threshold: current.threshold,
    benefits: current.benefits,
    couponBenefits: current.couponBenefits,
    servicePriority: current.servicePriority,
    description: current.description,
    nextCode: next ? next.code || next.name : "",
    nextThreshold: next ? next.threshold : null,
    progressSpent: spent,
    levels: sorted,
  };
}

async function loadVipLevels() {
  const rows = await maybeRows(
    "platform_contents",
    "?type=eq.vip_levels&or=(published.eq.true,enabled.eq.true)&order=sort.asc&limit=50"
  ).catch(() => []);
  if (rows.length) return rows;
  return maybeRows("platform_content", "?type=eq.vip_levels&limit=50").catch(() => []);
}

async function loadBossDetail(bossId) {
  let profileRows = await maybeRows("profiles", `?id=eq.${encodeURIComponent(bossId)}&limit=1`);
  if (!profileRows[0]) {
    profileRows = await maybeRows("profiles", `?boss_uid=eq.${encodeURIComponent(bossId)}&role=eq.boss&limit=1`);
  }
  const profile = profileRows[0];
  if (!profile || profile.role !== "boss") {
    throw Object.assign(new Error("老板不存在"), { status: 404 });
  }

  const id = profile.id;
  let wallet = null;
  let transactions = [];
  try {
    const walletApi = await import("../_wallet.js");
    wallet = await walletApi.getWallet(id).catch(() => null);
    const txs = await walletApi.listWalletTx(id, 100).catch(() => []);
    transactions = (txs || []).map(walletApi.viewTx);
  } catch {
    wallet = null;
    transactions = [];
  }

  const [orders, payments, conversations, couponClaims, loginLogs, vipLevelRows, profiles] = await Promise.all([
    maybeRows("orders", `?boss_id=eq.${encodeURIComponent(id)}&order=created_at.desc&limit=100`),
    maybeRows("payment_orders", `?boss_id=eq.${encodeURIComponent(id)}&order=created_at.desc&limit=100`),
    maybeRows("conversations", `?boss_id=eq.${encodeURIComponent(id)}&order=updated_at.desc&limit=50`),
    maybeRows("platform_contents", `?type=eq.user_coupon_claims&order=created_at.desc&limit=200`).catch(() => []),
    maybeRows("login_logs", `?user_id=eq.${encodeURIComponent(id)}&order=created_at.desc&limit=50`).catch(() =>
      maybeRows("auth_login_logs", `?user_id=eq.${encodeURIComponent(id)}&order=created_at.desc&limit=50`).catch(() => [])
    ),
    loadVipLevels(),
    maybeRows("profiles", "?limit=1000"),
  ]);

  const profileMap = (profiles || []).reduce((m, p) => {
    m[p.id] = p;
    return m;
  }, {});

  const orderViews = (orders || []).map((row) => {
    const companion = profileMap[row.companion_id] || {};
    return {
      id: row.id,
      orderNo: row.order_no || row.id,
      game: row.game || "",
      companionName: companion.display_name || companion.email || "-",
      amount: money(row.total_amount),
      status: row.status || "",
      statusText: ORDER_STATUS_TEXT[row.status] || row.status || "-",
      createdAt: row.created_at || "",
      description: row.description || "",
    };
  });

  const refundViews = orderViews.filter((o) => /refund/i.test(o.status));

  const rechargeViews = (payments || []).map((row) => ({
    id: row.id,
    paymentNo: row.payment_no || row.id,
    amount: money(row.amount),
    catFood: money(row.cat_food_amount || row.paid_cat_food),
    bonus: money(row.bonus_cat_food),
    method: row.payment_method || "-",
    status: row.status || "-",
    createdAt: row.created_at || "",
    creditedAt: row.credited_at || "",
  }));

  const spendViews = (transactions || [])
    .filter((t) => t.direction === "debit" || /order|consume|debit|payment/i.test(String(t.type || "")))
    .map((t) => ({
      id: t.id,
      typeText: t.typeText || t.type || "-",
      amount: t.amount,
      balanceTypeText: t.balanceTypeText || t.balanceType || "-",
      reason: t.reason || "-",
      orderId: t.orderId || t.order_id || "",
      createdAt: t.createdAt || t.created_at || "",
    }));

  const convIds = (conversations || []).map((c) => c.id).filter(Boolean);
  let lastMessages = {};
  if (convIds.length) {
    const msgs = await maybeRows(
      "messages",
      `?conversation_id=in.(${convIds.map(encodeURIComponent).join(",")})&order=created_at.desc&limit=200`
    );
    (msgs || []).forEach((msg) => {
      if (!lastMessages[msg.conversation_id]) lastMessages[msg.conversation_id] = msg;
    });
  }

  const chatViews = (conversations || []).map((c) => {
    const service = profileMap[c.customer_service_id] || {};
    const last = lastMessages[c.id] || {};
    return {
      id: c.id,
      status: c.status || "-",
      serviceName: service.display_name || service.email || "未接入",
      lastMessage: last.content || "-",
      orderId: c.order_id || "",
      updatedAt: c.updated_at || c.created_at || "",
    };
  });

  const couponViews = (couponClaims || [])
    .map((row) => {
      const data = row.data || row.draft || row || {};
      const owner = data.userId || data.user_id || data.bossId || data.boss_id || "";
      if (owner && String(owner) !== String(id) && String(owner) !== String(profile.boss_uid || "")) return null;
      return {
        id: row.id || data.id || "",
        name: data.name || data.couponName || data.title || "优惠券",
        benefit: data.benefit || data.discountText || data.description || "-",
        orderNo: data.orderNo || data.order_id || "-",
        status: data.status || (data.usedAt ? "已使用" : "未使用"),
        usedAt: data.usedAt || data.used_at || row.updated_at || row.created_at || "",
      };
    })
    .filter(Boolean)
    .slice(0, 50);

  const loginViews = (loginLogs || []).map((row) => ({
    id: row.id,
    createdAt: row.created_at || row.logged_at || "",
    ip: row.ip || row.ip_address || "-",
    device: row.device || row.user_agent || row.ua || "-",
    result: row.result || row.status || "成功",
  }));

  const vip = computeVip(wallet?.total_spent, vipLevelRows);
  const invites = await loadBossInvites(id, profile.boss_uid);
  const boss = mapBoss(profile, wallet, {
    vip: vip.current,
    totalOrders: orderViews.length,
    lastLoginAt: loginViews[0]?.createdAt || profile.last_login_at || "",
  });

  return {
    boss,
    wallet: wallet
      ? {
          totalBalance: money(wallet.total_balance),
          paidBalance: money(wallet.paid_balance),
          bonusBalance: money(wallet.bonus_balance),
          totalRechargeRm: money(wallet.total_recharge_rm),
          totalSpent: money(wallet.total_spent),
          totalCompensation: money(wallet.total_compensation),
          frozen: !!wallet.frozen,
        }
      : null,
    orders: orderViews,
    recharges: rechargeViews,
    spends: spendViews,
    refunds: refundViews,
    chats: chatViews,
    coupons: couponViews,
    vip,
    logins: loginViews,
    invites,
    transactions,
  };
}

async function patchBossStatus(id, status, freezeWallet) {
  const rows = await supabaseJson(restUrl("profiles", `?id=eq.${encodeURIComponent(id)}`), {
    method: "PATCH",
    headers: serviceHeaders(),
    body: JSON.stringify({ status }),
  });
  if (freezeWallet !== undefined) {
    try {
      await supabaseJson(restUrl("wallets", `?boss_id=eq.${encodeURIComponent(id)}`), {
        method: "PATCH",
        headers: serviceHeaders(),
        body: JSON.stringify({ frozen: !!freezeWallet }),
      });
    } catch {}
  }
  return rows?.[0] || null;
}

async function patchBossRemark(id, remark) {
  try {
    const rows = await supabaseJson(restUrl("profiles", `?id=eq.${encodeURIComponent(id)}`), {
      method: "PATCH",
      headers: serviceHeaders(),
      body: JSON.stringify({ remark: String(remark || "") }),
    });
    return rows?.[0] || null;
  } catch (error) {
    if (/column|remark|schema cache/i.test(String(error.message || ""))) {
      throw Object.assign(new Error("请先为 profiles 增加 remark 字段后再保存备注。"), { status: 503 });
    }
    throw error;
  }
}

async function resetBossPassword(id, password) {
  const pwd = String(password || "").trim();
  if (pwd.length < 8) throw Object.assign(new Error("新密码至少 8 位"), { status: 400 });
  await supabaseJson(`${process.env.SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: serviceHeaders(),
    body: JSON.stringify({ password: pwd }),
  });
}

async function unbindBoss(id) {
  const patch = { phone: "" };
  try {
    return (
      (
        await supabaseJson(restUrl("profiles", `?id=eq.${encodeURIComponent(id)}`), {
          method: "PATCH",
          headers: serviceHeaders(),
          body: JSON.stringify(patch),
        })
      )?.[0] || null
    );
  } catch (error) {
    throw Object.assign(new Error(error.message || "解绑失败"), { status: 500 });
  }
}

async function loadBossInvites(bossId, bossUid) {
  const txs = await maybeRows(
    "transactions",
    `?or=(user_id.eq.${encodeURIComponent(bossId)},boss_id.eq.${encodeURIComponent(bossId)})&order=created_at.desc&limit=100`
  ).catch(() => []);
  const inviteTx = (txs || []).filter((t) => /invite|邀请|rebate|返利/i.test(String(t.transaction_type || t.type || t.note || "")));
  const referral = await maybeRows(
    "referral_relations",
    `?or=(inviter_id.eq.${encodeURIComponent(bossId)},invitee_id.eq.${encodeURIComponent(bossId)},inviter_uid.eq.${encodeURIComponent(bossUid || "")})&limit=100`
  ).catch(() => []);
  const fromReferral = (referral || []).map((r) => ({
    id: r.id,
    inviter: r.inviter_name || r.inviter_uid || r.inviter_id || "-",
    invitee: r.invitee_name || r.invitee_uid || r.invitee_id || "-",
    relation: r.relation || r.type || "邀请关系",
    rebate: money(r.rebate_amount || r.amount),
    status: r.status || "-",
    createdAt: r.created_at || "",
  }));
  const fromTx = inviteTx.map((t) => ({
    id: t.id,
    inviter: bossUid || bossId,
    invitee: t.counterparty || "-",
    relation: t.transaction_type || t.type || "邀请奖励",
    rebate: money(t.amount),
    status: t.status || "completed",
    createdAt: t.created_at || "",
  }));
  return [...fromReferral, ...fromTx].slice(0, 80);
}

function parseQuery(req) {
  const url = new URL(req.url || "/", "http://localhost");
  return Object.fromEntries(url.searchParams.entries());
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

export default async function handler(req, res) {
  if (!canManageBosses(req)) {
    return json(res, 403, { ok: false, message: "没有老板管理权限" });
  }

  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);

  if (req.method === "GET") {
    if (missing.length) {
      return json(res, 200, {
        ok: true,
        configured: false,
        bosses: [],
        message: "真实老板数据库未配置，未返回任何模拟老板",
        requiredEnv: missing,
      });
    }
    try {
      const query = parseQuery(req);
      const detailId = String(query.id || query.bossId || query.boss_id || "").trim();
      if (detailId) {
        const detail = await loadBossDetail(detailId);
        return json(res, 200, { ok: true, configured: true, ...detail });
      }

      const response = await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/profiles?role=eq.boss&order=created_at.desc&limit=300`,
        {
          headers: {
            apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          },
        }
      );
      const text = await response.text();
      let rows = [];
      try {
        rows = text ? JSON.parse(text) : [];
      } catch (e) {}
      if (!response.ok) {
        return json(res, response.status || 500, {
          ok: false,
          message: supabaseError(rows, response),
          table: "profiles",
          httpStatus: response.status,
        });
      }
      let walletByBoss = {};
      let orderCountByBoss = {};
      try {
        const { getWallet } = await import("../_wallet.js");
        const list = Array.isArray(rows) ? rows : [];
        const wallets = await Promise.all(list.map((row) => getWallet(row.id).catch(() => null)));
        list.forEach((row, i) => {
          walletByBoss[row.id] = wallets[i] || null;
        });
      } catch (e) {
        walletByBoss = {};
      }
      try {
        const orders = await maybeRows("orders", "?select=boss_id&limit=2000");
        (orders || []).forEach((o) => {
          if (!o.boss_id) return;
          orderCountByBoss[o.boss_id] = (orderCountByBoss[o.boss_id] || 0) + 1;
        });
      } catch {}

      const vipLevels = await loadVipLevels();
      return json(res, 200, {
        ok: true,
        configured: true,
        bosses: Array.isArray(rows)
          ? rows.map((row) => {
              const w = walletByBoss[row.id];
              const vip = computeVip(w?.total_spent, vipLevels);
              return mapBoss(row, w, { vip: vip.current, totalOrders: orderCountByBoss[row.id] || 0 });
            })
          : [],
        accountStatuses: ["正常", "限制下单", "限制充值", "冻结", "已注销", "黑名单"],
        loginStatuses: ["在线", "离线"],
        reservedBossIds: RESERVED_BOSS_IDS,
      });
    } catch (error) {
      return json(res, error.status || 500, { ok: false, message: error.message || "老板管理接口异常" });
    }
  }

  if (req.method === "OPTIONS") {
    return json(res, 200, {
      ok: true,
      accountStatuses: ["正常", "限制下单", "限制充值", "冻结", "已注销", "黑名单"],
      loginStatuses: ["在线", "离线"],
      reservedBossIds: RESERVED_BOSS_IDS,
    });
  }

  if (req.method !== "POST") {
    return json(res, 405, { ok: false, message: "Method Not Allowed" });
  }

  const body = await parseBody(req);

  if (body.action === "boss-id") {
    const error = validateBossId(body.payload && body.payload.bossId);
    if (error) return json(res, 400, { ok: false, message: error });
    return json(res, 200, { ok: true, message: "老板 ID 可用" });
  }

  if (missing.length) {
    return json(res, 503, {
      ok: false,
      message: "真实数据库未配置，老板管理修改未保存",
      requiredEnv: missing,
    });
  }

  try {
    const action = String(body.action || "").trim();
    const id = String(body.id || body.bossId || "").trim();
    const ids = Array.isArray(body.payload?.ids) ? body.payload.ids.map(String) : id ? [id] : [];

    if (/^bulk-/.test(action) && ids.length) {
      const bulkAction = action.replace(/^bulk-/, "");
      for (const one of ids) {
    if (bulkAction === "freeze" || bulkAction === "blacklist") await patchBossStatus(one, "disabled", true);
        else if (bulkAction === "unban" || bulkAction === "enable") await patchBossStatus(one, "active", false);
      }
      return json(res, 200, { ok: true, message: "批量操作已完成", count: ids.length });
    }

    if (!id) return json(res, 400, { ok: false, message: "缺少老板 ID" });

    if (action === "freeze") {
      await patchBossStatus(id, "disabled", true);
      return json(res, 200, { ok: true, message: "账号已冻结" });
    }
    if (action === "blacklist") {
      await patchBossStatus(id, "disabled", true);
      return json(res, 200, { ok: true, message: "已按黑名单处理（账号停用并冻结钱包）" });
    }
    if (action === "unban" || action === "enable" || action === "unfreeze") {
      await patchBossStatus(id, "active", false);
      return json(res, 200, { ok: true, message: "账号已解封/启用" });
    }
    if (action === "ban") {
      await patchBossStatus(id, "disabled", true);
      return json(res, 200, { ok: true, message: "账号已封禁" });
    }
    if (action === "remark" || action === "save_remark") {
      const remark = String(body.payload?.remark ?? body.remark ?? "").trim();
      await patchBossRemark(id, remark);
      return json(res, 200, { ok: true, message: "备注已保存", remark });
    }
    if (action === "reset_password" || action === "reset-password") {
      const password = String(body.payload?.password || body.password || "").trim();
      await resetBossPassword(id, password);
      return json(res, 200, { ok: true, message: "密码已重置" });
    }
    if (action === "unbind") {
      await unbindBoss(id);
      return json(res, 200, { ok: true, message: "已解绑手机号" });
    }

    return json(res, 400, { ok: false, message: "未知老板管理操作：" + action });
  } catch (error) {
    return json(res, error.status || 500, { ok: false, message: error.message || "老板管理写操作失败" });
  }
}
