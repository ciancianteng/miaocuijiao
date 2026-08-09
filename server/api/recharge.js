import fs from "node:fs";
import path from "node:path";
import {
  getWallet,
  isMissingRelation,
  listCampaigns,
  listWalletTx,
  money,
  viewCampaign,
  viewTx,
  viewWallet,
} from "./_wallet.js";
import {
  CANONICAL_PAYMENT_CHANNELS,
  filterBossRechargeMethods,
  listBossOrderPaymentMethods,
  listBossPaymentMethods,
  loadChannelPayInfo,
  normalizePaymentChannelId,
} from "./_platform-pay-qr.js";

loadLocalEnv();

const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
const DEFAULT_METHODS = CANONICAL_PAYMENT_CHANNELS.map((item) => ({
  code: item.code,
  name: item.name,
  category: item.category,
}));

function loadLocalEnv() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const rawLine of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (key && value && !process.env[key]) process.env[key] = value;
  }
}

function envValue(key) {
  if (key === "SUPABASE_URL") return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  if (key === "SUPABASE_ANON_KEY") return process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
  return process.env[key] || "";
}

function json(res, status, data) {
  res.status(status).json(data);
}

function hasDb() {
  return REQUIRED_ENV.every((key) => envValue(key));
}

function authHeaders(extra = {}) {
  return { apikey: envValue("SUPABASE_ANON_KEY"), "Content-Type": "application/json", ...extra };
}

function serviceHeaders(extra = {}) {
  const key = envValue("SUPABASE_SERVICE_ROLE_KEY");
  const base = { apikey: key, "Content-Type": "application/json", "User-Agent": "MCJ-Server/1.0", Prefer: "return=representation", ...extra };
  if (!key.startsWith("sb_secret_")) base.Authorization = `Bearer ${key}`;
  return base;
}

function authUrl(route) {
  return `${envValue("SUPABASE_URL")}/auth/v1/${route}`;
}

function restUrl(table, query = "") {
  return `${envValue("SUPABASE_URL")}/rest/v1/${table}${query}`;
}

