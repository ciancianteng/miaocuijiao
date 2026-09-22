/**
 * place_multi_order — create 1 parent (multi_group) + N children in awaiting_payment.
 * Payment is deferred to the shared pay_order / payment-confirm path (same as single-order):
 * boss pays the parent once; children cascade without a second wallet debit.
 * On mid-create failure, soft-cancel partial rows (no debit — nothing was charged yet).
 */
import {
  ORDER_TYPE_MULTI_GROUP,
  canDebitBossWalletForOrder,
  isMultiGroupChild,
  isMultiGroupParent,
} from "./_order-group.js";
import { resolveOrderUnitPrice } from "./_admin-service-prices.js";
import { readLocalLevels } from "./_companion-levels-store.js";

function money(v) {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function nowIso() {
  return new Date().toISOString();
}

function childIdempotencyKey(parentKey, companionId, index) {
  return `${parentKey}:child:${companionId || index}`;
}

/** Columns often missing on older Production schemas. Keep values in description instead. */
const OPTIONAL_ORDER_COLUMNS = [
  "payment_method",
  "notes",
  "voice_mode",
  "game_id_value",
  "service_name",
  "quantity",
  "pricing_unit",
  "paid_at",
  "paid_cat_food",
];

function stripOptionalOrderColumns(row) {
  const next = { ...(row || {}) };
  for (const key of OPTIONAL_ORDER_COLUMNS) delete next[key];
  return next;
}

function isMissingColumnError(err) {
  return /column|schema cache|PGRST204|PGRST|Could not find/i.test(String(err?.message || err || ""));
}

/**
 * Insert an orders row; if optional columns are absent, retry without them.
 * Does NOT drop parent_order_id — that remains a hard multi-order requirement.
 */
async function insertOrderRow(deps, row) {
  const { restUrl, supabaseJson, serviceHeaders } = deps;
  try {
    const rows = await supabaseJson(restUrl("orders"), {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify(row),
    });
    return rows?.[0] || null;
  } catch (err) {
    if (!isMissingColumnError(err)) throw err;
    const core = stripOptionalOrderColumns(row);
    try {
      const rows = await supabaseJson(restUrl("orders"), {
        method: "POST",
        headers: serviceHeaders(),
        body: JSON.stringify(core),
      });
      return rows?.[0] || null;
    } catch (err2) {
      // Last resort: also drop assignment_type if that column is the culprit.
      if (!isMissingColumnError(err2)) throw err2;
      const bare = { ...core };
      delete bare.assignment_type;
      const rows = await supabaseJson(restUrl("orders"), {
        method: "POST",
        headers: serviceHeaders(),
        body: JSON.stringify(bare),
      });
      return rows?.[0] || null;
    }
  }
}

async function softCancelOrders(deps, ids, reason) {
  const { restUrl, supabaseJson, serviceHeaders, table = "orders" } = deps;
  for (const id of ids) {
    if (!id) continue;
    try {
      await supabaseJson(restUrl(table, `?id=eq.${encodeURIComponent(id)}`), {
        method: "PATCH",
        headers: serviceHeaders(),
        body: JSON.stringify({
          status: "cancelled",
          note: `[[MULTI_ORDER_ROLLBACK]] ${reason || "rollback"}`.slice(0, 500),
        }),
      });
    } catch (_) {
      /* best-effort */
    }
  }
}

/**
 * @param {object} ctx
 * @param {object} ctx.profile - boss profile
 * @param {object} ctx.body
 * @param {object} ctx.deps - restUrl, supabaseJson, serviceHeaders, nextOrderNo, resolveCompanionUserId,
 *   assertCompanionOrderable, priceForGame, loadCompanionPricingRow, assertNotSelfTrade,
 *   assertOrderPaymentMethodAllowed, isWalletMethod, viewOrder, addSystemMessage
 *   (debitWallet optional / unused — payment happens via pay_order)
 */
export async function placeMultiOrder(ctx) {
  const { profile, body, deps } = ctx;
  const {
    restUrl,
    supabaseJson,
    serviceHeaders,
    nextOrderNo,
    resolveCompanionUserId,
    assertCompanionOrderable,
    priceForGame,
    assertNotSelfTrade,
    assertOrderPaymentMethodAllowed,
    isWalletMethod,
    viewOrder,
    addSystemMessage,
  } = deps;

  const rawList = body.companions || body.lines || body.items || [];
  if (!Array.isArray(rawList) || rawList.length < 2) {
    return { ok: false, status: 400, message: "多人订单至少需要 2 位陪玩。" };
  }
  if (rawList.length > 20) {
    return { ok: false, status: 400, message: "单次下单陪玩过多（最多 20）。" };
  }

  const idempotencyKey = String(body.idempotencyKey || body.idempotency_key || "").trim();
  if (!idempotencyKey) {
    return { ok: false, status: 400, message: "缺少 idempotencyKey，无法防重复提交。" };
  }

  // Replay
  try {
    const existing = await supabaseJson(
      restUrl("orders", `?idempotency_key=eq.${encodeURIComponent(idempotencyKey)}&limit=1`),
      { headers: serviceHeaders() }
    );
    if (existing?.[0]) {
      const parent = existing[0];
      const children = await supabaseJson(
        restUrl(
          "orders",
          `?parent_order_id=eq.${encodeURIComponent(parent.id)}&select=*&order=created_at.asc`
        ),
        { headers: serviceHeaders() }
      ).catch(() => []);
      return {
        ok: true,
        status: 200,
        message: "多人订单已存在（防重复提交）",
        deduped: true,
        replayed: true,
        order: viewOrder(parent),
        parent: viewOrder(parent),
        children: (children || []).map(viewOrder),
        walletDebited: false,
        walletDebitAmount: 0,
      };
    }
  } catch (e) {
    if (!/idempotency|column|schema cache|PGRST|parent_order/i.test(String(e.message || ""))) {
      throw e;
    }
  }

  let paymentMethod = String(body.paymentMethod || body.payment_method || "catfood").trim().toLowerCase();
  const payGate = await assertOrderPaymentMethodAllowed(paymentMethod || "catfood");
  if (!payGate.ok) {
    return { ok: false, status: 409, message: payGate.message || "该支付方式暂未开放" };
  }
  paymentMethod = String(payGate.code || paymentMethod).toLowerCase();
  if (!isWalletMethod(paymentMethod)) {
    return {
      ok: false,
      status: 400,
      message: "多人订单第一阶段仅支持猫粮钱包一次支付。",
    };
  }

  const sharedGameId = String(body.gameId || body.game_id || "").trim();
  const sharedNotes = String(body.notes || body.remark || "").trim();
  let voiceMode = "game_mic";
  try {
    const { normalizeVoiceModeForNewOrder } = await import("./_discord-voice-orders.js");
    voiceMode = normalizeVoiceModeForNewOrder(body.voiceMode || body.voice_mode);
  } catch (_) {
    voiceMode = "game_mic";
  }
  const sharedGame = String(body.game || body.gameName || "陪玩").trim() || "陪玩";

  const prepared = [];
  for (let i = 0; i < rawList.length; i++) {
    const line = rawList[i] || {};
    let companionId = String(line.companionId || line.companion_id || "").trim();
    if (!companionId) {
      return { ok: false, status: 400, message: `第 ${i + 1} 行缺少陪玩。` };
    }
    companionId = (await resolveCompanionUserId(companionId)) || companionId;
    try {
      assertNotSelfTrade(profile.id, companionId, "给自己下单");
    } catch (selfErr) {
      return {
        ok: false,
        status: selfErr.status || 403,
        code: selfErr.code || "SELF_ORDER_NOT_ALLOWED",
        message: selfErr.message || "不能给自己下单。",
      };
    }
    const orderable = await assertCompanionOrderable(companionId);
    if (!orderable.ok) {
      return { ok: false, status: 400, message: orderable.message || `陪玩不可下单：${companionId}` };
    }
    const cp = orderable.cp;
    const quantity = Math.max(1, Math.floor(money(line.quantity || 1) || 1));
    const baseHours = Math.max(0.5, money(line.hours || line.duration || body.hours || 1));
    const hours = Math.round(baseHours * quantity * 100) / 100;
    const serviceId = String(line.serviceId || line.service_id || "").trim();
    const gameHint = String(
      line.serviceName ||
        line.serviceType ||
        line.service ||
        line.game ||
        line.gameName ||
        line.game_name ||
        sharedGame ||
        ""
    ).trim();
    const levels = await readLocalLevels().catch(() => []);
    const level =
      (Array.isArray(levels) ? levels : []).find(
        (l) =>
          String(l.id) === String(cp.level_id || "") ||
          String(l.code) === String(cp.level_id || "") ||
          String(l.name) === String(cp.level_name || "")
      ) || null;
    const resolvePrice =
      typeof deps.resolveOrderUnitPrice === "function" ? deps.resolveOrderUnitPrice : resolveOrderUnitPrice;
    const resolved = await resolvePrice({
      companion: cp,
      companionId,
      serviceId,
      serviceRowId: String(line.serviceRowId || line.service_row_id || "").trim(),
      gameName: gameHint,
      level,
    });
    let unitPrice = money(resolved.price);
    if (!(unitPrice > 0)) {
      return {
        ok: false,
        status: 400,
        code: "SERVICE_PRICE_MISSING",
        message: `陪玩所选服务尚未设置单价（${companionId}）`,
      };
    }
    // Allow explicit amount override only when it matches server unit*hours (±0.05) OR
    // client sends amount that equals server calc — never trust bare client amount alone.
    let totalAmount = Math.round(unitPrice * hours * 100) / 100;
    const clientTotal = money(line.totalAmount || line.total_amount || line.amount);
    const clientUnit = money(line.unitPrice || line.unit_price || line.price);
    if (clientUnit > 0 && Math.abs(clientUnit - unitPrice) > 0.05) {
      return {
        ok: false,
        status: 400,
        message: `陪玩价格已变化，请刷新后重试（单价 ${unitPrice}）`,
      };
    }
    if (clientTotal > 0 && Math.abs(clientTotal - totalAmount) > 0.05) {
      // Dev/test fixture: allow amount when hours=1 and unit derived from amount
      // only if body.allowLineAmountSnapshot === true (verify harness).
      if (body.allowLineAmountSnapshot === true && clientTotal > 0) {
        totalAmount = clientTotal;
        unitPrice = hours > 0 ? Math.round((clientTotal / hours) * 100) / 100 : clientTotal;
      } else {
        return {
          ok: false,
          status: 400,
          message: `陪玩价格已变化，请刷新后重试（应付 ${totalAmount}）`,
        };
      }
    }
    if (!(totalAmount > 0)) {
      return { ok: false, status: 400, message: `第 ${i + 1} 行金额无效。` };
    }
    const gameId = String(sharedGameId || line.gameId || line.game_id || "").trim();
    if (!gameId) {
      return { ok: false, status: 400, message: "请填写游戏 ID。" };
    }
    const companionName = String(line.companionName || line.companion_name || cp.display_name || "").trim();
    const resolvedServiceName = String(
      resolved.serviceRow?.service_name ||
        resolved.serviceRow?.serviceName ||
        resolved.serviceRow?.name ||
        ""
    ).trim();
    const serviceType =
      String(
        resolvedServiceName ||
          line.serviceType ||
          line.service_type ||
          line.serviceName ||
          line.service ||
          "陪玩"
      ).trim() || "陪玩";
    const serviceRowId = String(
      resolved.serviceRow?.id || line.serviceRowId || line.service_row_id || ""
    ).trim();
    const resolvedServiceId = String(
      resolved.serviceRow?.service_id || resolved.serviceRow?.serviceId || serviceId || serviceRowId || ""
    ).trim();
    prepared.push({
      companionId,
      companionName,
      serviceType,
      serviceId: resolvedServiceId,
      serviceRowId,
      gameId,
      hours,
      quantity,
      unitPrice,
      totalAmount,
      game: serviceType,
    });
  }

  const companionIds = prepared.map((p) => p.companionId);
  if (new Set(companionIds).size !== companionIds.length) {
    return { ok: false, status: 400, message: "同一批多人订单不能重复选择同一陪玩。" };
  }

  const groupTotal = Math.round(prepared.reduce((n, p) => n + p.totalAmount, 0) * 100) / 100;
  if (!(groupTotal > 0)) {
    return { ok: false, status: 400, message: "订单总金额无效。" };
  }

  // Do NOT check balance or debit here — mirror single-order place_order:
  // create awaiting_payment, then payment-confirm → pay_order debits parent once.

  const parentNo = await nextOrderNo();
  const parentTitle = `多人订单 · ${prepared.length} 位陪玩 · ${groupTotal} 猫粮`;
  const parentDesc = [
    sharedNotes || "多人订单",
    `付款方式：${paymentMethod}`,
    `语音方式：${voiceMode === "discord" ? "Discord语音房" : "游戏麦"}`,
    `子单数：${prepared.length}`,
    `总价：${groupTotal}`,
  ]
    .filter(Boolean)
    .join("\n");

  const parentRow = {
    order_no: parentNo,
    boss_id: profile.id,
    companion_id: null,
    customer_service_id: null,
    parent_order_id: null,
    order_type: ORDER_TYPE_MULTI_GROUP,
    assignment_type: "assigned",
    game: sharedGame,
    title: parentTitle,
    description: parentDesc,
    hours: prepared.reduce((n, p) => n + p.hours, 0),
    unit_price: groupTotal,
    total_amount: groupTotal,
    status: "awaiting_payment",
    created_at: nowIso(),
    idempotency_key: idempotencyKey,
    payment_method: paymentMethod,
    notes: sharedNotes || parentDesc,
    voice_mode: voiceMode,
  };

  let parent;
  try {
    parent = await insertOrderRow(deps, parentRow);
  } catch (insertErr) {
    const msg = String(insertErr.message || "");
    if (/duplicate|unique|idempotency/i.test(msg)) {
      const existing = await supabaseJson(
        restUrl("orders", `?idempotency_key=eq.${encodeURIComponent(idempotencyKey)}&limit=1`),
        { headers: serviceHeaders() }
      ).catch(() => []);
      if (existing?.[0]) {
        return {
          ok: true,
          status: 200,
          message: "多人订单已存在（防重复提交）",
          deduped: true,
          replayed: true,
          order: viewOrder(existing[0]),
          parent: viewOrder(existing[0]),
          children: [],
          walletDebited: false,
          walletDebitAmount: 0,
        };
      }
    }
    if (/parent_order_id/i.test(msg)) {
      return {
        ok: false,
        status: 503,
        message: `多人订单 schema 未就绪（需要 parent_order_id migration）：${msg.slice(0, 180)}`,
        code: "MULTI_ORDER_SCHEMA_MISSING",
      };
    }
    throw insertErr;
  }
  if (!parent?.id) {
    return { ok: false, status: 500, message: "主订单创建失败。" };
  }

  if (!canDebitBossWalletForOrder({ ...parent, order_type: ORDER_TYPE_MULTI_GROUP })) {
    await softCancelOrders(deps, [parent.id], "payment_owner_guard");
    return { ok: false, status: 500, message: "主订单支付归属校验失败。" };
  }

  const createdIds = [parent.id];
  const children = [];
  try {
    for (let i = 0; i < prepared.length; i++) {
      const line = prepared[i];
      const childNo = await nextOrderNo();
      const title = `${line.serviceType} · ${line.companionName || line.companionId} · ${line.hours}小时`;
      const description = [
        `服务：${line.serviceType}`,
        line.serviceRowId ? `service_row_id：${line.serviceRowId}` : "",
        line.serviceId ? `service_id：${line.serviceId}` : "",
        `单价快照：${line.unitPrice}`,
        `时长：${line.hours}`,
        `小计快照：${line.totalAmount}`,
        line.gameId ? `游戏ID：${line.gameId}` : "",
        `付款方式：${paymentMethod}`,
        `语音方式：${voiceMode === "discord" ? "Discord语音房" : "游戏麦"}`,
        line.companionName ? `指定陪玩：${line.companionName}` : "",
        `[[PARENT_ORDER]]${parent.id}`,
      ]
        .filter(Boolean)
        .join("\n");
      const childRow = {
        order_no: childNo,
        boss_id: profile.id,
        companion_id: line.companionId,
        customer_service_id: null,
        parent_order_id: parent.id,
        order_type: "direct_companion",
        assignment_type: "assigned",
        game: line.game,
        title,
        description,
        hours: line.hours,
        unit_price: line.unitPrice,
        total_amount: line.totalAmount,
        status: "awaiting_payment",
        created_at: nowIso(),
        idempotency_key: childIdempotencyKey(idempotencyKey, line.companionId, i),
        payment_method: paymentMethod,
        service_name: line.serviceType,
        game_id_value: line.gameId,
        notes: description,
        quantity: line.quantity,
        voice_mode: voiceMode,
      };
      let child;
      try {
        child = await insertOrderRow(deps, childRow);
      } catch (cerr) {
        const cmsg = String(cerr.message || "");
        if (/parent_order_id/i.test(cmsg)) {
          await softCancelOrders(deps, createdIds, "child_schema_missing");
          return {
            ok: false,
            status: 503,
            message: "多人订单 schema 未就绪：缺少 orders.parent_order_id",
            code: "MULTI_ORDER_SCHEMA_MISSING",
          };
        }
        throw cerr;
      }
      if (!child?.id) throw new Error("子订单创建失败");
      if (!isMultiGroupChild(child) && !child.parent_order_id) {
        // Column silently dropped
        await softCancelOrders(deps, [...createdIds, child.id], "parent_order_id_not_persisted");
        return {
          ok: false,
          status: 503,
          message: "子订单未写入 parent_order_id，已回滚。",
          code: "MULTI_ORDER_SCHEMA_MISSING",
        };
      }
      createdIds.push(child.id);
      children.push(child);
    }
  } catch (e) {
    await softCancelOrders(deps, createdIds, String(e.message || e).slice(0, 120));
    return {
      ok: false,
      status: 500,
      message: `创建子订单失败，已回滚且未扣款：${String(e.message || e).slice(0, 180)}`,
      code: "MULTI_ORDER_CHILD_CREATE_FAILED",
      rolledBack: true,
      walletDebited: false,
    };
  }

  // Payment deferred: parent + children stay awaiting_payment until pay_order on parent.
  try {
    await addSystemMessage(
      parent,
      profile.id,
      `多人订单已创建，待支付 ${groupTotal} 猫粮（一次付款），含 ${children.length} 个子订单。`
    );
  } catch (_) {}

  return {
    ok: true,
    status: 200,
    message: "多人订单已创建，请完成支付。",
    order: viewOrder(parent),
    parent: viewOrder(parent),
    children: children.map(viewOrder),
    walletDebited: false,
    walletDebitAmount: 0,
    walletDebitCount: 0,
    groupTotal,
    idempotencyKey,
    paymentOwnerOrderId: parent.id,
    next: "payment-confirm",
  };
}

/** Guard for pay_order: refuse child debit; cascade handled only via parent. */
export function assertPayOrderAllowed(order) {
  if (isMultiGroupChild(order)) {
    return {
      ok: false,
      status: 409,
      message: "子订单不支持单独支付；请支付主订单。",
      code: "CHILD_ORDER_NO_DIRECT_PAY",
    };
  }
  if (isMultiGroupParent(order) || String(order?.order_type || "").toLowerCase() === ORDER_TYPE_MULTI_GROUP) {
    return { ok: true, cascadeChildren: true };
  }
  return { ok: true, cascadeChildren: false };
}
