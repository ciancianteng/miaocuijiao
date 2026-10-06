import { randomUUID } from "node:crypto";
import {
  readCertTags,
  updateCertTags,
  normalizeCertTag,
  toAdminCertTag,
} from "../_companion-cert-tags-store.js";
import { requireAdmin as requireAdminJwt } from "../_admin-auth.js";
import {
  db,
  isSchemaMissing,
  ledgerAvailable,
  listAssignments,
  viewAssignment,
  grantBadge,
  requestBadgeRemoval,
  approveBadgeRemoval,
  rejectBadgeRemoval,
  setCommissionPrimary,
  setBadgeCommission,
  resolveCommissionBadge,
  OPEN_STATUSES,
} from "../_cert-badge-ledger.js";
import { badgeOverview, badgeDetail, badgeHolder, badgeMonthlyExport } from "../_cert-badge-stats.js";
import { resolveCompanionPublicCode } from "../_account-codes.js";

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
    const profile = await requireAdminJwt(req, { allowRoles: ADMIN_ROLES, module: "players" });
    return profile || {};
  } catch (err) {
    json(res, err.status || 401, { ok: false, message: err.message || "请先登录管理员账号。" });
    return null;
  }
}

async function adminItems() {
  return (await readCertTags()).map(toAdminCertTag);
}

async function requireLedger() {
  if (!(await ledgerAvailable())) {
    throw Object.assign(new Error("勋章台账未初始化：请先在 Staging 执行 20261005_cert_badge_commission.sql"), { status: 503 });
  }
}

/** Resolve "PW00076" / companion_profiles.id / user id → companion profile row. */
async function findCompanion(ref) {
  const raw = String(ref || "").trim();
  if (!raw) throw Object.assign(new Error("请填写陪玩编号（PW 编号）"), { status: 400 });
  const cols = "id,user_id,nickname,companion_code,companion_uid";
  const tries = [];
  if (/^[0-9a-f-]{36}$/i.test(raw)) tries.push(`?id=eq.${raw}`, `?user_id=eq.${raw}`);
  if (/^pw\d+$/i.test(raw)) {
    const n = Number(raw.replace(/^pw/i, ""));
    tries.push(`?companion_code=eq.${encodeURIComponent(raw.toUpperCase())}`);
    if (n > 0) tries.push(`?companion_uid=eq.${n + 100000}`, `?companion_uid=eq.${n}`);
  }
  if (/^\d{1,9}$/.test(raw)) tries.push(`?companion_uid=eq.${raw}`);
  for (const q of tries) {
    const rows = await db("companion_profiles", `${q}&select=${cols}&limit=2`).catch(() => []);
    const hit = (rows || []).find((r) => !/^pw/i.test(raw) || resolveCompanionPublicCode(r) === raw.toUpperCase());
    if (hit) return hit;
  }
  if (!/^pw\d+$/i.test(raw) && !/^[0-9a-f-]{36}$/i.test(raw)) {
    const byName = await db("companion_profiles", `?nickname=ilike.*${encodeURIComponent(raw.replace(/[*,()]/g, ""))}*&select=${cols}&limit=5`).catch(() => []);
    const exact = (byName || []).find((r) => String(r.nickname || "") === raw);
    if (exact || byName?.length === 1) return exact || byName[0];
    if (byName?.length > 1) throw Object.assign(new Error(`昵称「${raw}」匹配到多个陪玩，请改用 PW 编号或 UID`), { status: 409 });
  }
  throw Object.assign(new Error(`找不到陪玩 ${raw}`), { status: 404 });
}

/** Optional holder filter (?companion=PW00076 | UID | 昵称 | profile id) → { profileId, userId, label }. */
async function holderFilter(ref) {
  if (!String(ref || "").trim()) return null;
  const cp = await findCompanion(ref);
  return {
    profileId: String(cp.id),
    userId: cp.user_id ? String(cp.user_id) : "",
    label: { companionProfileId: String(cp.id), pwCode: resolveCompanionPublicCode(cp), uid: cp.companion_uid != null ? String(cp.companion_uid) : "", nickname: cp.nickname || "" },
  };
}

async function badgeHasHistory(tagId) {
  const id = String(tagId);
  const a = await db("companion_cert_tag_assignments", `?tag_id=eq.${encodeURIComponent(id)}&select=id&limit=1`).catch((err) => {
    if (isSchemaMissing(err)) return [];
    throw err;
  });
  if (a?.length) return true;
  const o = await db(
    "orders",
    `?cert_badge_snapshot=cs.${encodeURIComponent(JSON.stringify({ badgeIds: [id] }))}&select=id&limit=1`
  ).catch((err) => {
    if (isSchemaMissing(err)) return [];
    throw err;
  });
  return !!o?.length;
}

