/**
 * Admin Boss loyalty points settings.
 * Independent from companion popularity rules.
 */
import { requireAdmin } from "../_admin-auth.js";
import {
  DEFAULT_ORDER_COMPLETION_POINTS,
  getPointsSettingsRow,
  hasPointsDb,
  parseOrderCompletionPoints,
  viewPointsSettings,
} from "../_user-points.js";
import { isMissingRelation, restUrl, serviceHeaders, supabaseJson } from "../_wallet.js";

function json(res, status, data) {
  if (typeof res.setHeader === "function") {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
  }
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

async function ensureDefaultRow() {
  await supabaseJson(restUrl("points_settings"), {
    method: "POST",
    headers: serviceHeaders({ Prefer: "resolution=ignore-duplicates,return=representation" }),
    body: JSON.stringify({
      id: 1,
      order_completion_points: DEFAULT_ORDER_COMPLETION_POINTS,
    }),
  });
}

export default async function handler(req, res) {
  try {
    await requireAdmin(req);
  } catch (err) {
    return json(res, err.status || 403, { ok: false, message: err.message || "无权限" });
  }

  if (!hasPointsDb()) {
    return json(res, 503, { ok: false, message: "数据库未配置" });
  }

  try {
    if (req.method === "GET") {
      let row = null;
      try {
        row = await getPointsSettingsRow();
        if (!row) {
          await ensureDefaultRow();
          row = await getPointsSettingsRow();
        }
      } catch (error) {
        if (isMissingRelation(error)) {
          return json(res, 200, {
            ok: true,
            tablesReady: false,
            settings: viewPointsSettings(null),
            message: "积分设置表未初始化，请先执行 supabase/migrations/20260831_points_settings.sql",
          });
        }
        throw error;
      }
      return json(res, 200, {
        ok: true,
        tablesReady: true,
        settings: viewPointsSettings(row),
        message: "",
      });
    }

    if (req.method === "PUT" || req.method === "POST") {
      const body = await parseBody(req);
      const parsed = parseOrderCompletionPoints(
        body.orderCompletionPoints ?? body.order_completion_points
      );
      if (!parsed.ok) {
        return json(res, 400, { ok: false, message: parsed.message || "积分值不合法" });
      }

      let rows;
      try {
        await ensureDefaultRow();
        rows = await supabaseJson(restUrl("points_settings", "?id=eq.1"), {
          method: "PATCH",
          headers: serviceHeaders({ Prefer: "return=representation" }),
          body: JSON.stringify({
            order_completion_points: parsed.value,
            updated_at: new Date().toISOString(),
          }),
        });
      } catch (error) {
        if (isMissingRelation(error)) {
          return json(res, 503, {
            ok: false,
            message: "积分设置表未初始化，请先执行 supabase/migrations/20260831_points_settings.sql",
          });
        }
        throw error;
      }

      const row = Array.isArray(rows) ? rows[0] : rows;
      return json(res, 200, {
        ok: true,
        tablesReady: true,
        settings: viewPointsSettings(row || { id: 1, order_completion_points: parsed.value }),
        message: "积分设置已保存",
      });
    }

    res.setHeader("Allow", "GET, PUT, POST");
    return json(res, 405, { ok: false, message: "Method Not Allowed" });
  } catch (error) {
    const status = Number(error?.status) || 500;
    return json(res, status >= 400 && status < 600 ? status : 500, {
      ok: false,
      message: error?.message || "积分设置接口异常",
    });
  }
}
