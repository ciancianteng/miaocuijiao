/**
 * Admin Boss loyalty points settings (猫粮 spend × rate + refund debt).
 * Independent from companion popularity rules.
 */
import { requireAdmin } from "../_admin-auth.js";
import {
  DEFAULT_ORDER_COMPLETION_POINTS,
  defaultBossPointsSettings,
  getPointsSettingsRow,
  hasPointsDb,
  normalizeRoundingMode,
  parseNonNegNumber,
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

function parseEnabled(raw) {
  if (raw === true || raw === 1 || raw === "1" || raw === "true" || raw === "on") return true;
  if (raw === false || raw === 0 || raw === "0" || raw === "false" || raw === "off") return false;
  return null;
}

async function ensureDefaultRow() {
  const defaults = defaultBossPointsSettings();
  await supabaseJson(restUrl("points_settings"), {
    method: "POST",
    headers: serviceHeaders({ Prefer: "resolution=ignore-duplicates,return=representation" }),
    body: JSON.stringify({
      id: 1,
      order_completion_points: DEFAULT_ORDER_COMPLETION_POINTS,
      enabled: defaults.enabled,
      points_per_cat_food: defaults.pointsPerCatFood,
      min_order_cat_food: defaults.minOrderCatFood,
      max_reward_points: defaults.maxRewardPoints,
      rounding_mode: defaults.roundingMode,
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
            settings: defaultBossPointsSettings(),
            message:
              "积分设置表未初始化，请先执行 supabase/migrations/20260831_points_settings.sql 与 20260831_points_settings_rate.sql",
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

      const enabledRaw = body.enabled ?? body.orderPointsEnabled;
      const enabled = parseEnabled(enabledRaw);
      if (enabledRaw != null && enabled === null) {
        return json(res, 400, { ok: false, message: "启用开关不合法。" });
      }

      const perCat = parseNonNegNumber(
        body.pointsPerCatFood ??
          body.points_per_cat_food ??
          body.pointsPerRm ??
          body.points_per_rm ??
          body.pointsPerRM,
        { fieldLabel: "每消费 1 猫粮获得积分" }
      );
      if (!perCat.ok) return json(res, 400, { ok: false, message: perCat.message });

      const minAmt = parseNonNegNumber(
        body.minOrderCatFood ?? body.min_order_cat_food ?? body.minOrderAmount ?? body.min_order_amount,
        { fieldLabel: "每单最低消费猫粮" }
      );
      if (!minAmt.ok) return json(res, 400, { ok: false, message: minAmt.message });

      const maxPts = parseNonNegNumber(body.maxRewardPoints ?? body.max_reward_points, {
        integer: true,
        fieldLabel: "每单最高奖励积分",
      });
      if (!maxPts.ok) return json(res, 400, { ok: false, message: maxPts.message });

      const roundingMode = normalizeRoundingMode(body.roundingMode ?? body.rounding_mode);
      if (
        body.roundingMode != null &&
        !["floor", "ceil", "round"].includes(String(body.roundingMode).trim().toLowerCase())
      ) {
        return json(res, 400, { ok: false, message: "小数积分处理方式不合法（floor/ceil/round）。" });
      }

      let rows;
      try {
        await ensureDefaultRow();
        const patch = {
          enabled: enabled == null ? true : enabled,
          points_per_cat_food: perCat.value,
          min_order_cat_food: minAmt.value,
          max_reward_points: maxPts.value,
          rounding_mode: roundingMode,
          updated_at: new Date().toISOString(),
        };
        rows = await supabaseJson(restUrl("points_settings", "?id=eq.1"), {
          method: "PATCH",
          headers: serviceHeaders({ Prefer: "return=representation" }),
          body: JSON.stringify(patch),
        });
      } catch (error) {
        if (isMissingRelation(error)) {
          return json(res, 503, {
            ok: false,
            message:
              "积分设置表未初始化，请先执行 supabase/migrations/20260831_points_settings.sql 与 20260831_points_settings_rate.sql",
          });
        }
        if (/points_per_cat_food|schema cache|Could not find/i.test(String(error?.message || ""))) {
          return json(res, 503, {
            ok: false,
            message: "请先在 Staging 执行 supabase/migrations/20260831_points_settings_rate.sql（猫粮计分 + 积分欠款版）",
          });
        }
        throw error;
      }

      const row = Array.isArray(rows) ? rows[0] : rows;
      return json(res, 200, {
        ok: true,
        tablesReady: true,
        settings: viewPointsSettings(row),
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
