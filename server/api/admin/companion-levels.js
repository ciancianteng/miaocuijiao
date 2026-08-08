import {
  DEFAULT_LEVELS,
  normalizeLevelRow,
  readLocalLevels,
  writeLocalLevels,
  updateLocalLevels,
  upsertLocalLevel,
  syncCompanionCommissionsFromLevels,
  buildPublishSyncChecklist,
  toPublicLevel,
} from "../_companion-levels-store.js";

import { requireAdmin as requireAdminJwt } from "../_admin-auth.js";

const ADMIN_ROLES = new Set(["admin", "super_admin"]);

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

async function requireAdmin(req, res) {
  try {
    await requireAdminJwt(req, { allowRoles: ADMIN_ROLES });
    return true;
  } catch (err) {
    json(res, err.status || 401, { ok: false, message: err.message || "请先登录管理员账号。" });
    return false;
  }
}

function nextLevelNumber(list) {
  const max = list.reduce((acc, item) => Math.max(acc, Number(item.level) || 0), 0);
  return max + 1;
}

function verifyPublished(levels, expected) {
  const got = (Array.isArray(levels) ? levels : []).map((row) => normalizeLevelRow(row));
  const want = (Array.isArray(expected) ? expected : []).map((row) => normalizeLevelRow(row));
  if (!want.length) return { ok: false, message: "发布列表为空。" };
  if (got.length !== want.length) {
    return { ok: false, message: `校验失败：期望 ${want.length} 个等级，实际 ${got.length} 个。` };
  }
  for (const item of want) {
    const match = got.find((row) => String(row.id) === String(item.id));
    if (!match) return { ok: false, message: `校验失败：缺少等级 ${item.code || item.id}。` };
    if (Number(match.min) !== Number(item.min) || Number(match.max) !== Number(item.max)) {
      return { ok: false, message: `校验失败：${item.code} 价格区间未写入。` };
    }
    if (Number(match.commissionRate) !== Number(item.commissionRate)) {
      return { ok: false, message: `校验失败：${item.code} 抽成未写入。` };
    }
    if (String(match.badgeBorder || "").toLowerCase() !== String(item.badgeBorder || "").toLowerCase()) {
      return { ok: false, message: `校验失败：${item.code} 徽章边框色未写入。` };
    }
  }
  return { ok: true };
}