function tokenFrom(req) {
  return String(req.headers.authorization || req.headers["x-mcj-access-token"] || "").replace(/^Bearer\s+/i, "").trim();
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
    const message = body?.message || body?.hint || body?.details || body?.error_description || (typeof body === "string" ? body : "") || "Supabase 请求失败";
    const error = new Error(message);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

function isMissingTable(error) {
  return isMissingRelation(error);
}

async function profileFromToken(req) {
  const token = tokenFrom(req);
  if (!token) throw Object.assign(new Error("请先登录老板账号。"), { status: 401 });
  const authUser = await supabaseJson(authUrl("user"), { headers: authHeaders({ Authorization: `Bearer ${token}` }) });
  const rows = await supabaseJson(restUrl("profiles", `?id=eq.${encodeURIComponent(authUser.id)}&limit=1`), { headers: serviceHeaders() });
  const profile = Array.isArray(rows) ? rows[0] : null;
  if (!profile) throw Object.assign(new Error("账号未绑定平台资料。"), { status: 403 });
  if (profile.role !== "boss") throw Object.assign(new Error("只有老板账号可以访问充值中心。"), { status: 403 });
  if (profile.status !== "active") throw Object.assign(new Error("老板账号未启用。"), { status: 403 });
  return profile;
}

function paymentNo() {
  return `PAY-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function methodConfigured(method) {
  // Prefer flags already computed from payment_channels SoT.
  if (method && typeof method.configured === "boolean") {
    return Boolean(method.configured && method.enabled !== false && method.open !== false);
  }
  if (method?.enabled === false || method?.open === false) return false;
  if (!method?.is_enabled && method?.enabled == null) return false;
  const category = String(method.category || "").toLowerCase();
  const code = normalizePaymentChannelId(method.code || method.name);
  const manualCodes = new Set(["tng", "duitnow", "bank-transfer", "alipay"]);
  if (category === "manual" || manualCodes.has(code)) {
    return Boolean(method.is_enabled || method.enabled);
  }
  const hasKey = Boolean(String(method.api_key || "").trim() || String(method.api_secret || "").trim());
  return hasKey && Boolean(method.is_enabled || method.enabled);
}

function publicMethod(row) {
  const code = normalizePaymentChannelId(row.code || row.name) || row.code || "";
  const enabled = row.enabled != null ? Boolean(row.enabled) : Boolean(row.is_enabled);
  const configured = row.configured != null ? Boolean(row.configured) : methodConfigured({ ...row, enabled, code });
  const open = row.open != null ? Boolean(row.open) : enabled && configured;
  return {
    id: row.id || "",
    code,
    name: row.name || code,
    category: row.category || "api",
    enabled,
    configured,
    open,
    forOrder: row.forOrder !== false,
    forRecharge: row.forRecharge !== false,
    mode: row.mode || "test",
    statusText: open ? "可用" : "暂未开放",
    payInfo: row.payInfo && row.payInfo.enabled ? row.payInfo : null,
  };
}

function defaultMethodRows() {
  return DEFAULT_METHODS.map((item, index) => ({
    id: "",
    code: item.code,
    name: item.name,
    is_enabled: false,
    enabled: false,
    configured: false,
    open: false,
    sort_order: index + 1,
    mode: "test",
    category: item.category || "api",
  }));
}

async function loadMethods() {
  let methodRows = [];
  let methodsTableReady = true;
  try {
    const rows = await supabaseJson(restUrl("payment_methods", "?order=sort_order.asc,name.asc"), { headers: serviceHeaders() });
    methodRows = Array.isArray(rows) ? rows : [];
  } catch (error) {
    if (!isMissingTable(error)) throw error;
    methodsTableReady = false;
    methodRows = [];
  }
  try {
    const listed = await listBossPaymentMethods(methodRows);
    const orderListed = await listBossOrderPaymentMethods(methodRows);
    const raw = listed.methods.length ? listed.methods : defaultMethodRows();
    const publicMethods = raw.map(publicMethod);
    // Recharge center: open + forRecharge only (order uses orderPayMethods).
    const rechargeOpen = filterBossRechargeMethods(publicMethods);
    return {
      tableReady: listed.tableReady || methodsTableReady,
      methods: publicMethods,
      // Boss recharge UI should only offer open + forRecharge channels.
      openMethods: rechargeOpen,
      orderPayMethods: orderListed.methods,
      walletPayEnabled: orderListed.walletPayEnabled,
      raw,
      message: !listed.tableReady && !methodsTableReady ? "支付通道表未初始化。" : "",
    };
  } catch (error) {
    if (isMissingTable(error)) {
      return {
        tableReady: false,
        methods: defaultMethodRows().map(publicMethod),
        openMethods: [],
        orderPayMethods: [],
        walletPayEnabled: true,
        raw: defaultMethodRows(),
        message: "支付通道表未初始化。",
      };
    }
    throw error;
  }
}

async function loadPaymentOrders(profileId) {
  try {
    const rows = await supabaseJson(restUrl("payment_orders", `?boss_id=eq.${encodeURIComponent(profileId)}&order=created_at.desc&limit=50`), {
      headers: serviceHeaders(),
    });
    return { tableReady: true, records: Array.isArray(rows) ? rows : [] };
  } catch (error) {
    if (isMissingTable(error)) return { tableReady: false, records: [], message: "payment_orders 表未初始化。" };
    throw error;
  }
}

function recordView(row) {
  return {
    id: row.id,
    paymentNo: row.payment_no || row.id,
    amount: money(row.amount),
    catFoodAmount: money(row.cat_food_amount),
    paidCatFood: money(row.paid_cat_food || row.cat_food_amount),
    bonusCatFood: money(row.bonus_cat_food),
    campaignId: row.campaign_id || "",
    paymentMethod: row.payment_method || "",
    status: row.status || "pending",
    paymentUrl: row.payment_url || "",
    creditedAt: row.credited_at || "",
    createdAt: row.created_at || "",
  };
}

function campaignActive(c) {
  if (!c || !c.enabled) return false;
  const now = Date.now();
  if (c.startsAt && new Date(c.startsAt).getTime() > now) return false;
  if (c.endsAt && new Date(c.endsAt).getTime() < now) return false;
  return true;
}

async function countBossCampaignUses(bossId, campaignId) {
  try {
    const rows = await supabaseJson(
      restUrl(
        "payment_orders",
        `?boss_id=eq.${encodeURIComponent(bossId)}&campaign_id=eq.${encodeURIComponent(campaignId)}&status=eq.paid&select=id`
      ),
      { headers: serviceHeaders() }
    );
    return Array.isArray(rows) ? rows.length : 0;
  } catch {
    return 0;
  }
}

async function countBossPaidRecharges(bossId) {
  try {
    const rows = await supabaseJson(restUrl("payment_orders", `?boss_id=eq.${encodeURIComponent(bossId)}&status=eq.paid&select=id`), {
      headers: serviceHeaders(),
    });
    return Array.isArray(rows) ? rows.length : 0;
  } catch {
    return 0;
  }
}

async function createPaymentOrder(profile, method, amount, campaign) {
  const paid = campaign ? money(campaign.baseCatFood) : amount;
  const bonus = campaign ? money(campaign.bonusCatFood) : 0;
  const total = campaign ? money(campaign.totalCatFood) || paid + bonus : amount;
  try {
    const rows = await supabaseJson(restUrl("payment_orders"), {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify({
        payment_no: paymentNo(),
        boss_id: profile.id,
        amount,
        cat_food_amount: total,
        paid_cat_food: paid,
        bonus_cat_food: bonus,
        campaign_id: campaign?.id || null,
        payment_method: method.code,
        status: methodConfigured(method) ? "pending" : "unavailable",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    });
    return Array.isArray(rows) ? rows[0] : null;
  } catch (error) {
    if (isMissingTable(error)) {
      throw Object.assign(new Error("该支付方式暂未开放：payment_orders 表未初始化。"), { status: 503 });
    }
    throw error;
  }
}

async function updatePaymentOrder(id, patch) {
  if (!id) return null;
  const rows = await supabaseJson(restUrl("payment_orders", `?id=eq.${encodeURIComponent(id)}`), {
    method: "PATCH",
    headers: serviceHeaders(),
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
  return Array.isArray(rows) ? rows[0] : null;
}

async function callPaymentProvider(method, order) {
  const endpoint = `${String(method.api_base_url || "").replace(/\/+$/, "")}/payment/create`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Merchant-Id": method.merchant_id,
      "X-Api-Key": method.api_key,
    },
    body: JSON.stringify({
      merchant_id: method.merchant_id,
      payment_no: order.payment_no,
      amount: money(order.amount),
      currency: "MYR",
      redirect_url: method.redirect_url,
      callback_url: method.callback_url,
      mode: method.mode || "test",
    }),
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!response.ok) throw new Error(body?.message || body?.error || `支付网关返回 ${response.status}`);
  const paymentUrl = body.payment_url || body.paymentUrl || body.url || body.data?.payment_url || body.data?.url || "";
  if (!paymentUrl) throw new Error("支付网关未返回 payment_url。");
  return { paymentUrl, raw: body };
}

export default async function handler(req, res) {
  if (!hasDb()) {
    return json(res, 503, { ok: false, message: "未配置 Supabase，充值中心无法读取真实数据。" });
  }

  try {
    const profile = await profileFromToken(req);

    if (req.method === "GET") {
      const [walletRow, walletTx, paymentOrders, methodState, campaigns] = await Promise.all([
        getWallet(profile.id),
        listWalletTx(profile.id, 50),
        loadPaymentOrders(profile.id),
        loadMethods(),
        listCampaigns({ enabledOnly: true }),
      ]);
      const activeCampaigns = campaigns.filter(campaignActive);
      const wallet = viewWallet(walletRow, profile.id);
      // Recharge center: open + forRecharge only — never reuse orderPayMethods here.
      const visibleMethods = methodState.openMethods?.length
        ? methodState.openMethods
        : filterBossRechargeMethods(methodState.methods || []);
      return json(res, 200, {
        ok: true,
        wallet,
        summary: {
          balance: wallet.totalBalance,
          paidBalance: wallet.paidBalance,
          bonusBalance: wallet.bonusBalance,
          totalRecharge: wallet.totalRechargeRm,
          totalSpent: wallet.totalSpent,
          totalBonus: wallet.totalBonusIn,
          totalCompensation: wallet.totalCompensation,
        },
        campaigns: activeCampaigns,
        transactions: walletTx.map(viewTx),
        methods: visibleMethods,
        // Full channel list with flags (for debugging / optional UIs).
        allMethods: methodState.methods,
        // Order / place-order / gameplay / custom-order shared SoT (includes 猫粮余额 when enabled).
        orderPayMethods: methodState.orderPayMethods || [],
        walletPayEnabled: methodState.walletPayEnabled !== false,
        records: paymentOrders.records.map(recordView),
        paymentTablesReady: paymentOrders.tableReady && methodState.tableReady,
        message:
          methodState.message ||
          (!paymentOrders.tableReady || !methodState.tableReady ? "支付表未初始化，充值提交暂不可用。" : ""),
      });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return json(res, 405, { ok: false, message: "Method Not Allowed" });
    }

    const body = await parseBody(req);
    const methodCodeRaw = String(body.paymentMethod || body.method || "").trim();
    const methodCode = normalizePaymentChannelId(methodCodeRaw) || methodCodeRaw;
    const campaignId = String(body.campaignId || body.campaign_id || "").trim();
    if (!methodCode) return json(res, 400, { ok: false, message: "请选择支付方式。" });

    const methodState = await loadMethods();
    if (!methodState.tableReady) {
      return json(res, 503, { ok: false, message: "该支付方式暂未开放：支付通道未初始化。" });
    }
    const method =
      methodState.raw.find(
        (item) =>
          item.code === methodCode ||
          item.name === methodCodeRaw ||
          item.name === methodCode ||
          normalizePaymentChannelId(item.code) === methodCode
      ) || null;
    if (!method) return json(res, 404, { ok: false, message: "支付方式不存在。" });

    // Hard block: disabled / unconfigured — never fall back to another channel.
    if (!methodConfigured(method)) {
      return json(res, 409, {
        ok: false,
        message: "该支付方式暂未开放",
        method: publicMethod(method),
      });
    }
    let campaign = null;
    let amount = money(body.amount);
    if (campaignId) {
      const all = await listCampaigns({ enabledOnly: false });
      campaign = all.find((c) => c.id === campaignId) || null;
      if (!campaign || !campaignActive(campaign)) {
        return json(res, 400, { ok: false, message: "充值活动不存在或未启用。" });
      }
      amount = money(campaign.payAmountRm);
      if (campaign.firstRechargeOnly) {
        const paidCount = await countBossPaidRecharges(profile.id);
        if (paidCount > 0) return json(res, 400, { ok: false, message: "该活动仅限首次充值。" });
      }
      if (campaign.perBossLimit > 0) {
        const used = await countBossCampaignUses(profile.id, campaign.id);
        if (used >= campaign.perBossLimit) return json(res, 400, { ok: false, message: "您已达到该活动参与次数上限。" });
      }
    }

    if (amount <= 0) return json(res, 400, { ok: false, message: "请选择有效的充值金额。" });

    // Persist canonical code only (never manual_tng).
    const methodForOrder = { ...method, code: method.code || methodCode, is_enabled: true };
    const paymentOrder = await createPaymentOrder(profile, methodForOrder, amount, campaign);

    const methodCategory = String(method.category || "").toLowerCase();
    const isManual =
      methodCategory === "manual" ||
      ["tng", "duitnow", "bank-transfer", "alipay"].includes(String(method.code || methodCode).toLowerCase());
    if (isManual) {
      const payInfo = await loadChannelPayInfo(method.code || methodCode);
      if (!payInfo || payInfo.enabled === false || payInfo.unavailable) {
        await updatePaymentOrder(paymentOrder.id, { status: "unavailable" }).catch(() => null);
        return json(res, 409, {
          ok: false,
          message: "该支付方式暂未开放",
          paymentOrder: recordView(paymentOrder),
        });
      }
      const manualUrl = `/recharge.html?paymentNo=${encodeURIComponent(paymentOrder?.payment_no || "")}`;
      const saved = await updatePaymentOrder(paymentOrder.id, {
        status: "pending_payment",
        payment_url: manualUrl,
        payment_method: method.code || methodCode,
        raw_response: {
          mode: "manual",
          channelId: method.code || methodCode,
          message: "请按收款指引完成转账，管理员确认后猫粮到账。",
        },
      });
      return json(res, 200, {
        ok: true,
        manual: true,
        message: "充值单已创建。请完成转账，管理员在后台确认到账后猫粮入账。",
        paymentUrl: manualUrl,
        payInfo,
        paymentOrder: recordView(saved || paymentOrder),
        campaign: campaign ? viewCampaign(campaign) : null,
      });
    }

    try {
      const payment = await callPaymentProvider(methodForOrder, paymentOrder);
      const saved = await updatePaymentOrder(paymentOrder.id, {
        status: "pending_payment",
        payment_url: payment.paymentUrl,
        payment_method: method.code || methodCode,
        raw_response: payment.raw,
      });
      return json(res, 200, {
        ok: true,
        message: "支付订单已创建，请完成支付。到账以服务端回调为准。",
        paymentUrl: payment.paymentUrl,
        paymentOrder: recordView(saved || paymentOrder),
      });
    } catch (error) {
      await updatePaymentOrder(paymentOrder.id, { status: "failed", raw_response: { error: error.message } }).catch(() => null);
      return json(res, 502, { ok: false, message: error.message || "支付网关调用失败。", paymentOrder: recordView(paymentOrder) });
    }
  } catch (error) {
    return json(res, error.status || 500, { ok: false, message: error.message || "充值接口异常" });
  }
}
