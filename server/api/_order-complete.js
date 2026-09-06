/**
 * Order completion handshake:
 * companion apply → wait boss confirm (24h auto) → completed + settle once.
 */
import { resolvePlatformCommission } from "./_commission-rates.js";
import { readLocalLevels } from "./_companion-levels-store.js";
import {
  createOrderGrabHelpers,
  stripInternalOrderMarkers,
} from "./_order-grabs.js";
import { awardBossPointsForCompletedOrder } from "./_user-points.js";
import { settleBossCommissionFromPlatformFee } from "./_boss-commission.js";
import { isSettlementEnabled, settlementDisabledReason } from "./_feature-flags.js";
import {
  assertNotTestPartiesForSettlement,
  isProductionRuntime,
  isTestAccountRecord,
} from "./_test-accounts.js";

export const COMPLETION_AUTO_CONFIRM_MS = 24 * 60 * 60 * 1000;
export const COMPLETION_PENDING_MARKER = "[[COMPLETION_PENDING]]";
export const COMPLETION_REQUESTED_AT_MARKER = "[[COMPLETION_REQUESTED_AT]]";
export const COMPLETION_METHOD_MARKER = "[[COMPLETION_METHOD]]";
export const COMPLETION_AUTO_PAUSED_MARKER = "[[COMPLETION_AUTO_PAUSED]]";
export const ORDER_DISPUTE_MARKER = "[[ORDER_DISPUTE]]";
export const ORDER_FROZEN_MARKER = "[[ORDER_FROZEN]]";

function nowIso() {
  return new Date().toISOString();
}

function money(v) {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function blobOf(order = {}) {
  const note = String(order.note || "");
  const description = String(order.description || "");
  if (note && description) return `${note}\n${description}`;
  return note || description;
}

export function hasCompletionPendingText(text = "") {
  return String(text || "").includes(COMPLETION_PENDING_MARKER);
}

export function orderHasCompletionPending(order = {}) {
  return hasCompletionPendingText(String(order.note || "")) || hasCompletionPendingText(String(order.description || ""));
}

export function parseCompletionRequestedAt(order = {}) {
  const blob = blobOf(order);
  const hit = blob.match(/\[\[COMPLETION_REQUESTED_AT\]\]\s*([^\n|]+)/i);
  if (hit?.[1] && !Number.isNaN(Date.parse(hit[1].trim()))) return hit[1].trim();
  // Legacy rows: marker exists but no stamp — do NOT invent created_at/started_at.
  return "";
}

export function parseCompletionMethod(order = {}) {
  const blob = blobOf(order);
  const hit = blob.match(/\[\[COMPLETION_METHOD\]\]\s*([^\n|]+)/i);
  if (hit?.[1]) return hit[1].trim();
  return String(order.completion_method || order.completionMethod || "").trim();
}

export function getCompletionAutoPause(order = {}) {
  const status = String(order.status || "");
  if (status === "refund_requested") {
    return { paused: true, reason: "老板已申请售后，自动确认已暂停" };
  }
  if (status === "refunded") {
    return { paused: true, reason: "订单已退款，自动确认已暂停" };
  }
  if (status === "cancelled") {
    return { paused: true, reason: "订单已取消" };
  }
  const blob = blobOf(order);
  if (/\[\[ORDER_FROZEN\]\]/i.test(blob)) {
    return { paused: true, reason: "后台已冻结订单，自动确认已暂停" };
  }
  if (/\[\[ORDER_DISPUTE\]\]/i.test(blob)) {
    return { paused: true, reason: "客服已标记争议，自动确认已暂停" };
  }
  if (/\[\[COMPLETION_AUTO_PAUSED\]\]/i.test(blob)) {
    const why = (blob.match(/\[\[COMPLETION_AUTO_PAUSED\]\]\s*([^\n|]*)/i) || [])[1] || "";
    return {
      paused: true,
      reason: why.trim() ? `订单问题处理中：${why.trim()}` : "订单问题处理中，自动确认已暂停",
    };
  }
  return { paused: false, reason: "" };
}

export function isManualConfirmBlocked(order = {}) {
  const status = String(order.status || "");
  if (["refund_requested", "refunded", "cancelled"].includes(status)) return true;
  return /\[\[ORDER_FROZEN\]\]/i.test(blobOf(order));
}

export function completionCountdown(order = {}, now = Date.now()) {
  const requestedAt = parseCompletionRequestedAt(order);
  if (!requestedAt || !orderHasCompletionPending(order)) {
    return {
      completionRequestedAt: requestedAt || "",
      autoConfirmAt: "",
      autoConfirmRemainingMs: null,
      autoConfirmPaused: false,
      autoConfirmPausedReason: "",
    };
  }
  const pause = getCompletionAutoPause(order);
  const autoConfirmAt = new Date(Date.parse(requestedAt) + COMPLETION_AUTO_CONFIRM_MS).toISOString();
  const remaining = Math.max(0, Date.parse(autoConfirmAt) - now);
  return {
    completionRequestedAt: requestedAt,
    autoConfirmAt,
    autoConfirmRemainingMs: pause.paused ? null : remaining,
    autoConfirmPaused: pause.paused,
    autoConfirmPausedReason: pause.reason,
  };
}

export function formatRemainingLabel(ms) {
  if (ms == null || !Number.isFinite(ms)) return "";
  const totalMin = Math.max(0, Math.ceil(ms / 60000));
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (hours <= 0) return `${mins}分钟`;
  return `${hours}小时${mins}分钟`;
}

function stripCompletionMeta(text = "") {
  return String(text || "")
    .replace(/\[\[COMPLETION_PENDING(?::[^\]]*)?\]\]/gi, "")
    .replace(/\[\[COMPLETION_REQUESTED_AT\]\][^\n]*/gi, "")
    .replace(/\[\[COMPLETION_METHOD\]\][^\n]*/gi, "")
    .replace(/\[\[COMPLETION_AUTO_PAUSED\]\][^\n]*/gi, "")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

export function withCompletionPendingStamp(text = "", atIso = nowIso()) {
  let raw = stripCompletionMeta(text);
  // Keep dispute/frozen markers if present.
  const block = `${COMPLETION_PENDING_MARKER}\n${COMPLETION_REQUESTED_AT_MARKER}${atIso}`;
  return raw ? `${raw}\n${block}` : block;
}

export function withoutCompletionPendingStamp(text = "") {
  return stripCompletionMeta(text);
}

function upsertMarker(text = "", marker, value = "") {
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\n?${escaped}[^\\n]*`, "gi");
  const cleaned = String(text || "").replace(re, "").trim();
  const line = value ? `${marker}${value}` : marker;
  return cleaned ? `${cleaned}\n${line}` : line;
}

function removeMarker(text = "", marker) {
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\n?${escaped}[^\\n]*`, "gi");
  return String(text || "").replace(re, "").replace(/\n{2,}/g, "\n").trim();
}

