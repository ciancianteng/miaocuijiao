import { randomUUID } from "node:crypto";
import {
  readLocalTags,
  writeLocalTags,
  updateLocalTags,
  normalizeTagRow,
  toPublicTag,
  getCompanionTagsTableStatus,
} from "../_companion-tags-store.js";
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

function tableNotReadyResponse(status) {
  return {
    ok: true,
    items: [],
    tags: [],
    source: status?.reason || "unavailable",
    tableReady: false,
    message: "标签表未就绪。生产管理页不提供 SQL 迁移入口，请由运维在内部执行 companion-tags 迁移脚本。",
  };
}

export default async function handler(req, res) {
  try {
    if (!(await requireAdmin(req, res))) return;

    if (req.method === "GET") {
      const status = await getCompanionTagsTableStatus();
      if (!status.ready) {
        return json(res, 200, tableNotReadyResponse(status));
      }
      const tags = await readLocalTags({ preferDb: true, allowSeed: false });
      return json(res, 200, {
        ok: true,
        items: tags.map(toPublicTag),
        tags: tags.map(toPublicTag),
        source: "db",
        tableReady: true,
        message: "已从数据库加载标签",
      });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return json(res, 405, { ok: false, message: "Method Not Allowed" });
    }

    const body = await parseBody(req);
    const action = String(body.action || "save").trim();

    // Migration / SQL tooling is internal-only — never expose via admin API.
    if (action === "ensure_schema" || action === "ensure" || action === "migrate") {
      return json(res, 403, {
        ok: false,
        message: "管理后台不支持 SQL 迁移。请使用内部迁移脚本。",
      });
    }

    if (action === "list") {
      const status = await getCompanionTagsTableStatus();
      if (!status.ready) return json(res, 200, tableNotReadyResponse(status));
      const tags = await readLocalTags({ preferDb: true, allowSeed: false });
      return json(res, 200, { ok: true, items: tags.map(toPublicTag), tableReady: true, source: "db" });
    }

    const status = await getCompanionTagsTableStatus();
    if (!status.ready) {
      return json(res, 503, {
        ok: false,
        tableReady: false,
        message: "标签表未就绪，无法写入。请联系运维完成内部迁移。",
      });
    }

    if (action === "create" || action === "save") {
      const draft = (body.payload && body.payload.draft) || body.tag || body.payload || {};
      const id = String(body.id || draft.id || "").trim();
      const result = await updateLocalTags(async (list) => {
        const row = normalizeTagRow(
          {
            ...draft,
            name: draft.name || (body.payload && body.payload.title) || "",
            enabled: body.payload ? body.payload.enabled !== false : draft.enabled !== false,
            id: id || randomUUID(),
          },
          list.length
        );
        if (!row.name) throw Object.assign(new Error("请填写标签名称。"), { status: 400 });
        const dup = list.find(
          (item) =>
            String(item.id) !== String(row.id) &&
            String(item.name || "").trim().toLowerCase() === String(row.name || "").trim().toLowerCase()
        );
        if (dup) throw Object.assign(new Error("已存在同名标签。"), { status: 400 });
        const index = list.findIndex((item) => String(item.id) === String(row.id));
        if (index >= 0) list[index] = row;
        else list.push(row);
        return { tag: row };
      }, { requireDb: true });
      return json(res, 200, {
        ok: true,
        message: "标签已保存",
        item: toPublicTag(result.tag),
        items: (await readLocalTags({ preferDb: true, allowSeed: false })).map(toPublicTag),
        tableReady: true,
        source: "db",
      });
    }

    if (action === "delete") {
      const id = String(body.id || "").trim();
      if (!id) return json(res, 400, { ok: false, message: "缺少标签 ID。" });
      await updateLocalTags(async (list) => {
        const next = list.filter((item) => String(item.id) !== id);
        list.splice(0, list.length, ...next);
        return {};
      }, { requireDb: true });
      return json(res, 200, {
        ok: true,
        message: "标签已删除",
        items: (await readLocalTags({ preferDb: true, allowSeed: false })).map(toPublicTag),
        tableReady: true,
      });
    }

    if (action === "publish" || action === "enable") {
      const id = String(body.id || "").trim();
      await updateLocalTags(async (list) => {
        const item = list.find((row) => String(row.id) === id);
        if (item) item.enabled = true;
        return {};
      }, { requireDb: true });
      return json(res, 200, {
        ok: true,
        message: "已启用",
        items: (await readLocalTags({ preferDb: true, allowSeed: false })).map(toPublicTag),
      });
    }

    if (action === "disable" || action === "unpublish") {
      const id = String(body.id || "").trim();
      await updateLocalTags(async (list) => {
        const item = list.find((row) => String(row.id) === id);
        if (item) item.enabled = false;
        return {};
      }, { requireDb: true });
      return json(res, 200, {
        ok: true,
        message: "已停用",
        items: (await readLocalTags({ preferDb: true, allowSeed: false })).map(toPublicTag),
      });
    }

    if (action === "save_all") {
      const tags = await writeLocalTags(Array.isArray(body.tags) ? body.tags : [], { requireDb: true });
      return json(res, 200, { ok: true, message: "标签已全部保存", items: tags.map(toPublicTag) });
    }

    return json(res, 400, { ok: false, message: "未知操作。" });
  } catch (error) {
    return json(res, error.status || 500, { ok: false, message: error.message || "陪玩标签接口异常" });
  }
}