export default async function handler(req, res) {
  try {
    if (!requireAdmin(req, res)) return;

    if (req.method === "GET") {
      const levels = await readLocalLevels();
      return json(res, 200, {
        ok: true,
        source: "companion_levels",
        levels: levels.map(toPublicLevel),
        defaults: DEFAULT_LEVELS.map((row) => toPublicLevel(row)),
      });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return json(res, 405, { ok: false, message: "Method Not Allowed" });
    }

    const body = await parseBody(req);
    const action = String(body.action || "save_all").trim();

    if (action === "save_one" || action === "save_current") {
      const incoming = body.level || body.payload || null;
      if (!incoming || typeof incoming !== "object") {
        return json(res, 400, { ok: false, message: "请提交当前等级数据。" });
      }
      const levels = await upsertLocalLevel(incoming);
      const saved = levels.find((row) => String(row.id) === String(normalizeLevelRow(incoming).id));
      return json(res, 200, {
        ok: true,
        message: "当前等级已保存。点击「发布到全站」后各端立即读取最新配置。",
        level: saved ? toPublicLevel(saved) : null,
        levels: levels.map(toPublicLevel),
        published: false,
        source: "companion_levels",
      });
    }

    if (action === "publish" || action === "publish_all") {
      const incoming = Array.isArray(body.levels) ? body.levels : [];
      if (!incoming.length) return json(res, 400, { ok: false, message: "请提交等级列表。" });
      const normalized = incoming.map((row, index) => normalizeLevelRow(row, index));
      let levels;
      try {
        levels = await writeLocalLevels(normalized);
      } catch (error) {
        const checklist = buildPublishSyncChecklist({ verified: false, error: error.message || "写入失败" });
        return json(res, 500, {
          ok: false,
          message: `发布失败：${error.message || "写入等级配置失败"}`,
          checklist,
          sync: checklist,
        });
      }

      const verify = verifyPublished(levels, normalized);
      if (!verify.ok) {
        const checklist = buildPublishSyncChecklist({ verified: false, error: verify.message });
        return json(res, 500, {
          ok: false,
          message: verify.message || "发布后校验失败",
          checklist,
          sync: checklist,
          levels: levels.map(toPublicLevel),
        });
      }

      let commission = { ok: true, updated: 0, skipped: 0, errors: [] };
      if (body.syncCommission !== false) {
        try {
          commission = await syncCompanionCommissionsFromLevels(levels);
        } catch (error) {
          commission = { ok: false, updated: 0, errors: [error.message || "抽成同步失败"] };
        }
      }

      const checklist = buildPublishSyncChecklist({ verified: true, commission });
      const commissionFailed = commission && commission.ok === false && !(commission.skipped > 0);
      if (commissionFailed) {
        return json(res, 207, {
          ok: false,
          message: `等级已写入，但抽成同步失败：${(commission.errors && commission.errors[0]) || "未知错误"}`,
          checklist,
          sync: checklist,
          commission,
          levels: levels.map(toPublicLevel),
          published: true,
          publishedAt: new Date().toISOString(),
        });
      }

      return json(res, 200, {
        ok: true,
        message: "已同步全站",
        checklist,
        sync: checklist,
        commission,
        levels: levels.map(toPublicLevel),
        published: true,
        publishedAt: new Date().toISOString(),
        source: "companion_levels",
      });
    }

    if (action === "save_all" || action === "save") {
      const incoming = Array.isArray(body.levels) ? body.levels : [];
      if (!incoming.length) return json(res, 400, { ok: false, message: "请提交等级列表。" });
      const levels = await writeLocalLevels(incoming.map((row, index) => normalizeLevelRow(row, index)));
      return json(res, 200, {
        ok: true,
        message: "陪玩等级已保存。建议使用「发布到全站」完成抽成同步与校验。",
        levels: levels.map(toPublicLevel),
        published: false,
        source: "companion_levels",
      });
    }

    if (action === "create") {
      const created = await updateLocalLevels(async (list) => {
        const levelNo = nextLevelNumber(list);
        const row = normalizeLevelRow({
          ...(body.level || body.payload || {}),
          id: `lv${levelNo}`,
          level: levelNo,
          code: `Lv${levelNo}`,
          name: String((body.level && body.level.name) || (body.payload && body.payload.name) || `等级${levelNo}`),
          sort: list.length + 1,
        }, list.length);
        list.push(row);
        return { level: row };
      });
      return json(res, 200, { ok: true, message: "已新增等级", level: toPublicLevel(created.level), source: "companion_levels" });
    }

    if (action === "delete") {
      const id = String(body.id || "").trim();
      if (!id) return json(res, 400, { ok: false, message: "缺少等级 ID。" });
      await updateLocalLevels(async (list) => {
        const next = list.filter((row) => String(row.id) !== id);
        if (next.length === list.length) throw Object.assign(new Error("等级不存在。"), { status: 404 });
        list.splice(0, list.length, ...next);
        return { levels: list };
      });
      return json(res, 200, { ok: true, message: "已删除等级", levels: (await readLocalLevels()).map(toPublicLevel), source: "companion_levels" });
    }

    if (action === "reorder") {
      const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
      if (!ids.length) return json(res, 400, { ok: false, message: "缺少排序列表。" });
      await updateLocalLevels(async (list) => {
        const map = new Map(list.map((row) => [String(row.id), row]));
        const ordered = ids.map((id, index) => {
          const row = map.get(id);
          if (!row) return null;
          row.sort = index + 1;
          return row;
        }).filter(Boolean);
        const rest = list.filter((row) => !ids.includes(String(row.id)));
        list.splice(0, list.length, ...ordered, ...rest.map((row, index) => {
          row.sort = ordered.length + index + 1;
          return row;
        }));
        return { levels: list };
      });
      return json(res, 200, { ok: true, message: "排序已更新", levels: (await readLocalLevels()).map(toPublicLevel), source: "companion_levels" });
    }

    return json(res, 400, { ok: false, message: "未知操作。" });
  } catch (error) {
    return json(res, error.status || 500, { ok: false, message: error.message || "陪玩等级接口异常" });
  }
}
