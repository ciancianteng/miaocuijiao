import {
  createGiftOrder,
  getGiftOrderById,
  listBossGiftOrders,
  uploadGiftOrderProof,
  signedGiftProofUrl,
  viewGiftOrder,
  resolveGiftPaymentInfo,
  enrichGiftOrders,
} from "../_gift-orders.js";
import { hasBossRole } from "../_account-roles.js";

const REQUIRED = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];

function json(res, status, data) {
  return res.status(status).json(data);
}

function hasDb() {
  return REQUIRED.every(
    (k) =>
      process.env[k] ||
      (k === "SUPABASE_URL" && process.env.VITE_SUPABASE_URL) ||
      (k === "SUPABASE_ANON_KEY" &&
        (process.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY))
  );
}

function url() {
  return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
}

function anonKey() {
  return (
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    ""
  );
}

function serviceHeaders(extra = {}) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
    ...extra,
  };
}

function anonHeaders(extra = {}) {
  return { apikey: anonKey(), "Content-Type": "application/json", ...extra };
}

function rest(table, query = "") {
  return `${url()}/rest/v1/${table}${query}`;
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

async function supabaseJson(fetchUrl, init = {}) {
  const response = await fetch(fetchUrl, init);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    throw Object.assign(new Error(body?.message || body?.hint || text || `HTTP ${response.status}`), {
      status: response.status,
      body,
    });
  }
  return body;
}

function tokenFrom(req) {
  return String(req.headers.authorization || req.headers["x-mcj-access-token"] || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
}

async function requireBoss(req) {
  const token = tokenFrom(req);
  if (!token) throw Object.assign(new Error("请先登录老板账号"), { status: 401 });
  const user = await supabaseJson(`${url()}/auth/v1/user`, {
    headers: anonHeaders({ Authorization: `Bearer ${token}` }),
  });
  const rows = await supabaseJson(rest("profiles", `?id=eq.${encodeURIComponent(user.id)}&limit=1`), {
    headers: serviceHeaders(),
  });
  const profile = rows?.[0];
  if (!profile || !hasBossRole(profile, { authUser: user })) {
    throw Object.assign(new Error("请使用老板账号操作"), { status: 403 });
  }
  if (profile.status !== "active") throw Object.assign(new Error("账号已停用"), { status: 403 });
  return profile;
}

export default async function handler(req, res) {
  if (!hasDb()) return json(res, 503, { ok: false, message: "数据库未配置" });
  try {
    const boss = await requireBoss(req);
    const body = req.method === "GET" ? {} : await parseBody(req);
    const action = String(
      req.method === "GET" ? req.query.action || "list" : body.action || "create"
    ).trim();

    if (req.method === "GET" && (action === "list" || action === "my_orders")) {
      const status = String(req.query.status || "").trim();
      const rows = await listBossGiftOrders(boss.id, { status });
      const orders = await enrichGiftOrders(rows);
      return json(res, 200, { ok: true, orders });
    }

    if (req.method === "GET" && (action === "get" || action === "detail")) {
      const id = String(req.query.id || req.query.orderId || "").trim();
      if (!id) return json(res, 400, { ok: false, message: "缺少订单 ID" });
      const row = await getGiftOrderById(id);
      if (!row || String(row.sender_boss_id) !== String(boss.id)) {
        return json(res, 404, { ok: false, message: "订单不存在" });
      }
      const proofUrl = await signedGiftProofUrl(row).catch(() => "");
      const payInfo = await resolveGiftPaymentInfo(row.payment_channel || "").catch(() => null);
      return json(res, 200, {
        ok: true,
        order: viewGiftOrder(row, { paymentProofUrl: proofUrl }),
        payInfo,
      });
    }

    if (req.method === "GET" && (action === "pay_info" || action === "payment_info")) {
      const channel = String(req.query.channel || req.query.paymentChannel || "").trim();
      const payInfo = await resolveGiftPaymentInfo(channel);
      return json(res, 200, { ok: true, payInfo });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return json(res, 405, { ok: false, message: "Method Not Allowed" });
    }

    if (action === "create" || action === "create_order") {
      const result = await createGiftOrder({
        bossId: boss.id,
        companionId: body.companionId || body.companion_id || body.receiverCompanionId,
        giftId: body.giftId || body.gift_id,
        quantity: body.quantity || 1,
        idempotencyKey: body.idempotencyKey || body.idempotency_key,
        paymentChannel: body.paymentChannel || body.payment_channel || "",
        clientNote: body.clientNote || body.note || "",
      });
      const payInfo =
        result.payInfo || (await resolveGiftPaymentInfo(result.order?.payment_channel || "").catch(() => null));
      return json(res, 200, {
        ok: true,
        message: result.replayed ? "订单已创建（防重复）" : "礼物订单已创建，请完成付款并上传截图",
        replayed: !!result.replayed,
        order: viewGiftOrder(result.order),
        payInfo,
      });
    }

    if (action === "upload_proof" || action === "submit_payment_proof") {
      const orderId = String(body.orderId || body.order_id || body.id || "").trim();
      const dataUrl = body.proofDataUrl || body.paymentProof || body.fileDataUrl || body.file || "";
      const result = await uploadGiftOrderProof({
        orderId,
        bossId: boss.id,
        dataUrl,
      });
      return json(res, 200, {
        ok: true,
        message: "付款凭证已提交，等待客服审核",
        order: viewGiftOrder(result.order, { paymentProofUrl: result.proofUrl || "" }),
        proofUrl: result.proofUrl || "",
      });
    }

    return json(res, 400, { ok: false, message: "未知操作" });
  } catch (error) {
    return json(res, error.status || 500, { ok: false, message: error.message || "接口异常" });
  }
}
