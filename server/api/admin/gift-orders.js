import {
  listReviewGiftOrders,
  enrichGiftOrders,
  getGiftOrderById,
  signedGiftProofUrl,
  viewGiftOrder,
} from "../_gift-orders.js";

function json(res, status, data) {
  return res.status(status).json(data);
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
  try {
    await (await import("../_admin-auth.js")).requireAdmin(req);
  } catch (err) {
    return json(res, err.status || 403, { ok: false, message: err.message || "无权限" });
  }

  try {
    if (req.method === "GET") {
      const status = String(req.query.status || "all").trim();
      const rows = await listReviewGiftOrders({ status, limit: 200 });
      const orders = await enrichGiftOrders(rows);
      return json(res, 200, { ok: true, orders });
    }

    if (req.method === "POST") {
      const body = await parseBody(req);
      const action = String(body.action || "").trim();
      if (action === "get" || action === "detail") {
        const id = String(body.id || body.orderId || "").trim();
        const row = await getGiftOrderById(id);
        if (!row) return json(res, 404, { ok: false, message: "订单不存在" });
        const proofUrl = await signedGiftProofUrl(row).catch(() => "");
        return json(res, 200, { ok: true, order: viewGiftOrder(row, { paymentProofUrl: proofUrl }) });
      }
      return json(res, 400, { ok: false, message: "未知操作" });
    }

    res.setHeader("Allow", "GET, POST");
    return json(res, 405, { ok: false, message: "Method Not Allowed" });
  } catch (error) {
    return json(res, error.status || 500, { ok: false, message: error.message || "接口异常" });
  }
}
