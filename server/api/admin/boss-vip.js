/**
 * Admin · Boss VIP 等级（消费累计自动升级）
 * Independent from /api/admin/boss-levels (commission / 直属关系).
 */
import { requireAdmin } from "../_admin-auth.js";
import {
  applyBossVipBackfill,
  deleteVipLevel,
  ensureBossVipReady,
  listVipLevelsForAdmin,
  previewBossVipBackfill,
  recastAllBosses,
  recastBossVip,
  reorderVipLevels,
  setVipLevelActive,
  upsertVipLevel,
  viewVipLevel,
} from "../_boss-vip.js";

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
  try {
    await requireAdmin(req);
  } catch (err) {
    return json(res, err.status || 403, { ok: false, message: err.message || "无权限" });
  }

  const body = req.method === "GET" ? {} : await parseBody(req);
  const action = actionOf(req, body) || (req.method === "GET" ? "list" : "");

  try {
    if (action === "list" || action === "levels") {
      const out = await listVipLevelsForAdmin();
      return json(res, 200, out);
    }

    const ready = await ensureBossVipReady();
    if (!ready.ok) {
      return json(res, 200, {
        ok: false,
        tablesReady: false,
        message: ready.message || "Boss VIP 功能尚未初始化",
      });
    }

    if (action === "upsert" || action === "save") {
      const row = await upsertVipLevel(body.level || body.payload || body);
      await recastAllBosses({ notify: false, reason: "threshold_change" });
      return json(res, 200, { ok: true, message: "已保存 VIP 等级", level: viewVipLevel(row) });
    }

    if (action === "set_active" || action === "toggle") {
      const id = String(body.id || "").trim();
      if (!id) return json(res, 400, { ok: false, message: "缺少等级" });
      const raw = body.isActive ?? body.is_active ?? body.active;
      const active = raw !== false && raw !== 0 && raw !== "0" && raw !== "false";
      const row = await setVipLevelActive(id, active);
      await recastAllBosses({ notify: false, reason: "threshold_change" });
      return json(res, 200, {
        ok: true,
        message: active ? "已启用" : "已停用",
        level: viewVipLevel(row),
      });
    }

    if (action === "delete" || action === "remove") {
      const id = String(body.id || "").trim();
      if (!id) return json(res, 400, { ok: false, message: "缺少等级" });
      const result = await deleteVipLevel(id);
      await recastAllBosses({ notify: false, reason: "threshold_change" });
      return json(res, 200, { ok: true, message: "已删除未使用等级", ...result });
    }

    if (action === "reorder") {
      const ids = Array.isArray(body.ids) ? body.ids : [];
      const rows = await reorderVipLevels(ids);
      return json(res, 200, { ok: true, message: "已更新排序", levels: rows.map((row) => viewVipLevel(row)) });
    }

    if (action === "recast" || action === "recast_boss") {
      const bossId = String(body.bossId || body.boss_id || "").trim();
      if (!bossId) return json(res, 400, { ok: false, message: "缺少老板" });
      const result = await recastBossVip(bossId, { notify: false, reason: "admin_recast" });
      return json(res, 200, { ok: true, message: "已重新计算", result });
    }

    if (action === "recast_all") {
      const result = await recastAllBosses({ notify: false, reason: "threshold_change" });
      return json(res, 200, { ok: true, message: `已重新计算 ${result.count} 位老板`, ...result });
    }

    if (action === "backfill_preview") {
      const preview = await previewBossVipBackfill();
      return json(res, 200, preview);
    }

    if (action === "backfill_apply") {
      const result = await applyBossVipBackfill({ notify: false });
      return json(res, 200, { ok: true, message: `已回填 ${result.count} 位老板`, ...result });
    }

    return json(res, 400, { ok: false, message: "未知操作" });
  } catch (err) {
    return json(res, err.status || 500, { ok: false, message: err.message || "Boss VIP 接口异常" });
  }
}
