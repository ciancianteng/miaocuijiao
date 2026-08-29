/**
 * Admin points — view real user_points / point_transactions; manual adjust writes ledger.
 */
import { requireAdmin } from "../_admin-auth.js";
import {
  adminAdjustPoints,
  getUserPoints,
  hasPointsDb,
  listPointTransactions,
  viewPointTx,
  viewPoints,
} from "../_points.js";
import { isMissingRelation, money, restUrl, serviceHeaders, supabaseJson } from "../_wallet.js";

const ADMIN_ROLES = new Set(["admin", "super_admin", "finance_admin"]);

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

export default async function handler(req, res) {
  let adminProfile;
  try {
    adminProfile = await requireAdmin(req, { allowRoles: ADMIN_ROLES });
  } catch (err) {
    return json(res, err.status || 403, { ok: false, message: err.message || "没有积分管理权限" });
  }
  if (!hasPointsDb()) return json(res, 503, { ok: false, message: "未配置数据库" });

  try {
    if (req.method === "GET") {
      const userId = String(req.query.userId || req.query.user_id || req.query.bossId || req.query.boss_id || "").trim();
      const action = String(req.query.action || "summary").trim().toLowerCase();

      if (action === "list_recent" || action === "recent") {
        const limit = Math.max(1, Math.min(300, Number(req.query.limit || 100)));
        let rows = [];
        try {
          rows = await supabaseJson(
            restUrl("point_transactions", `?order=created_at.desc&limit=${limit}`),
            { headers: serviceHeaders() }
          );
        } catch (e) {
          if (isMissingRelation(e)) rows = [];
          else throw e;
        }
        return json(res, 200, { ok: true, items: (Array.isArray(rows) ? rows : []).map(viewPointTx) });
      }

      if (!userId) return json(res, 400, { ok: false, message: "请提供 userId / bossId" });

      const points = viewPoints(await getUserPoints(userId), userId);
      if (action === "transactions" || action === "ledger" || action === "history") {
        const rows = await listPointTransactions(userId, {
          limit: Number(req.query.limit || 100),
          type: String(req.query.type || "").trim(),
        });
        return json(res, 200, { ok: true, points, items: rows.map(viewPointTx) });
      }

      return json(res, 200, { ok: true, points });
    }

    if (req.method === "POST") {
      const body = await parseBody(req);
      const action = String(body.action || "").trim().toLowerCase();
      const userId = String(body.userId || body.user_id || body.bossId || body.boss_id || "").trim();
      if (!userId) return json(res, 400, { ok: false, message: "请提供 userId / bossId" });

      if (action === "adjust" || action === "grant" || action === "deduct") {
        let delta = money(body.points ?? body.amount);
        if (action === "deduct") delta = -Math.abs(delta);
        if (action === "grant") delta = Math.abs(delta);
        if (!delta) return json(res, 400, { ok: false, message: "调整积分不能为 0" });
        const description = String(body.description || body.reason || "").trim();
        if (!description) return json(res, 400, { ok: false, message: "请填写调整原因" });

        const result = await adminAdjustPoints({
          userId,
          points: delta,
          description,
          operatorId: adminProfile.id,
        });
        const points = viewPoints(await getUserPoints(userId), userId);
        return json(res, 200, {
          ok: true,
          message: delta > 0 ? "已增加积分" : "已扣除积分",
          result,
          points,
        });
      }

      return json(res, 400, { ok: false, message: "未知操作" });
    }

    return json(res, 405, { ok: false, message: "Method not allowed" });
  } catch (error) {
    if (isMissingRelation(error)) {
      return json(res, 503, {
        ok: false,
        message: "积分表尚未创建，请先执行 supabase/migrations/20260829_user_points_system.sql",
      });
    }
    return json(res, error.status || 500, { ok: false, message: error.message || "积分操作失败" });
  }
}
