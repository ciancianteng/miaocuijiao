import { randomUUID } from "node:crypto";
import {
  readCertTags,
  updateCertTags,
  normalizeCertTag,
  toPublicCertTag,
} from "../_companion-cert-tags-store.js";
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

export default async function handler(req, res) {
  try {
    if (!(await requireAdmin(req, res))) return;

    if (req.method === "GET") {
      const tags = await readCertTags();
      return json(res, 200, {
        ok: true,
        items: tags.map(toPublicCertTag),
        tags: tags.map(toPublicCertTag),
      });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return json(res, 405, { ok: false, message: "Method Not Allowed" });
    }

    const body = await parseBody(req);
    const action = String(body.action || "save").trim();

    if (action === "list") {
      const tags = await readCertTags();
      return json(res, 200, { ok: true, items: tags.map(toPublicCertTag) });
    }

    if (action === "create" || action === "save") {
      const draft = (body.payload && body.payload.draft) || body.tag || body.payload || {};
      const id = String(body.id || draft.id || "").trim();
      const result = await updateCertTags(async (list) => {
        const row = normalizeCertTag(
          {
            ...draft,
            name: draft.name || "",
            icon: draft.icon || "🏷️",
            color: draft.color || "#ff6b9d",
            sort: draft.sort != null ? draft.sort : list.length + 1,
            enabled: draft.enabled !== false,
            id: id || randomUUID(),
          },
          list.length
        );
        if (!row.name) throw Object.assign(new Error("请填写标签名称。"), { status: 400 });
        const index = list.findIndex((item) => String(item.id) === String(row.id));
        if (index >= 0) list[index] = row;
        else list.push(row);
        return { tag: row };
      });
      return json(res, 200, {
        ok: true,
        message: "认证标签已保存",
        item: toPublicCertTag(result.tag),
        items: (await readCertTags()).map(toPublicCertTag),
      });
    }

    if (action === "delete") {
      const id = String(body.id || "").trim();
      if (!id) return json(res, 400, { ok: false, message: "缺少标签 ID。" });
      await updateCertTags(async (list) => {
        const next = list.filter((item) => String(item.id) !== id);
        list.splice(0, list.length, ...next);
        return {};
      });
      return json(res, 200, {
        ok: true,
        message: "认证标签已删除",
        items: (await readCertTags()).map(toPublicCertTag),
      });
    }

    if (action === "enable" || action === "publish") {
      const id = String(body.id || "").trim();
      await updateCertTags(async (list) => {
        const item = list.find((row) => String(row.id) === id);
        if (item) item.enabled = true;
        return {};
      });
      return json(res, 200, { ok: true, message: "已启用", items: (await readCertTags()).map(toPublicCertTag) });
    }

    if (action === "disable" || action === "unpublish") {
      const id = String(body.id || "").trim();
      await updateCertTags(async (list) => {
        const item = list.find((row) => String(row.id) === id);
        if (item) item.enabled = false;
        return {};
      });
      return json(res, 200, { ok: true, message: "已停用", items: (await readCertTags()).map(toPublicCertTag) });
    }

    return json(res, 400, { ok: false, message: "未知操作" });
  } catch (error) {
    return json(res, error.status || 500, { ok: false, message: error.message || "认证标签接口异常" });
  }
}
