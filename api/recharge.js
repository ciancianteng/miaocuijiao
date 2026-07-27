import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

loadLocalEnv();

const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
const DEFAULT_METHODS = [
  { code: "tng", name: "TNG" },
  { code: "alipay", name: "支付宝" },
  { code: "bank", name: "银行支付" },
];

function loadLocalEnv() {
  const apiDir = path.dirname(fileURLToPath(import.meta.url));
  const envPath = path.resolve(apiDir, "..", ".env.local");
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
  const base = { apikey: key, "Content-Type": "application/json", "User-Agent": "MCJ-Server/1.0", ...extra };
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
  const text = `${error?.message || ""} ${JSON.stringify(error?.body || "")}`;
  return error?.status === 404 || /Could not find the table|schema cache|PGRST205|does not exist/i.test(text);
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

function number(value) {
  const parsed = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function paymentNo() {
  return `PAY-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function methodConfigured(method) {
  const required = ["api_base_url", "merchant_id", "api_key", "api_secret", "callback_secret", "redirect_url", "callback_url"];
  return Boolean(method?.is_enabled) && required.every((key) => String(method?.[key] || "").trim());
}

function publicMethod(row) {
  return {
    id: row.id || "",
    code: row.code || "",
    name: row.name || "",
    enabled: Boolean(row.is_enabled),
    configured: methodConfigured(row),
    mode: row.mode || "test",
    statusText: !row.is_enabled ? "暂未开放" : methodConfigured(row) ? "可用" : "暂未开放",
  };
}

function defaultMethodRows() {
  return DEFAULT_METHODS.map((item, index) => ({
    id: "",
    code: item.code,
    name: item.name,
    is_enabled: false,
    sort_order: index + 1,
    mode: "test",
  }));
}

async function loadMethods() {
  try {
    const rows = await supabaseJson(restUrl("payment_methods", "?order=sort_order.asc,name.asc"), { headers: serviceHeaders() });
    const list = Array.isArray(rows) && rows.length ? rows : defaultMethodRows();
    return { tableReady: true, methods: list.map(publicMethod), raw: list };
  } catch (error) {
    if (isMissingTable(error)) {
      return { tableReady: false, methods: defaultMethodRows().map(publicMethod), raw: defaultMethodRows(), message: "payment_methods 表未初始化。" };
    }
    throw error;
  }
}

async function loadTransactions(profileId) {
  const rows = await supabaseJson(restUrl("transactions", `?user_id=eq.${encodeURIComponent(profileId)}&order=created_at.desc&limit=200`), { headers: serviceHeaders() });
  return Array.isArray(rows) ? rows : [];
}

async function loadPaymentOrders(profileId) {
  try {
    const rows = await supabaseJson(restUrl("payment_orders", `?boss_id=eq.${encodeURIComponent(profileId)}&order=created_at.desc&limit=50`), { headers: serviceHeaders() });
    return { tableReady: true, records: Array.isArray(rows) ? rows : [] };
  } catch (error) {
    if (isMissingTable(error)) return { tableReady: false, records: [], message: "payment_orders 表未初始化。" };
    throw error;
  }
}

function summarize(transactions) {
  const settled = new Set(["paid", "success", "approved", "completed"]);
  let totalRecharge = 0;
  let totalSpent = 0;
  let refunds = 0;
  for (const row of transactions) {
    const amount = number(row.amount);
    if (!settled.has(String(row.status || "").toLowerCase())) continue;
    if (row.transaction_type === "recharge") totalRecharge += amount;
    if (row.transaction_type === "payment") totalSpent += Math.abs(amount);
    if (row.transaction_type === "refund") refunds += amount;
  }
  return {
    balance: Math.max(0, totalRecharge + refunds - totalSpent),
    totalRecharge,
    totalSpent,
  };
}

function recordView(row) {
  return {
    id: row.id,
    paymentNo: row.payment_no || row.id,
    amount: number(row.amount),
    catFoodAmount: number(row.cat_food_amount),
    paymentMethod: row.payment_method || "",
    status: row.status || "pending",
    paymentUrl: row.payment_url || "",
    createdAt: row.created_at || "",
  };
}

async function createPaymentOrder(profile, method, amount) {
  try {
    const rows = await supabaseJson(restUrl("payment_orders"), {
      method: "POST",
      headers: serviceHeaders({ Prefer: "return=representation" }),
      body: JSON.stringify({
        payment_no: paymentNo(),
        boss_id: profile.id,
        amount,
        cat_food_amount: amount,
        payment_method: method.code,
        status: methodConfigured(method) ? "pending" : "unavailable",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    });
    return Array.isArray(rows) ? rows[0] : null;
  } catch (error) {
    if (isMissingTable(error)) {
      throw Object.assign(new Error("该支付方式暂未开放：payment_orders 表未初始化，请先执行 supabase/init.sql 中的支付表结构。"), { status: 503 });
    }
    throw error;
  }
}

async function updatePaymentOrder(id, patch) {
  if (!id) return null;
  const rows = await supabaseJson(restUrl("payment_orders", `?id=eq.${encodeURIComponent(id)}`), {
    method: "PATCH",
    headers: serviceHeaders({ Prefer: "return=representation" }),
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
      amount: number(order.amount),
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
      const [transactions, paymentOrders, methodState] = await Promise.all([
        loadTransactions(profile.id),
        loadPaymentOrders(profile.id),
        loadMethods(),
      ]);
      return json(res, 200, {
        ok: true,
        summary: summarize(transactions),
        methods: methodState.methods,
        records: paymentOrders.records.map(recordView),
        paymentTablesReady: paymentOrders.tableReady && methodState.tableReady,
        message: !paymentOrders.tableReady || !methodState.tableReady ? "支付表未初始化，充值提交暂不可用。" : "",
      });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return json(res, 405, { ok: false, message: "Method Not Allowed" });
    }

    const body = await parseBody(req);
    const amount = number(body.amount);
    const methodCode = String(body.paymentMethod || body.method || "").trim();
    if (amount <= 0) return json(res, 400, { ok: false, message: "请选择有效的充值金额。" });
    if (!methodCode) return json(res, 400, { ok: false, message: "请选择支付方式。" });

    const methodState = await loadMethods();
    if (!methodState.tableReady) {
      return json(res, 503, { ok: false, message: "该支付方式暂未开放：payment_methods 表未初始化，请先执行 supabase/init.sql 中的支付表结构。" });
    }
    const method = methodState.raw.find((item) => item.code === methodCode || item.name === methodCode);
    if (!method) return json(res, 404, { ok: false, message: "支付方式不存在。" });

    const paymentOrder = await createPaymentOrder(profile, method, amount);
    if (!methodConfigured(method)) {
      return json(res, 409, {
        ok: false,
        message: "该支付方式暂未开放",
        paymentOrder: paymentOrder ? recordView(paymentOrder) : null,
      });
    }

    try {
      const payment = await callPaymentProvider(method, paymentOrder);
      const saved = await updatePaymentOrder(paymentOrder.id, {
        status: "pending_payment",
        payment_url: payment.paymentUrl,
        raw_response: payment.raw,
      });
      return json(res, 200, { ok: true, message: "支付订单已创建", paymentUrl: payment.paymentUrl, paymentOrder: recordView(saved || paymentOrder) });
    } catch (error) {
      await updatePaymentOrder(paymentOrder.id, { status: "failed", raw_response: { error: error.message } }).catch(() => null);
      return json(res, 502, { ok: false, message: error.message || "支付网关调用失败。", paymentOrder: recordView(paymentOrder) });
    }
  } catch (error) {
    return json(res, error.status || 500, { ok: false, message: error.message || "充值接口异常" });
  }
}

