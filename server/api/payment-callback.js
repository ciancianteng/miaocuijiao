import {
  creditRechargePayment,
  envValue,
  isMissingRelation,
  money,
  restUrl,
  serviceHeaders,
  supabaseJson,
} from "./_wallet.js";

function json(res, status, data) {
  res.status(status).json(data);
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

function timingSafeEqual(a, b) {
  const left = String(a || "");
  const right = String(b || "");
  if (left.length !== right.length) return false;
  let out = 0;
  for (let i = 0; i < left.length; i += 1) out |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return out === 0;
}

async function loadMethodByCode(code) {
  const rows = await supabaseJson(restUrl("payment_methods", `?code=eq.${encodeURIComponent(code)}&limit=1`), {
    headers: serviceHeaders(),
  });
  return Array.isArray(rows) ? rows[0] : null;
}

async function loadPaymentOrder(paymentNo) {
  const rows = await supabaseJson(restUrl("payment_orders", `?payment_no=eq.${encodeURIComponent(paymentNo)}&limit=1`), {
    headers: serviceHeaders(),
  });
  return Array.isArray(rows) ? rows[0] : null;
}

/**
 * Payment provider server callback.
 * Credits wallet only after verifying order + optional callback secret.
 * Never trusts frontend "payment success" pages.
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { ok: false, message: "Method Not Allowed" });
  }
  if (!envValue("SUPABASE_URL") || !envValue("SUPABASE_SERVICE_ROLE_KEY")) {
    return json(res, 503, { ok: false, message: "未配置数据库，无法处理支付回调。" });
  }

  try {
    const body = await parseBody(req);
    const paymentNo = String(body.payment_no || body.paymentNo || body.order_no || body.merchant_order_no || "").trim();
    const status = String(body.status || body.payment_status || body.result || "").toLowerCase();
    const amount = money(body.amount || body.pay_amount || body.paid_amount);
    const tradeNo = String(body.trade_no || body.provider_trade_no || body.transaction_id || "").trim();
    const secret = String(req.headers["x-callback-secret"] || body.callback_secret || body.sign || "").trim();

    if (!paymentNo) return json(res, 400, { ok: false, message: "缺少 payment_no。" });

    const paidOk = /^(paid|success|successful|completed|ok|1)$/i.test(status) || body.success === true || body.paid === true;
    if (!paidOk) {
      return json(res, 200, { ok: true, credited: false, message: "非成功状态，未入账。" });
    }

    let order;
    try {
      order = await loadPaymentOrder(paymentNo);
    } catch (error) {
      if (isMissingRelation(error)) return json(res, 503, { ok: false, message: "payment_orders 未初始化。" });
      throw error;
    }
    if (!order) return json(res, 404, { ok: false, message: "充值订单不存在。" });

    if (order.credited_at || order.status === "paid") {
      return json(res, 200, { ok: true, credited: false, duplicate: true, message: "该充值订单已到账，忽略重复回调。" });
    }

    if (amount > 0 && Math.abs(amount - money(order.amount)) > 0.009) {
      return json(res, 400, { ok: false, message: "回调金额与订单金额不一致。" });
    }

    const method = await loadMethodByCode(order.payment_method).catch(() => null);
    const vercelEnv = String(process.env.VERCEL_ENV || "").toLowerCase();
    const nodeEnv = String(process.env.NODE_ENV || "").toLowerCase();
    // Production always requires callback secret. Preview/local: require when method has secret configured.
    const requireSecret =
      vercelEnv === "production" ||
      nodeEnv === "production" ||
      !!method?.callback_secret ||
      !!String(process.env.MCJ_PAYMENT_CALLBACK_SECRET || "").trim();
    if (requireSecret) {
      const expected =
        method?.callback_secret ||
        String(process.env.MCJ_PAYMENT_CALLBACK_SECRET || "").trim();
      if (!expected) {
        return json(res, 503, { ok: false, message: "支付渠道未配置回调密钥，拒绝入账。" });
      }
      if (!secret || !timingSafeEqual(secret, expected)) {
        return json(res, 401, { ok: false, message: "回调签名校验失败。" });
      }
    } else if (vercelEnv !== "preview" && nodeEnv === "production") {
      return json(res, 503, { ok: false, message: "支付回调密钥未配置，拒绝入账。" });
    }

    if (!tradeNo && vercelEnv === "production") {
      return json(res, 400, { ok: false, message: "正式环境回调必须提供支付交易号。" });
    }

    const result = await creditRechargePayment(paymentNo, tradeNo, `callback:${paymentNo}`);
    return json(res, 200, {
      ok: true,
      credited: !result?.duplicate,
      duplicate: !!result?.duplicate,
      message: result?.duplicate ? "重复回调，未再次入账。" : "充值猫粮已到账。",
      paymentNo,
    });
  } catch (error) {
    if (isMissingRelation(error)) {
      return json(res, 503, { ok: false, message: "请先执行 supabase/wallet-system.sql。" });
    }
    return json(res, error.status || 500, { ok: false, message: error.message || "支付回调处理失败。" });
  }
}
