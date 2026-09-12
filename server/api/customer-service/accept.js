/**
 * POST /api/customer-service/accept
 * Thin route → same reception logic as action=take_conversation.
 */
import handler from "../customer-service.js";

export default async function acceptHandler(req, res) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, message: "Method Not Allowed" }));
    return;
  }
  const body = req.body && typeof req.body === "object" ? req.body : {};
  req.body = Object.assign({}, body, { action: "accept" });
  return handler(req, res);
}
