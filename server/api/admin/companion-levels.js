import {
  DEFAULT_LEVELS,
  normalizeLevelRow,
  readLocalLevels,
  writeLocalLevels,
  updateLocalLevels,
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

export default async function handler(req, res) {
  try {
    if (!requireAdmin(req, res)) return;

    if (req.method === "GET") {
      const levels = await readLocalLevels();
      return json(res, 200, {
        ok: true,
        source: "local",
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

    if (action === "save_all" || action === "save") {
      const incoming = Array.isArray(body.levels) ? body.levels : [];
      if (!incoming.length) return json(res, 400, { ok: false, message: "请提交等级列表。" });
      const levels = await writeLocalLevels(incoming.map((row, index) => normalizeLevelRow(row, index)));
      return json(res, 200, { ok: true, message: "陪玩等级已保存，全站将同步读取。", levels: levels.map(toPublicLevel), source: "local" });
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
      return json(res, 200, { ok: true, message: "已新增等级", level: toPublicLevel(created.level), source: "local" });
    }

    if (action === "delete") {
      const id = String(body.id || "").trim();
      if (!id) return json(res, 400, { ok: false, message: "缺少等级 ID。" });
      const levels = await updateLocalLevels(async (list) => {
        const next = list.filter((row) => String(row.id) !== id);
        if (next.length === list.length) throw Object.assign(new Error("等级不存在。"), { status: 404 });
        list.splice(0, list.length, ...next);
        return { levels: list };
      });
      return json(res, 200, { ok: true, message: "已删除等级", levels: (await readLocalLevels()).map(toPublicLevel), source: "local" });
    }

    if (action === "reorder") {
      const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
      if (!ids.length) return json(res, 400, { ok: false, message: "缺少排序列表。" });
      const levels = await updateLocalLevels(async (list) => {
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
      return json(res, 200, { ok: true, message: "排序已更新", levels: (await readLocalLevels()).map(toPublicLevel), source: "local" });
    }

    return json(res, 400, { ok: false, message: "未知操作。" });
  } catch (error) {
    return json(res, error.status || 500, { ok: false, message: error.message || "陪玩等级接口异常" });
  }
}
