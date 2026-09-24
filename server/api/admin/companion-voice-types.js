import { randomUUID } from "node:crypto";
import {
  readVoiceTypes,
  updateVoiceTypes,
  normalizeVoiceType,
  toPublicVoiceType,
  splitVoiceTypeNames,
} from "../_companion-voice-types-store.js";
import { requireAdmin as requireAdminJwt } from "../_admin-auth.js";

const ADMIN_ROLES = new Set(["admin", "super_admin"]);

function env(key) {
  if (key === "SUPABASE_URL") return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  return process.env[key] || "";
}

function json(res, status, data) {
  res.status(status).json(data);
}

async function countCompanionsUsingVoiceName(name) {
  const label = String(name || "").trim();
  if (!label) return 0;
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return 0;
  try {
    const endpoint =
      url.replace(/\/$/, "") +
      "/rest/v1/companion_profiles?select=id,voice_type&voice_type=not.is.null&voice_type=neq.&limit=2000";
    const response = await fetch(endpoint, {
      headers: {
        apikey: key,
        Authorization: "Bearer " + key,
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      console.warn("[voice-types] usage scan HTTP", response.status);
      return 0;
    }
    const data = await response.json().catch(() => []);
    const needle = label.toLowerCase();
    return (Array.isArray(data) ? data : []).filter((row) =>
      splitVoiceTypeNames(row.voice_type).some((n) => String(n).toLowerCase() === needle)
    ).length;
  } catch (err) {
    console.warn("[voice-types] usage scan exception", err?.message || err);
    return 0;
  }
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
      const items = await readVoiceTypes();
      return json(res, 200, {
        ok: true,
        items: items.map(toPublicVoiceType),
        voiceTypes: items.map(toPublicVoiceType),
      });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return json(res, 405, { ok: false, message: "Method Not Allowed" });
    }

    const body = await parseBody(req);
    const action = String(body.action || "save").trim();

    if (action === "list") {
      const items = await readVoiceTypes();
      return json(res, 200, { ok: true, items: items.map(toPublicVoiceType) });
    }

    if (action === "create" || action === "save") {
      const draft = (body.payload && body.payload.draft) || body.voiceType || body.tag || body.payload || {};
      const id = String(body.id || draft.id || "").trim();
      const result = await updateVoiceTypes(async (list) => {
        const row = normalizeVoiceType(
          {
            ...draft,
            name: draft.name || "",
            description: draft.description || "",
            sort: draft.sort != null ? draft.sort : list.length + 1,
            enabled: draft.enabled !== false,
            id: id || randomUUID(),
          },
          list.length
        );
        if (!row.name) throw Object.assign(new Error("请填写声线名称。"), { status: 400 });
        const dup = list.find(
          (item) =>
            String(item.id) !== String(row.id) &&
            String(item.name || "").toLowerCase() === row.name.toLowerCase()
        );
        if (dup) throw Object.assign(new Error("声线名称已存在。"), { status: 400 });
        const index = list.findIndex((item) => String(item.id) === String(row.id));
        if (index >= 0) list[index] = row;
        else list.push(row);
        return { item: row };
      });
      return json(res, 200, {
        ok: true,
        message: "声线已保存，陪玩端选项将立即同步",
        item: toPublicVoiceType(result.item),
        items: (await readVoiceTypes()).map(toPublicVoiceType),
      });
    }

    if (action === "delete") {
      const id = String(body.id || "").trim();
      if (!id) return json(res, 400, { ok: false, message: "缺少声线 ID。" });
      const items = await readVoiceTypes();
      const target = items.find((item) => String(item.id) === id);
      if (!target) return json(res, 404, { ok: false, message: "声线不存在。" });
      const usage = await countCompanionsUsingVoiceName(target.name);
      if (usage > 0) {
        return json(res, 409, {
          ok: false,
          code: "VOICE_TYPE_IN_USE",
          usageCount: usage,
          message:
            "已有 " +
            usage +
            " 位陪玩使用该声线，不能直接删除。请先在陪玩资料中迁移/改掉该声线，或改为「停用」。",
        });
      }
      await updateVoiceTypes(async (list) => {
        const next = list.filter((item) => String(item.id) !== id);
        list.splice(0, list.length, ...next);
        return {};
      });
      return json(res, 200, {
        ok: true,
        message: "声线已删除",
        items: (await readVoiceTypes()).map(toPublicVoiceType),
      });
    }

    if (action === "enable" || action === "publish") {
      const id = String(body.id || "").trim();
      await updateVoiceTypes(async (list) => {
        const item = list.find((row) => String(row.id) === id);
        if (item) item.enabled = true;
        return {};
      });
      return json(res, 200, {
        ok: true,
        message: "已启用",
        items: (await readVoiceTypes()).map(toPublicVoiceType),
      });
    }

    if (action === "disable" || action === "unpublish") {
      const id = String(body.id || "").trim();
      await updateVoiceTypes(async (list) => {
        const item = list.find((row) => String(row.id) === id);
        if (item) item.enabled = false;
        return {};
      });
      return json(res, 200, {
        ok: true,
        message: "已停用",
        items: (await readVoiceTypes()).map(toPublicVoiceType),
      });
    }

    if (action === "reorder" || action === "sort") {
      const order = Array.isArray(body.ids) ? body.ids.map(String) : [];
      if (!order.length) return json(res, 400, { ok: false, message: "缺少排序列表" });
      await updateVoiceTypes(async (list) => {
        const byId = new Map(list.map((row) => [String(row.id), row]));
        const next = [];
        order.forEach((id, index) => {
          const row = byId.get(String(id));
          if (!row) return;
          row.sort = (index + 1) * 10;
          next.push(row);
          byId.delete(String(id));
        });
        byId.forEach((row) => next.push(row));
        list.splice(0, list.length, ...next);
        return {};
      });
      return json(res, 200, {
        ok: true,
        message: "排序已更新",
        items: (await readVoiceTypes()).map(toPublicVoiceType),
      });
    }

    return json(res, 400, { ok: false, message: "未知操作" });
  } catch (error) {
    return json(res, error.status || 500, { ok: false, message: error.message || "声线管理接口异常" });
  }
}
