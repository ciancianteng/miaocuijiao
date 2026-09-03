/**
 * Admin API — Boss levels (configurable upgrade/downgrade + manual pin).
 * Safeguards: reason required for manual set / clear-pin; pin permanent|until_expiry.
 */
import { requireAdmin } from "../_admin-auth.js";
import {
  clearBossLevelPin,
  ensureBossLevelsReady,
  getBossLevelByCode,
  getBossLevelProgress,
  listBossLevels,
  reevaluateBossLevel,
  setBossLevelManual,
  upsertBossLevel,
} from "../_boss-levels.js";
import { isMissingRelation } from "../_wallet.js";

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

function actionOf(req, body = {}) {
  const url = new URL(req.url || "/", "http://localhost");
  return String(body.action || req.query?.action || url.searchParams.get("action") || "")
    .trim()
    .toLowerCase();
}

export default async function handler(req, res) {
  let admin;
  try {
    admin = await requireAdmin(req);
  } catch (err) {
    return json(res, err.status || 403, { ok: false, message: err.message || "无权限" });
  }

  const body = req.method === "GET" ? {} : await parseBody(req);
  const action = actionOf(req, body) || (req.method === "GET" ? "list" : "");

  try {
    const ready = await ensureBossLevelsReady();
    if (!ready.ok && action !== "list") {
      return json(res, 503, {
        ok: false,
        tablesReady: false,
        message: ready.error || "boss_levels 表未初始化，请先执行 Staging migration 20260903",
      });
    }

    if (action === "list" || action === "levels") {
      if (!ready.ok) {
        return json(res, 200, {
          ok: true,
          tablesReady: false,
          levels: [],
          message: ready.error || "boss_levels 未就绪",
        });
      }
      const includeDisabled =
        String(body.includeDisabled || req.query?.includeDisabled || "1") !== "0";
      const levels = await listBossLevels({ includeDisabled });
      return json(res, 200, { ok: true, tablesReady: true, levels, message: "" });
    }

    if (action === "progress") {
      const url = new URL(req.url || "/", "http://localhost");
      const bossId = String(
        body.bossId || body.boss_id || req.query?.bossId || url.searchParams.get("bossId") || ""
      ).trim();
      if (!bossId) return json(res, 400, { ok: false, message: "缺少 bossId" });
      const prog = await getBossLevelProgress(bossId);
      return json(res, 200, { ok: true, ...prog });
    }

    if ((action === "upsert" || action === "save") && (req.method === "POST" || req.method === "PUT")) {
      const result = await upsertBossLevel(body.level || body, admin.id);
      return json(res, 200, { ok: true, ...result, message: "等级已保存（仅影响新结算，不改历史）" });
    }

    if (action === "set-level" && (req.method === "POST" || req.method === "PUT")) {
      let levelId = String(body.levelId || body.level_id || "").trim();
      const levelCode = String(body.levelCode || body.level_code || body.code || "").trim();
      if (!levelId && levelCode) {
        const lv = await getBossLevelByCode(levelCode);
        levelId = lv?.id || "";
      }
      const result = await setBossLevelManual({
        bossId: body.bossId || body.boss_id,
        levelId,
        operatorId: admin.id,
        reason: body.reason || "",
        pinMode: body.pinMode || body.pin_mode || "permanent",
        pinExpiresAt: body.pinExpiresAt || body.pin_expires_at || null,
        note: body.note || body.remark || "",
      });
      return json(res, 200, { ok: true, assignment: result, message: "已手动设置老板等级（需 reason）" });
    }

    if (action === "clear-pin" && (req.method === "POST" || req.method === "PUT")) {
      const result = await clearBossLevelPin({
        bossId: body.bossId || body.boss_id,
        operatorId: admin.id,
        reason: body.reason || "",
      });
      return json(res, 200, { ok: true, ...result, message: "已清除手动钉选并重新自动评级" });
    }

    if (action === "reevaluate" && (req.method === "POST" || req.method === "PUT")) {
      const result = await reevaluateBossLevel({
        bossId: body.bossId || body.boss_id,
        operatorId: admin.id,
        reason: body.reason || "admin_reevaluate",
        forceAuto: !!body.force,
      });
      return json(res, 200, { ok: true, ...result, message: result.skipped ? "未变更（可能仍在 pin）" : "已重评" });
    }

    return json(res, 400, {
      ok: false,
      message: "未知操作。支持：list/progress/upsert/set-level/clear-pin/reevaluate",
      action,
    });
  } catch (err) {
    if (isMissingRelation(err)) {
      return json(res, 200, {
        ok: false,
        tablesReady: false,
        message: "boss_levels 表未初始化，请先执行 Staging migration 20260903",
      });
    }
    return json(res, err.status || 500, { ok: false, message: err.message || "操作失败", code: err.code || "" });
  }
}
