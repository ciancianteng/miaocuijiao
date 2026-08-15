import { companionDb, isMissingRelation } from "../_companion-media-store.js";
import { writeAdminLog } from "../_wallet.js";

function json(res, status, data) {
  return res.status(status).json(data);
}
function roleFrom(req) {
  return String(req.headers["x-mcj-admin-role"] || "").trim() || "admin";
}
function money(v) {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
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
  try {
    await (await import("../_admin-auth.js")).requireAdmin(req);
  } catch (err) {
    return json(res, err.status || 403, { ok: false, message: err.message || "无权限" });
  }
  try {
    if (req.method === "GET") {
      const rows = await companionDb("gifts", "?order=sort_order.asc&limit=200").catch((e) => {
        if (isMissingRelation(e)) return [];
        throw e;
      });
      return json(res, 200, {
        ok: true,
        gifts: (rows || [])
          .filter((g) => !g.deleted_at)
          .map((g) => ({
            id: g.id,
            name: g.name,
            iconUrl: g.icon_url || "",
            catFoodPrice: money(g.cat_food_price),
            enabled: !!g.enabled,
            featured: !!g.featured,
            sortOrder: g.sort_order || 100,
            animationLevel: g.animation_level || "normal",
            createdAt: g.created_at,
          })),
      });
    }
    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return json(res, 405, { ok: false, message: "Method Not Allowed" });
    }
    const body = await parseBody(req);
    const action = String(body.action || "save").trim();
    if (action === "save") {
      const id = String(body.id || "").trim();
      const name = String(body.name || "").trim();
      if (!name) {
        return json(res, 400, { ok: false, message: "礼物名称不能为空" });
      }
      const isCreate = !id;
      // Create defaults: enabled=true（启用）, featured=false（推荐关闭）. Explicit body values still win.
      const enabled =
        body.enabled === undefined || body.enabled === null || body.enabled === ""
          ? true
          : body.enabled !== false && body.enabled !== "false";
      const featured =
        body.featured === undefined || body.featured === null || body.featured === ""
          ? false
          : body.featured === true || body.featured === "true";
      const sortRaw = Number(body.sortOrder ?? body.sort_order ?? 100);
      const sortOrder = Number.isFinite(sortRaw) ? Math.max(0, Math.min(999999, Math.round(sortRaw))) : 100;
      const payload = {
        name,
        icon_url: String(body.iconUrl || body.icon_url || ""),
        cat_food_price: money(body.catFoodPrice || body.cat_food_price),
        enabled,
        featured,
        sort_order: sortOrder,
        animation_level: String(body.animationLevel || "normal"),
        updated_at: new Date().toISOString(),
      };
      if (payload.cat_food_price <= 0) {
        return json(res, 400, { ok: false, message: "请填写有效猫粮价格" });
      }

      // Prevent duplicate gift names among non-deleted rows (case-insensitive, trimmed).
      const existing = await companionDb("gifts", "?select=id,name,deleted_at&limit=500").catch((e) => {
        if (isMissingRelation(e)) return [];
        throw e;
      });
      const nameKey = name.toLowerCase();
      const dup = (existing || []).find((g) => {
        if (g.deleted_at) return false;
        if (id && String(g.id) === id) return false;
        return String(g.name || "").trim().toLowerCase() === nameKey;
      });
      if (dup) {
        return json(res, 409, { ok: false, message: "礼物名称已存在，请换一个名称" });
      }

      let rows;
      if (id) {
        rows = await companionDb("gifts", `?id=eq.${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      } else {
        rows = await companionDb("gifts", "", {
          method: "POST",
          body: JSON.stringify({ ...payload, created_at: new Date().toISOString() }),
        });
      }
      await writeAdminLog({
        module: "gifts",
        action: id ? "update_gift" : "create_gift",
        targetType: "gift",
        targetId: rows?.[0]?.id || id,
        operatorRole: roleFrom(req),
      });
      const saved = rows?.[0] || payload;
      const statusText = (saved.enabled !== false && saved.enabled !== "false" ? "启用" : "停用");
      const featuredText = saved.featured === true || saved.featured === "true" ? "是" : "否";
      const message = isCreate
        ? `礼物已新增（状态：${statusText}，推荐：${featuredText}）`
        : "礼物已保存";
      return json(res, 200, {
        ok: true,
        message,
        gift: {
          id: saved.id,
          name: saved.name || payload.name,
          iconUrl: saved.icon_url || payload.icon_url || "",
          catFoodPrice: money(saved.cat_food_price ?? payload.cat_food_price),
          enabled: saved.enabled !== false && saved.enabled !== "false",
          featured: saved.featured === true || saved.featured === "true",
          sortOrder: Number(saved.sort_order ?? payload.sort_order ?? 100),
          animationLevel: saved.animation_level || payload.animation_level || "normal",
        },
      });
    }
    if (action === "soft_delete") {
      const id = String(body.id || "").trim();
      await companionDb("gifts", `?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ deleted_at: new Date().toISOString(), enabled: false, updated_at: new Date().toISOString() }),
      });
      return json(res, 200, { ok: true, message: "礼物已下架（软删除）" });
    }
    if (action === "save_commission") {
      const rateRaw = money(body.commissionRate ?? body.rate ?? 20);
      if (!Number.isFinite(rateRaw)) {
        return json(res, 400, { ok: false, message: "抽成比例必须是数字" });
      }
      if (rateRaw < 0 || rateRaw > 100) {
        return json(res, 400, { ok: false, message: "抽成比例须在 0–100 之间" });
      }
      const rate = Math.round(rateRaw * 100) / 100;
      await companionDb("gift_settings", "?on_conflict=id", {
        method: "POST",
        body: JSON.stringify({ id: 1, commission_rate: rate, updated_at: new Date().toISOString() }),
      });
      return json(res, 200, { ok: true, message: "礼物抽成已更新", rate });
    }
    return json(res, 400, { ok: false, message: "未知操作" });
  } catch (error) {
    if (isMissingRelation(error)) {
      return json(res, 503, {
        ok: false,
        message: "请先执行 supabase/companion-marketplace.sql",
        detail: String(error?.message || "").slice(0, 240),
        table: error?.table || "gifts",
      });
    }
    return json(res, error.status || 500, { ok: false, message: error.message || "礼物管理异常" });
  }
}
