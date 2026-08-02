import {
  hasWalletDb,
  isMissingRelation,
  listCampaigns,
  money,
  nowIso,
  restUrl,
  serviceHeaders,
  supabaseJson,
  viewCampaign,
  writeAdminLog,
} from "../_wallet.js";
import { requireAdmin } from "../_admin-auth.js";

const ADMIN_ROLES = new Set(["admin", "super_admin", "finance_admin"]);

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

function normalizeCampaignInput(body = {}) {
  const pay = money(body.payAmountRm ?? body.pay_amount_rm);
  const base = money(body.baseCatFood ?? body.base_cat_food);
  const bonus = money(body.bonusCatFood ?? body.bonus_cat_food);
  const total = money(body.totalCatFood ?? body.total_cat_food) || base + bonus;
  return {
    name: String(body.name || "").trim(),
    pay_amount_rm: pay,
    base_cat_food: base,
    bonus_cat_food: bonus,
    total_cat_food: total,
    starts_at: body.startsAt || body.starts_at || null,
    ends_at: body.endsAt || body.ends_at || null,
    per_boss_limit: Number(body.perBossLimit ?? body.per_boss_limit ?? 0) || 0,
    first_recharge_only: !!(body.firstRechargeOnly ?? body.first_recharge_only),
    enabled: body.enabled !== false && body.enabled !== "false",
    sort_order: Number(body.sortOrder ?? body.sort_order ?? 100) || 100,
    description: String(body.description || "").trim(),
    updated_at: nowIso(),
  };
}

export default async function handler(req, res) {
  let adminProfile;
  try {
    adminProfile = await requireAdmin(req, { allowRoles: ADMIN_ROLES });
  } catch (err) {
    return json(res, err.status || 403, { ok: false, message: err.message || "没有充值活动管理权限" });
  }
  if (!hasWalletDb()) return json(res, 503, { ok: false, message: "未配置数据库" });

  try {
    if (req.method === "GET") {
      const campaigns = await listCampaigns({ enabledOnly: false });
      return json(res, 200, { ok: true, campaigns });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return json(res, 405, { ok: false, message: "Method Not Allowed" });
    }

    const body = await parseBody(req);
    const action = String(body.action || "save").trim();
    const operatorRole = String(adminProfile.role || "admin");

    if (action === "delete") {
      const id = String(body.id || "").trim();
      if (!id) return json(res, 400, { ok: false, message: "缺少活动 ID" });
      await supabaseJson(restUrl("recharge_campaigns", `?id=eq.${encodeURIComponent(id)}`), {
        method: "PATCH",
        headers: serviceHeaders(),
        body: JSON.stringify({ enabled: false, updated_at: nowIso() }),
      });
      await writeAdminLog({
        module: "recharge_campaigns",
        action: "disable",
        targetType: "recharge_campaign",
        targetId: id,
        operatorRole,
        operatorId: adminProfile.id,
        reason: "停用活动",
      });
      return json(res, 200, { ok: true, message: "活动已停用" });
    }

    const patch = normalizeCampaignInput(body);
    if (!patch.name) return json(res, 400, { ok: false, message: "请填写活动名称" });
    if (patch.pay_amount_rm <= 0) return json(res, 400, { ok: false, message: "实付金额必须大于 0" });
    if (patch.base_cat_food < 0 || patch.bonus_cat_food < 0) return json(res, 400, { ok: false, message: "猫粮数量不能为负" });

    const id = String(body.id || "").trim();
    let saved;
    if (id) {
      const rows = await supabaseJson(restUrl("recharge_campaigns", `?id=eq.${encodeURIComponent(id)}`), {
        method: "PATCH",
        headers: serviceHeaders(),
        body: JSON.stringify(patch),
      });
      saved = rows?.[0];
    } else {
      const rows = await supabaseJson(restUrl("recharge_campaigns"), {
        method: "POST",
        headers: serviceHeaders(),
        body: JSON.stringify({ ...patch, created_at: nowIso() }),
      });
      saved = rows?.[0];
    }

    await writeAdminLog({
      module: "recharge_campaigns",
      action: id ? "update" : "create",
      targetType: "recharge_campaign",
      targetId: saved?.id || id,
      operatorRole,
      operatorId: adminProfile.id,
      after: saved || patch,
    });

    return json(res, 200, {
      ok: true,
      message: id ? "活动已更新" : "活动已创建",
      campaign: viewCampaign(saved || patch),
    });
  } catch (error) {
    if (isMissingRelation(error)) {
      return json(res, 503, { ok: false, message: "请先执行 supabase/wallet-system.sql" });
    }
    return json(res, error.status || 500, { ok: false, message: error.message || "充值活动接口异常" });
  }
}