/** Companion's held badges + which one drives commission (shown in admin so nothing is implicit). */
async function companionBadgeView(profileId) {
  const [rows, catalog] = await Promise.all([listAssignments({ profileIds: [profileId], limit: 200 }), readCertTags()]);
  const byId = new Map(catalog.map((t) => [String(t.id), t]));
  const open = rows.filter((r) => OPEN_STATUSES.includes(r.status));
  const pick = resolveCommissionBadge(open, catalog);
  return {
    assignments: rows.map((r) => viewAssignment(r, byId.get(String(r.tag_id)))),
    commissionBadge: pick
      ? {
          badgeId: String(pick.tag.id),
          badgeName: pick.tag.name,
          companionShareRate: pick.tag.companionShareRate,
          platformRate: Math.round((100 - pick.tag.companionShareRate) * 100) / 100,
          rule: pick.rule,
          ruleLabel: pick.rule === "primary" ? "后台指定的佣金主勋章" : "按勋章佣金优先级（数字小优先）",
        }
      : null,
  };
}

export default async function handler(req, res) {
  try {
    const operator = await requireAdmin(req, res);
    if (!operator) return;

    if (req.method === "GET") {
      const q = req.query || {};
      const action = String(q.action || "list");
      if (action === "stats") {
        const who = await holderFilter(q.companion);
        return json(res, 200, { ok: true, ...(await badgeOverview({ range: q.range, from: q.from, to: q.to, tagId: q.id || "", who })) });
      }
      if (action === "detail") {
        const who = await holderFilter(q.companion);
        return json(res, 200, { ok: true, ...(await badgeDetail({ tagId: q.id, range: q.range, from: q.from, to: q.to, who })) });
      }
      if (action === "holder") {
        const who = await holderFilter(q.companion || q.profile);
        if (!who) return json(res, 400, { ok: false, message: "缺少陪玩（PW 编号 / UID / 昵称）" });
        return json(res, 200, { ok: true, ...(await badgeHolder({ tagId: q.id || "", who, range: q.range, from: q.from, to: q.to })) });
      }
      if (action === "export") {
        return json(res, 200, { ok: true, ...(await badgeMonthlyExport({ year: q.year, month: q.month, tagId: q.id || "" })) });
      }
      if (action === "companion") {
        const cp = await findCompanion(q.ref || q.id);
        return json(res, 200, {
          ok: true,
          companion: { id: cp.id, pwCode: resolveCompanionPublicCode(cp), nickname: cp.nickname || "" },
          ...(await companionBadgeView(cp.id)),
        });
      }
      const items = await adminItems();
      return json(res, 200, { ok: true, items, tags: items });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return json(res, 405, { ok: false, message: "Method Not Allowed" });
    }

    const body = await parseBody(req);
    const action = String(body.action || "save").trim();

    if (action === "list") {
      return json(res, 200, { ok: true, items: await adminItems() });
    }

    if (action === "create" || action === "save") {
      const draft = (body.payload && body.payload.draft) || body.tag || body.payload || {};
      const id = String(body.id || draft.id || "").trim();
      const result = await updateCertTags(async (list) => {
        const index = id ? list.findIndex((item) => String(item.id) === id) : -1;
        const prev = index >= 0 ? list[index] : {};
        const row = normalizeCertTag(
          {
            ...prev,
            ...draft,
            name: draft.name || "",
            icon: draft.icon || prev.icon || "🏷️",
            color: draft.color || prev.color || "#ff6b9d",
            sort: draft.sort != null ? draft.sort : prev.sort != null ? prev.sort : list.length + 1,
            enabled: draft.enabled != null ? draft.enabled !== false : prev.enabled !== false,
            // commission only changes through set_commission (logged)
            companionShareRate: prev.companionShareRate ?? null,
            commissionPriority: prev.commissionPriority ?? 100,
            id: id || randomUUID(),
          },
          list.length
        );
        if (!row.name) throw Object.assign(new Error("请填写标签名称。"), { status: 400 });
        if (index >= 0) list[index] = row;
        else list.push(row);
        return { tag: row };
      });
      let commission = null;
      const wantsRate = draft.companionShareRate !== undefined || draft.commissionPriority !== undefined;
      if (wantsRate && (await ledgerAvailable())) {
        commission = await setBadgeCommission({
          tagId: result.tag.id,
          rate: draft.companionShareRate === undefined ? result.tag.companionShareRate ?? null : draft.companionShareRate,
          priority: draft.commissionPriority,
          operator,
        });
      }
      const items = await adminItems();
      return json(res, 200, {
        ok: true,
        message: "认证勋章已保存",
        item: items.find((t) => String(t.id) === String(result.tag.id)) || toAdminCertTag(result.tag),
        commission,
        items,
      });
    }

    if (action === "set_commission") {
      await requireLedger();
      const id = String(body.id || "").trim();
      if (!id) return json(res, 400, { ok: false, message: "缺少勋章 ID。" });
      const out = await setBadgeCommission({ tagId: id, rate: body.companionShareRate ?? null, priority: body.commissionPriority, operator });
      return json(res, 200, {
        ok: true,
        message: out.oldRate === out.newRate ? "佣金未变化" : `统一佣金已更新：陪玩 ${out.newRate == null ? "按默认规则" : `${out.newRate}%`}（仅影响之后绑定的订单）`,
        ...out,
        items: await adminItems(),
      });
    }

    if (action === "delete") {
      const id = String(body.id || "").trim();
      if (!id) return json(res, 400, { ok: false, message: "缺少标签 ID。" });
      if (await badgeHasHistory(id)) {
        return json(res, 409, { ok: false, message: "该勋章已有授予记录或订单归属，不能删除（会破坏历史统计），请改为停用。" });
      }
      await updateCertTags(async (list) => {
        const next = list.filter((item) => String(item.id) !== id);
        list.splice(0, list.length, ...next);
        return {};
      });
      return json(res, 200, { ok: true, message: "认证勋章已删除", items: await adminItems() });
    }

    if (action === "enable" || action === "publish" || action === "disable" || action === "unpublish") {
      const id = String(body.id || "").trim();
      const enabled = action === "enable" || action === "publish";
      await updateCertTags(async (list) => {
        const item = list.find((row) => String(row.id) === id);
        if (item) item.enabled = enabled;
        return {};
      });
      return json(res, 200, { ok: true, message: enabled ? "已启用" : "已停用", items: await adminItems() });
    }

    if (action === "grant") {
      await requireLedger();
      const cp = await findCompanion(body.companionRef || body.companionProfileId);
      const out = await grantBadge({ profileId: cp.id, tagId: String(body.id || body.tagId || ""), operator });
      return json(res, 200, {
        ok: true,
        message: out.duplicate ? "该陪玩已持有此勋章" : `已授予 ${resolveCompanionPublicCode(cp) || cp.nickname || ""}`,
        duplicate: out.duplicate,
        assignment: viewAssignment(out.assignment || {}),
      });
    }

    if (action === "request_removal") {
      await requireLedger();
      const out = await requestBadgeRemoval({ assignmentId: body.assignmentId, operator, reason: body.reason });
      return json(res, 200, { ok: true, message: out.duplicate ? "已在待取消中" : "已提交取消申请，等待管理员审批", assignment: viewAssignment(out.assignment) });
    }

    if (action === "approve_removal") {
      await requireLedger();
      const out = await approveBadgeRemoval({ assignmentId: body.assignmentId, operator });
      return json(res, 200, { ok: true, message: out.duplicate ? "该勋章已取消" : "已批准取消；历史订单仍归属该勋章", assignment: viewAssignment(out.assignment) });
    }

    if (action === "reject_removal") {
      await requireLedger();
      const out = await rejectBadgeRemoval({ assignmentId: body.assignmentId, operator });
      return json(res, 200, { ok: true, message: "已驳回取消申请，勋章继续生效", assignment: viewAssignment(out.assignment) });
    }

    if (action === "set_primary") {
      await requireLedger();
      const cp = await findCompanion(body.companionRef || body.companionProfileId);
      await setCommissionPrimary({ profileId: cp.id, tagId: String(body.id || body.tagId || ""), operator });
      return json(res, 200, { ok: true, message: "已设为该陪玩的佣金主勋章（之后绑定的订单生效）", ...(await companionBadgeView(cp.id)) });
    }

    return json(res, 400, { ok: false, message: "未知操作" });
  } catch (error) {
    return json(res, error.status || 500, { ok: false, message: error.message || "认证勋章接口异常" });
  }
}