async function patchOrderFields(restUrl, supabaseJson, serviceHeaders, orderId, fields) {
  return supabaseJson(restUrl("orders", `?id=eq.${encodeURIComponent(orderId)}`), {
    method: "PATCH",
    headers: serviceHeaders(),
    body: JSON.stringify(fields),
  });
}

async function dualWriteText(restUrl, supabaseJson, serviceHeaders, order, nextNote, nextDesc) {
  const attempts = [
    { note: nextNote, description: nextDesc },
    { description: nextDesc },
    { note: nextNote },
  ];
  let lastErr = null;
  for (const body of attempts) {
    try {
      await patchOrderFields(restUrl, supabaseJson, serviceHeaders, order.id, body);
      return body;
    } catch (err) {
      lastErr = err;
      if (!/column|schema cache|PGRST|note|description/i.test(String(err?.message || ""))) throw err;
    }
  }
  throw lastErr || new Error("无法写入订单标记");
}

export function createOrderCompleteHelpers({ restUrl, supabaseJson, serviceHeaders, addSystemMessage }) {
  const grabsApi = createOrderGrabHelpers({ restUrl, supabaseJson, serviceHeaders });

  async function markCompletionPending(order, atIso = nowIso()) {
    if (orderHasCompletionPending(order) && parseCompletionRequestedAt(order)) {
      return {
        note: String(order.note || ""),
        description: String(order.description || ""),
        completionRequestedAt: parseCompletionRequestedAt(order),
      };
    }
    const nextNote = withCompletionPendingStamp(String(order.note || ""), atIso);
    const nextDesc = withCompletionPendingStamp(String(order.description || ""), atIso);
    await dualWriteText(restUrl, supabaseJson, serviceHeaders, order, nextNote, nextDesc);
    return { note: nextNote, description: nextDesc, completionRequestedAt: atIso };
  }

  async function clearCompletionPending(order) {
    const nextNote = withoutCompletionPendingStamp(String(order.note || ""));
    const nextDesc = withoutCompletionPendingStamp(String(order.description || ""));
    // Also drop pause marker on finalize; keep dispute/frozen for audit unless clearing intentionally.
    await dualWriteText(restUrl, supabaseJson, serviceHeaders, order, nextNote, nextDesc);
    return { note: nextNote, description: nextDesc };
  }

  async function stampAutoPaused(order, reason = "boss_problem") {
    const nextNote = upsertMarker(String(order.note || ""), COMPLETION_AUTO_PAUSED_MARKER, reason);
    const nextDesc = upsertMarker(String(order.description || ""), COMPLETION_AUTO_PAUSED_MARKER, reason);
    await dualWriteText(restUrl, supabaseJson, serviceHeaders, order, nextNote, nextDesc);
    return { note: nextNote, description: nextDesc };
  }

  async function stampDispute(order, reason = "cs_dispute") {
    const nextNote = upsertMarker(String(order.note || ""), ORDER_DISPUTE_MARKER, reason);
    const nextDesc = upsertMarker(String(order.description || ""), ORDER_DISPUTE_MARKER, reason);
    await dualWriteText(restUrl, supabaseJson, serviceHeaders, order, nextNote, nextDesc);
    return { note: nextNote, description: nextDesc };
  }

  async function clearDispute(order) {
    const nextNote = removeMarker(String(order.note || ""), ORDER_DISPUTE_MARKER);
    const nextDesc = removeMarker(String(order.description || ""), ORDER_DISPUTE_MARKER);
    // Also clear auto-paused when dispute cleared.
    const n2 = removeMarker(nextNote, COMPLETION_AUTO_PAUSED_MARKER);
    const d2 = removeMarker(nextDesc, COMPLETION_AUTO_PAUSED_MARKER);
    await dualWriteText(restUrl, supabaseJson, serviceHeaders, order, n2, d2);
    return { note: n2, description: d2 };
  }

  async function stampFrozen(order, reason = "admin_freeze") {
    const nextNote = upsertMarker(String(order.note || ""), ORDER_FROZEN_MARKER, reason);
    const nextDesc = upsertMarker(String(order.description || ""), ORDER_FROZEN_MARKER, reason);
    await dualWriteText(restUrl, supabaseJson, serviceHeaders, order, nextNote, nextDesc);
    return { note: nextNote, description: nextDesc };
  }

  async function clearFrozen(order) {
    const nextNote = removeMarker(String(order.note || ""), ORDER_FROZEN_MARKER);
    const nextDesc = removeMarker(String(order.description || ""), ORDER_FROZEN_MARKER);
    await dualWriteText(restUrl, supabaseJson, serviceHeaders, order, nextNote, nextDesc);
    return { note: nextNote, description: nextDesc };
  }

  async function settleCompanionIncome(saved, completedAt, method) {
    if (!saved?.companion_id) return null;

    // G8: keep Production settlement writes off until flag is explicitly enabled.
    if (!isSettlementEnabled()) {
      return {
        skipped: true,
        reason: settlementDisabledReason() || "settlement_flag_disabled",
      };
    }

    // G5/G7: never settle smoke/test-touched orders (incl. RM6000 smoke fixtures).
    try {
      const ids = [saved.boss_id, saved.companion_id, saved.customer_service_id].filter(Boolean);
      const profiles = [];
      for (const id of ids) {
        try {
          const withFlag = await supabaseJson(
            restUrl(
              "profiles",
              `?id=eq.${encodeURIComponent(id)}&select=id,role,email,display_name,is_test_account&limit=1`
            ),
            { headers: serviceHeaders() }
          );
          if (withFlag?.[0]) profiles.push(withFlag[0]);
        } catch (error) {
          const msg = String(error?.message || "");
          if (!/is_test_account|PGRST204|42703|schema cache/i.test(msg)) throw error;
          const withoutFlag = await supabaseJson(
            restUrl(
              "profiles",
              `?id=eq.${encodeURIComponent(id)}&select=id,role,email,display_name&limit=1`
            ),
            { headers: serviceHeaders() }
          );
          if (withoutFlag?.[0]) profiles.push(withoutFlag[0]);
        }
      }
      const byId = new Map(profiles.map((p) => [p.id, p]));
      const partyGuard = assertNotTestPartiesForSettlement({
        bossProfile: byId.get(saved.boss_id) || null,
        companionProfile: byId.get(saved.companion_id) || null,
        customerServiceProfile: byId.get(saved.customer_service_id) || null,
        order: saved,
      });
      if (!partyGuard.ok) {
        return { skipped: true, reason: partyGuard.reason || "test_party" };
      }
      // Extra: any loaded party flagged test → skip (covers relation mismatches).
      if (profiles.some((p) => isTestAccountRecord(p))) {
        return { skipped: true, reason: "test_party" };
      }
    } catch (_) {
      if (isProductionRuntime()) {
        return { skipped: true, reason: "test_guard_error" };
      }
    }

    const existingTx = await supabaseJson(
      restUrl(
        "transactions",
        `?order_id=eq.${encodeURIComponent(saved.id)}&user_id=eq.${encodeURIComponent(saved.companion_id)}&transaction_type=eq.companion_income&limit=1`
      ),
      { headers: serviceHeaders() }
    ).catch(() => []);
    if (existingTx?.[0]) {
      let bossCommission = null;
      try {
        bossCommission = await settleBossCommissionFromPlatformFee(saved, {
          platformFeeRate: null,
          platformFeeAmount: saved.platform_fee,
          companionIncomeAmount: saved.companion_income,
          completedAt,
          method,
        });
      } catch (_) {
        bossCommission = { skipped: true, reason: "boss_commission_error" };
      }
      return { duplicate: true, transaction: existingTx[0], bossCommission };
    }

    const cp =
      (
        await supabaseJson(
          restUrl("companion_profiles", `?user_id=eq.${encodeURIComponent(saved.companion_id)}&limit=1`),
          { headers: serviceHeaders() }
        ).catch(() => [])
      )?.[0] || {};
    const amount = money(saved.total_amount);
    const levels = await readLocalLevels().catch(() => []);
    const levelMeta =
      (levels || []).find(
        (l) =>
          String(l.id) === String(cp.level_id || "") ||
          String(l.code) === String(cp.level_id || "") ||
          String(l.name) === String(cp.level_name || "")
      ) || null;
    const { platformRate, companionShareRate } = resolvePlatformCommission(
      cp.commission_rate,
      levelMeta?.commissionRate ?? 20
    );
    const companionNet = Math.round(((amount * companionShareRate) / 100) * 100) / 100;
    const platformFee = Math.round((amount - companionNet) * 100) / 100;
    const settlement = {
      orderId: saved.id,
      orderNo: saved.order_no,
      companionNetCatFood: companionNet,
      platformCommissionCatFood: platformFee,
      platformCommissionRate: platformRate,
      companionShareRate,
      completedAt,
      completionMethod: method,
      bossCommissionTransparencyNote: "老板直属分成由平台抽成支付，不扣陪玩收入",
      companionIncomeUnchangedByBossCommission: true,
    };
    await supabaseJson(restUrl("transactions"), {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify({
        user_id: saved.companion_id,
        order_id: saved.id,
        transaction_type: "companion_income",
        amount: companionNet,
        status: "completed",
        note: `MCJ_SETTLEMENT:${JSON.stringify(settlement)}`,
        created_at: completedAt,
      }),
    });
    try {
      await patchOrderFields(restUrl, supabaseJson, serviceHeaders, saved.id, {
        settlement_note: `MCJ_SETTLEMENT:${JSON.stringify(settlement)}`,
        companion_income: companionNet,
        platform_fee: platformFee,
        platform_fee_rate: platformRate,
        settlement_status: "settled",
      });
    } catch (_) {}

    // Boss commission from platform fee — does NOT reduce companionNet.
    // boss_commission = platform_fee * boss_commission_rate / 100
    let bossCommission = null;
    try {
      bossCommission = await settleBossCommissionFromPlatformFee(saved, {
        platformFeeRate: platformRate,
        platformFeeAmount: platformFee,
        companionIncomeAmount: companionNet,
        completedAt,
        method,
      });
      if (bossCommission && !bossCommission.skipped && !bossCommission.duplicate) {
        settlement.bossCommissionRate = bossCommission.calc?.bossCommissionRate;
        settlement.bossCommissionCatFood = bossCommission.calc?.bossCommissionAmount;
        settlement.bossCommissionRateSource = bossCommission.rateSource;
        settlement.companionIncomeUnchanged = true;
      }
    } catch (_) {
      bossCommission = { skipped: true, reason: "boss_commission_error" };
    }

    return { duplicate: false, settlement, bossCommission };
  }

  /**
   * Idempotent complete + settle.
   * method: boss_manual | system_auto_24h | admin_force
   */
  async function finalizeOrderCompletion(before, { method = "boss_manual", actorId = "", message = "" } = {}) {
    if (!before?.id) throw Object.assign(new Error("订单不存在。"), { status: 404 });
    if (String(before.status) === "completed" || String(before.settlement_status || "") === "settled") {
      let bossPoints = null;
      try {
        bossPoints = await awardBossPointsForCompletedOrder(before, {
          method,
          operatorId: actorId || null,
        });
      } catch (_) {}
      return {
        ok: true,
        duplicate: true,
        message: "订单已完成/已结算，无需重复处理。",
        order: before,
        bossPoints,
      };
    }
    if (String(before.status) !== "in_progress") {
      throw Object.assign(new Error("当前订单不能确认完成。"), { status: 409 });
    }
    if (isManualConfirmBlocked(before) && method === "boss_manual") {
      throw Object.assign(new Error("订单已冻结或售后中，不能确认完成。"), { status: 409 });
    }
    if (method !== "admin_force" && !orderHasCompletionPending(before)) {
      throw Object.assign(new Error("陪玩尚未申请完成服务。"), { status: 409 });
    }
    if (method === "system_auto_24h") {
      const pause = getCompletionAutoPause(before);
      if (pause.paused) {
        return { ok: false, skipped: true, message: pause.reason, order: before };
      }
      const requestedAt = parseCompletionRequestedAt(before);
      if (!requestedAt) {
        return { ok: false, skipped: true, message: "缺少申请完成时间，跳过自动确认。", order: before };
      }
      if (Date.now() < Date.parse(requestedAt) + COMPLETION_AUTO_CONFIRM_MS) {
        return { ok: false, skipped: true, message: "未到自动确认时间。", order: before };
      }
    }

    const completedAt = nowIso();
    const cleared = await clearCompletionPending(before);
    const methodLineNote = upsertMarker(cleared.note, COMPLETION_METHOD_MARKER, method);
    const methodLineDesc = upsertMarker(cleared.description, COMPLETION_METHOD_MARKER, method);

    const patchBodies = [
      {
        status: "completed",
        completed_at: completedAt,
        note: methodLineNote,
        description: methodLineDesc,
        completion_method: method,
        settlement_status: "settling",
      },
      {
        status: "completed",
        completed_at: completedAt,
        note: methodLineNote,
        description: methodLineDesc,
      },
      { status: "completed", completed_at: completedAt },
    ];
    let saved = null;
    let lastErr = null;
    for (const body of patchBodies) {
      try {
        const rows = await supabaseJson(
          restUrl("orders", `?id=eq.${encodeURIComponent(before.id)}&status=eq.in_progress`),
          { method: "PATCH", headers: serviceHeaders(), body: JSON.stringify(body) }
        );
        saved = rows?.[0] || { ...before, ...body, status: "completed", completed_at: completedAt };
        break;
      } catch (err) {
        lastErr = err;
        if (!/column|schema cache|PGRST|completion_method|settlement/i.test(String(err?.message || ""))) {
          throw err;
        }
      }
    }
    if (!saved) throw lastErr || new Error("确认完成失败");

    // Race: another worker completed first.
    if (String(saved.status) !== "completed") {
      const fresh = (
        await supabaseJson(restUrl("orders", `?id=eq.${encodeURIComponent(before.id)}&limit=1`), {
          headers: serviceHeaders(),
        })
      )?.[0];
      if (fresh?.status === "completed") {
        let bossPoints = null;
        try {
          bossPoints = await awardBossPointsForCompletedOrder(fresh, {
            method,
            operatorId: actorId || null,
          });
        } catch (_) {}
        return { ok: true, duplicate: true, message: "订单已完成。", order: fresh, bossPoints };
      }
    }

    const msg =
      message ||
      (method === "system_auto_24h"
        ? "系统已按规则自动确认完成订单（陪玩申请完成满 24 小时）。"
        : method === "admin_force"
          ? "后台已确认完成订单。"
          : "老板已确认完成订单。");
    if (typeof addSystemMessage === "function") {
      try {
        await addSystemMessage(saved, actorId || saved.boss_id, msg);
      } catch (_) {}
    }

    let settlement = null;
    let settlementOk = false;
    try {
      settlement = await settleCompanionIncome(saved, completedAt, method);
      settlementOk = true;
    } catch (_) {
      settlementOk = false;
    }

    let bossPoints = null;
    if (settlementOk) {
      try {
        bossPoints = await awardBossPointsForCompletedOrder(saved, {
          method,
          operatorId: actorId || null,
        });
      } catch (_) {}
    }

    let reward = null;
    try {
      reward = await (
        await import("./_cs-commission-settle.js")
      ).settleCsOrderIncome(
        { ...saved, status: "completed" },
        {
          source:
            method === "system_auto_24h"
              ? "system_auto_complete"
              : method === "admin_force"
                ? "admin_confirm_complete"
                : "boss_confirm_complete",
        }
      );
    } catch (_) {}

    return {
      ok: true,
      duplicate: false,
      message:
        method === "system_auto_24h"
          ? "已自动确认完成，订单已完成。"
          : "已确认完成，订单已完成。",
      order: {
        ...saved,
        note: methodLineNote,
        description: methodLineDesc,
        completion_method: method,
        status: "completed",
        completed_at: completedAt,
      },
      settlement,
      bossPoints,
      reward,
      completionMethod: method,
    };
  }

  async function expireCompletionAutoConfirms({ limit = 40 } = {}) {
    const rows = await supabaseJson(
      restUrl(
        "orders",
        `?status=eq.in_progress&or=(note.ilike.*COMPLETION_PENDING*,description.ilike.*COMPLETION_PENDING*)&order=updated_at.asc&limit=${Math.max(1, Math.min(100, limit))}`
      ),
      { headers: serviceHeaders() }
    ).catch(async () => {
      // Fallback without or-filter / updated_at
      return supabaseJson(
        restUrl("orders", `?status=eq.in_progress&order=created_at.asc&limit=${Math.max(1, Math.min(100, limit))}`),
        { headers: serviceHeaders() }
      ).catch(() => []);
    });
    const list = Array.isArray(rows) ? rows : [];
    // Backfill missing request timestamps so countdown/auto-confirm can start.
    for (const row of list) {
      if (orderHasCompletionPending(row) && !parseCompletionRequestedAt(row)) {
        try {
          await markCompletionPending(row);
        } catch (_) {}
      }
    }
    const freshList = [];
    for (const row of list) {
      if (!orderHasCompletionPending(row)) continue;
      try {
        const latest = (
          await supabaseJson(restUrl("orders", `?id=eq.${encodeURIComponent(row.id)}&limit=1`), {
            headers: serviceHeaders(),
          })
        )?.[0];
        freshList.push(latest || row);
      } catch {
        freshList.push(row);
      }
    }
    const due = freshList.filter((row) => {
      if (!orderHasCompletionPending(row)) return false;
      if (getCompletionAutoPause(row).paused) return false;
      const at = parseCompletionRequestedAt(row);
      if (!at) return false;
      return Date.now() >= Date.parse(at) + COMPLETION_AUTO_CONFIRM_MS;
    });
    const results = [];
    for (const row of due.slice(0, limit)) {
      try {
        const out = await finalizeOrderCompletion(row, {
          method: "system_auto_24h",
          actorId: row.boss_id || "",
        });
        results.push({ id: row.id, ...out });
      } catch (err) {
        results.push({ id: row.id, ok: false, message: err?.message || String(err) });
      }
    }
    return { scanned: list.length, due: due.length, processed: results.length, results };
  }

  return {
    grabsApi,
    markCompletionPending,
    clearCompletionPending,
    stampAutoPaused,
    stampDispute,
    clearDispute,
    stampFrozen,
    clearFrozen,
    finalizeOrderCompletion,
    expireCompletionAutoConfirms,
    orderHasCompletionPending,
    completionCountdown,
    stripInternalOrderMarkers,
  };
}
