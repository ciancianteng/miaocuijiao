/**
 * Gift order lifecycle for mall:
 * create → pay info → upload proof → CS approve/reject → fulfill once.
 */
import {
  companionDb,
  isMissingRelation,
  decodeDataUrl,
  ensurePrivateBucket,
  uploadPrivateObject,
  buildObjectPath,
  createSignedUrl,
} from "./_companion-media-store.js";
import { loadPlatformPayQr, listBossOrderPaymentMethods } from "./_platform-pay-qr.js";
import { insertCompanionNotification } from "./_companion-inbox.js";
import { scheduleRecomputeSoft } from "./_popularity.js";

const PROOF_BUCKET = "companion-payment-proofs";
const IMAGE_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

export const GIFT_ORDER_STATUS = {
  PENDING_PAYMENT: "pending_payment",
  PAYMENT_SUBMITTED: "payment_submitted",
  UNDER_REVIEW: "under_review",
  APPROVED: "approved",
  REJECTED: "rejected",
  CANCELLED: "cancelled",
};

const REVIEWABLE = new Set([
  GIFT_ORDER_STATUS.PAYMENT_SUBMITTED,
  GIFT_ORDER_STATUS.UNDER_REVIEW,
]);

function nowIso() {
  return new Date().toISOString();
}

function money(v) {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function orderNo() {
  return `GO-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

function txNo() {
  return `GIFT-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

function httpError(message, status = 400, extra = {}) {
  return Object.assign(new Error(message), { status, ...extra });
}

export function viewGiftOrder(row = {}, extra = {}) {
  if (!row) return null;
  return {
    id: row.id,
    orderNo: row.order_no,
    senderBossId: row.sender_boss_id,
    receiverCompanionId: row.receiver_companion_id,
    giftId: row.gift_id,
    giftName: row.gift_name_snapshot,
    giftImage: row.gift_image_snapshot,
    unitPrice: money(row.unit_price),
    quantity: Number(row.quantity || 1),
    totalAmount: money(row.total_amount),
    currency: row.currency || "MYR",
    status: row.status,
    paymentChannel: row.payment_channel || "",
    paymentInstructions: row.payment_instructions || "",
    paymentQrUrl: row.payment_qr_url || "",
    paymentProofPath: row.payment_proof_path || "",
    paymentProofMime: row.payment_proof_mime || "",
    paymentProofUploadedAt: row.payment_proof_uploaded_at || "",
    paymentProofUrl: extra.paymentProofUrl || "",
    reviewedAt: row.reviewed_at || "",
    reviewedBy: row.reviewed_by || "",
    reviewedByName: row.reviewed_by_name || "",
    rejectReason: row.reject_reason || "",
    fulfilledTransactionId: row.fulfilled_transaction_id || "",
    fulfilledAt: row.fulfilled_at || "",
    clientNote: row.client_note || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
    senderName: extra.senderName || "",
    senderUid: extra.senderUid || "",
    receiverName: extra.receiverName || "",
    receiverUid: extra.receiverUid || "",
    receiverAvatar: extra.receiverAvatar || "",
  };
}

async function patchOrder(id, patch, { onlyStatuses = null } = {}) {
  let q = `?id=eq.${encodeURIComponent(id)}`;
  if (onlyStatuses?.length) {
    q += `&status=in.(${onlyStatuses.map(encodeURIComponent).join(",")})`;
  }
  const rows = await companionDb("gift_orders", q, {
    method: "PATCH",
    body: JSON.stringify({ ...patch, updated_at: nowIso() }),
  });
  return rows?.[0] || null;
}

export async function getGiftOrderById(id) {
  const rows = await companionDb("gift_orders", `?id=eq.${encodeURIComponent(id)}&limit=1`).catch((e) => {
    if (isMissingRelation(e)) return [];
    throw e;
  });
  return rows?.[0] || null;
}

async function loadGift(giftId) {
  try {
    const rows = await companionDb(
      "gifts",
      `?id=eq.${encodeURIComponent(giftId)}&enabled=eq.true&deleted_at=is.null&limit=1`
    );
    if (rows?.[0]) return rows[0];
  } catch (e) {
    if (!isMissingRelation(e) && !/deleted_at|column/i.test(String(e.message || ""))) throw e;
  }
  const rows = await companionDb("gifts", `?id=eq.${encodeURIComponent(giftId)}&enabled=eq.true&limit=1`).catch((e) => {
    if (isMissingRelation(e)) return [];
    throw e;
  });
  return rows?.[0] || null;
}

async function loadCompanionProfile(companionUserId) {
  const rows = await companionDb(
    "companion_profiles",
    `?user_id=eq.${encodeURIComponent(companionUserId)}&limit=1`
  ).catch(() => []);
  return rows?.[0] || null;
}

async function loadBossProfile(bossId) {
  const rows = await companionDb(
    "profiles",
    `?id=eq.${encodeURIComponent(bossId)}&select=id,display_name,nickname,avatar_url,uid,public_id&limit=1`
  ).catch(() => []);
  return rows?.[0] || null;
}

async function giftCommissionRate(companionRow) {
  const fromCompanion = money(companionRow?.gift_commission_rate);
  if (fromCompanion > 0) return fromCompanion;
  try {
    const rows = await companionDb("gift_settings", "?id=eq.1&limit=1");
    return money(rows?.[0]?.commission_rate ?? 20);
  } catch {
    return 20;
  }
}

async function creditCompanionIncome(companionId, amount, note, relatedId) {
  if (amount <= 0) return;
  try {
    await companionDb("transactions", "", {
      method: "POST",
      body: JSON.stringify({
        user_id: companionId,
        order_id: relatedId || null,
        transaction_type: "companion_income",
        amount,
        status: "completed",
        note: note || "礼物收益",
        created_at: nowIso(),
      }),
    });
  } catch (e) {
    if (!isMissingRelation(e)) console.warn("[gift-orders] creditCompanionIncome", e?.message || e);
  }
}

export async function resolveGiftPaymentInfo(preferredMethod = "") {
  const listed = await listBossOrderPaymentMethods([]).catch(() => ({ methods: [] }));
  const methods = Array.isArray(listed?.methods) ? listed.methods : Array.isArray(listed) ? listed : [];
  const manual = methods.filter((m) => {
    const code = String(m.code || m.id || "").toLowerCase();
    return m.enabled !== false && m.open !== false && !/catfood|wallet|猫粮/.test(code);
  });
  const preferred = String(preferredMethod || "").trim();
  const pick =
    (preferred && manual.find((m) => String(m.code || m.id).toLowerCase() === preferred.toLowerCase())) ||
    manual.find((m) => m.configured || m.qrUrl) ||
    manual[0] ||
    null;
  const channel = String(pick?.code || pick?.id || preferred || "duitnow").trim();
  const pay = await loadPlatformPayQr(channel).catch(() => null);
  return {
    channel,
    channelName: pick?.name || pick?.label || pay?.title || channel,
    qrUrl: pay?.qrUrl || pick?.qrUrl || "",
    instructions:
      pay?.instructions ||
      pick?.instructions ||
      "请按应付金额完成转账，并上传付款截图等待客服审核。审核通过后礼物才会到账。",
    methods: manual.map((m) => ({
      code: m.code || m.id,
      name: m.name || m.label || m.code,
      enabled: m.enabled !== false,
    })),
    pay,
  };
}

export async function createGiftOrder({
  bossId,
  companionId,
  giftId,
  quantity = 1,
  idempotencyKey = "",
  paymentChannel = "",
  clientNote = "",
}) {
  const boss = String(bossId || "").trim();
  const companion = String(companionId || "").trim();
  const gid = String(giftId || "").trim();
  const qty = Math.max(1, Math.floor(Number(quantity || 1)));
  const key = String(idempotencyKey || "").trim();
  if (!boss) throw httpError("请先登录老板账号", 401);
  if (!companion) throw httpError("请选择赠送对象陪玩", 400);
  if (!gid) throw httpError("请选择礼物", 400);
  if (!key) throw httpError("缺少 idempotency_key", 400);

  try {
    const existed = await companionDb("gift_orders", `?idempotency_key=eq.${encodeURIComponent(key)}&limit=1`);
    if (existed?.[0]) {
    const payInfoEarly = await resolveGiftPaymentInfo(paymentChannel).catch(() => null);
    return { order: existed[0], replayed: true, payInfo: payInfoEarly };
  }
  } catch (e) {
    if (!isMissingRelation(e)) throw e;
  }

  const gift = await loadGift(gid);
  if (!gift) throw httpError("礼物不存在或已下架", 400);
  const companionRow = await loadCompanionProfile(companion);
  if (!companionRow) throw httpError("陪玩不存在", 404);

  const unit = money(gift.cat_food_price);
  if (unit <= 0) throw httpError("礼物价格无效", 400);
  const total = money(unit * qty);
  const payInfo = await resolveGiftPaymentInfo(paymentChannel);

  const row = {
    order_no: orderNo(),
    sender_boss_id: boss,
    receiver_companion_id: companion,
    gift_id: gift.id,
    gift_name_snapshot: String(gift.name || "礼物"),
    gift_image_snapshot: String(gift.icon_url || ""),
    unit_price: unit,
    quantity: qty,
    total_amount: total,
    currency: "MYR",
    status: GIFT_ORDER_STATUS.PENDING_PAYMENT,
    payment_channel: payInfo.channel,
    payment_instructions: payInfo.instructions,
    payment_qr_url: payInfo.qrUrl || "",
    idempotency_key: key,
    client_note: String(clientNote || "").trim(),
    created_at: nowIso(),
    updated_at: nowIso(),
  };

  let created;
  try {
    const rows = await companionDb("gift_orders", "", {
      method: "POST",
      body: JSON.stringify(row),
    });
    created = rows?.[0] || row;
  } catch (e) {
    if (isMissingRelation(e)) {
      throw httpError("礼物订单表未就绪，请先在 Staging 执行 migration", 503, {
        code: "GIFT_ORDERS_MISSING",
      });
    }
    if (/duplicate|unique|23505/i.test(String(e.message || e.body || ""))) {
      const again = await companionDb(
        "gift_orders",
        `?idempotency_key=eq.${encodeURIComponent(key)}&limit=1`
      ).catch(() => []);
      if (again?.[0]) return { order: again[0], replayed: true };
    }
    throw e;
  }

  return { order: created, replayed: false, payInfo };
}

export async function listBossGiftOrders(bossId, { status = "", limit = 50 } = {}) {
  let q = `?sender_boss_id=eq.${encodeURIComponent(bossId)}&order=created_at.desc&limit=${Math.min(
    100,
    Number(limit) || 50
  )}`;
  if (status) q += `&status=eq.${encodeURIComponent(status)}`;
  return companionDb("gift_orders", q).catch((e) => {
    if (isMissingRelation(e)) return [];
    throw e;
  });
}

export async function listReviewGiftOrders({ status = "under_review", limit = 100 } = {}) {
  const st = String(status || "").trim();
  let q = `?order=created_at.desc&limit=${Math.min(200, Number(limit) || 100)}`;
  if (st === "pending_review" || st === "under_review" || st === "review") {
    q = `?status=in.(${encodeURIComponent(GIFT_ORDER_STATUS.PAYMENT_SUBMITTED)},${encodeURIComponent(
      GIFT_ORDER_STATUS.UNDER_REVIEW
    )})&order=payment_proof_uploaded_at.asc.nullslast&limit=${Math.min(200, Number(limit) || 100)}`;
  } else if (st && st !== "all") {
    q = `?status=eq.${encodeURIComponent(st)}&order=created_at.desc&limit=${Math.min(200, Number(limit) || 100)}`;
  }
  return companionDb("gift_orders", q).catch((e) => {
    if (isMissingRelation(e)) return [];
    throw e;
  });
}

export async function signedGiftProofUrl(order, expiresIn = 3600) {
  const path = String(order?.payment_proof_path || "").trim();
  if (!path) return "";
  return createSignedUrl(PROOF_BUCKET, path, Math.max(300, Number(expiresIn) || 3600));
}

export async function enrichGiftOrders(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return [];
  const bossIds = [...new Set(list.map((r) => r.sender_boss_id).filter(Boolean))];
  const companionIds = [...new Set(list.map((r) => r.receiver_companion_id).filter(Boolean))];
  const bosses = bossIds.length
    ? await companionDb(
        "profiles",
        `?id=in.(${bossIds.map(encodeURIComponent).join(",")})&select=id,display_name,nickname,uid,public_id`
      ).catch(() => [])
    : [];
  const companions = companionIds.length
    ? await companionDb(
        "companion_profiles",
        `?user_id=in.(${companionIds.map(encodeURIComponent).join(",")})&select=user_id,nickname,avatar_url,companion_uid`
      ).catch(() => [])
    : [];
  const bossMap = Object.fromEntries((bosses || []).map((b) => [b.id, b]));
  const companionMap = Object.fromEntries((companions || []).map((c) => [c.user_id, c]));
  const out = [];
  for (const row of list) {
    const b = bossMap[row.sender_boss_id] || {};
    const c = companionMap[row.receiver_companion_id] || {};
    let paymentProofUrl = "";
    if (row.payment_proof_path) {
      paymentProofUrl = await signedGiftProofUrl(row).catch(() => "");
    }
    out.push(
      viewGiftOrder(row, {
        senderName: b.nickname || b.display_name || "",
        senderUid: b.uid || b.public_id || "",
        receiverName: c.nickname || "",
        receiverUid: c.companion_uid ? `P${c.companion_uid}` : "",
        receiverAvatar: c.avatar_url || "",
        paymentProofUrl,
      })
    );
  }
  return out;
}

export async function uploadGiftOrderProof({ orderId, bossId, dataUrl }) {
  const order = await getGiftOrderById(orderId);
  if (!order) throw httpError("礼物订单不存在", 404);
  if (String(order.sender_boss_id) !== String(bossId)) throw httpError("无权操作该订单", 403);
  if (
    ![
      GIFT_ORDER_STATUS.PENDING_PAYMENT,
      GIFT_ORDER_STATUS.PAYMENT_SUBMITTED,
      GIFT_ORDER_STATUS.UNDER_REVIEW,
      GIFT_ORDER_STATUS.REJECTED,
    ].includes(order.status)
  ) {
    throw httpError("当前订单状态不可上传付款截图", 409);
  }

  const decoded = decodeDataUrl(dataUrl);
  if (!decoded?.buffer?.length || !IMAGE_TYPES.has(String(decoded.contentType).toLowerCase())) {
    throw httpError("请上传 JPG、PNG 或 WEBP 格式的付款截图", 400);
  }
  if (decoded.buffer.length > 10 * 1024 * 1024) throw httpError("付款截图不能超过 10MB", 413);

  await ensurePrivateBucket(PROOF_BUCKET, [...IMAGE_TYPES]);
  const ext = String(decoded.contentType).includes("png")
    ? "png"
    : String(decoded.contentType).includes("webp")
      ? "webp"
      : "jpg";
  const storagePath = buildObjectPath(bossId, `gift-order-proofs/${order.id}`, `proof-${Date.now()}.${ext}`);
  await uploadPrivateObject(PROOF_BUCKET, storagePath, decoded.buffer, decoded.contentType);

  const updated = await patchOrder(
    order.id,
    {
      payment_proof_path: storagePath,
      payment_proof_mime: decoded.contentType,
      payment_proof_uploaded_at: nowIso(),
      status: GIFT_ORDER_STATUS.UNDER_REVIEW,
      reject_reason: "",
      reviewed_at: null,
      reviewed_by: null,
      reviewed_by_name: "",
    },
    {
      onlyStatuses: [
        GIFT_ORDER_STATUS.PENDING_PAYMENT,
        GIFT_ORDER_STATUS.PAYMENT_SUBMITTED,
        GIFT_ORDER_STATUS.UNDER_REVIEW,
        GIFT_ORDER_STATUS.REJECTED,
      ],
    }
  );
  if (!updated) {
    const latest = await getGiftOrderById(order.id);
    if (latest?.status === GIFT_ORDER_STATUS.APPROVED) {
      throw httpError("订单已审核通过，无需再上传", 409);
    }
    throw httpError("上传失败，请重试", 409);
  }

  const proofUrl = await signedGiftProofUrl(updated).catch(() => "");
  return { order: updated, proofUrl };
}

async function upsertGiftWall(order) {
  const companionId = order.receiver_companion_id;
  const giftName = order.gift_name_snapshot || "礼物";
  const qty = Number(order.quantity || 1);
  let existing;
  try {
    existing = await companionDb(
      "companion_gift_wall",
      `?companion_id=eq.${encodeURIComponent(companionId)}&gift_name=eq.${encodeURIComponent(giftName)}&limit=1`
    );
  } catch (e) {
    if (isMissingRelation(e)) return;
    throw e;
  }
  if (existing?.[0]) {
    await companionDb(
      "companion_gift_wall",
      `?companion_id=eq.${encodeURIComponent(companionId)}&gift_name=eq.${encodeURIComponent(giftName)}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          gift_id: order.gift_id || existing[0].gift_id,
          gift_image_url: order.gift_image_snapshot || existing[0].gift_image_url || "",
          total_quantity: Number(existing[0].total_quantity || 0) + qty,
          last_received_at: nowIso(),
          updated_at: nowIso(),
        }),
      }
    );
    return;
  }
  await companionDb("companion_gift_wall", "", {
    method: "POST",
    body: JSON.stringify({
      companion_id: companionId,
      gift_id: order.gift_id || null,
      gift_name: giftName,
      gift_image_url: order.gift_image_snapshot || "",
      total_quantity: qty,
      last_received_at: nowIso(),
      updated_at: nowIso(),
    }),
  });
}

async function insertFulfilledTransaction(order, rate) {
  const gross = money(order.total_amount);
  const commissionAmount = Math.round(gross * (rate / 100) * 100) / 100;
  const companionIncome = Math.round((gross - commissionAmount) * 100) / 100;
  const payload = {
    tx_no: txNo(),
    sender_boss_id: order.sender_boss_id,
    receiver_companion_id: order.receiver_companion_id,
    gift_id: order.gift_id,
    gift_name: order.gift_name_snapshot,
    quantity: order.quantity,
    gross_cat_food: gross,
    platform_commission_rate: rate,
    platform_commission_amount: commissionAmount,
    companion_income: companionIncome,
    message: "",
    related_order_id: null,
    kind: "gift",
    idempotency_key: `gift-order:${order.id}`,
    gift_order_id: order.id,
    fulfillment_status: "completed",
    gift_image_url: order.gift_image_snapshot || "",
    created_at: nowIso(),
  };
  try {
    const rows = await companionDb("gift_transactions", "", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return { tx: rows?.[0] || payload, companionIncome, commissionAmount, rate, gross, replayed: false };
  } catch (e) {
    if (/duplicate|unique|23505/i.test(String(e.message || e.body || ""))) {
      const existing = await companionDb(
        "gift_transactions",
        `?gift_order_id=eq.${encodeURIComponent(order.id)}&limit=1`
      ).catch(() => []);
      if (existing?.[0]) {
        return {
          tx: existing[0],
          companionIncome: money(existing[0].companion_income),
          commissionAmount: money(existing[0].platform_commission_amount),
          rate: money(existing[0].platform_commission_rate),
          gross: money(existing[0].gross_cat_food),
          replayed: true,
        };
      }
    }
    throw e;
  }
}

export async function approveGiftOrder({ orderId, staffId, staffName = "" }) {
  const id = String(orderId || "").trim();
  if (!id) throw httpError("缺少礼物订单 ID", 400);
  const order = await getGiftOrderById(id);
  if (!order) throw httpError("礼物订单不存在", 404);

  if (order.status === GIFT_ORDER_STATUS.APPROVED && order.fulfilled_transaction_id) {
    return { order, replayed: true, message: "已审核通过（幂等）" };
  }
  if (order.status === GIFT_ORDER_STATUS.REJECTED) throw httpError("订单已拒绝，无法通过", 409);
  if (!REVIEWABLE.has(order.status) && order.status !== GIFT_ORDER_STATUS.APPROVED) {
    throw httpError("当前状态不可审核通过", 409);
  }
  if (!String(order.payment_proof_path || "").trim()) throw httpError("尚未上传付款截图", 409);

  const claimed = await patchOrder(
    id,
    {
      status: GIFT_ORDER_STATUS.APPROVED,
      reviewed_at: nowIso(),
      reviewed_by: staffId || null,
      reviewed_by_name: String(staffName || "").trim(),
      reject_reason: "",
    },
    { onlyStatuses: [...REVIEWABLE] }
  );

  let working = claimed;
  if (!working) {
    const latest = await getGiftOrderById(id);
    if (latest?.status === GIFT_ORDER_STATUS.APPROVED) working = latest;
    else throw httpError("审核冲突，请刷新后重试", 409);
  }

  if (working.fulfilled_transaction_id) {
    return { order: working, replayed: true, message: "已审核通过（幂等）" };
  }

  const companionRow = await loadCompanionProfile(working.receiver_companion_id);
  const rate = await giftCommissionRate(companionRow || {});
  const fulfilled = await insertFulfilledTransaction(working, rate);

  if (!fulfilled.replayed) {
    await creditCompanionIncome(
      working.receiver_companion_id,
      fulfilled.companionIncome,
      `${working.gift_name_snapshot}收益`,
      working.id
    );
    await upsertGiftWall(working);
    const boss = await loadBossProfile(working.sender_boss_id);
    const bossName = boss?.nickname || boss?.display_name || "一位老板";
    await insertCompanionNotification({
      companionUserId: working.receiver_companion_id,
      category: "gift",
      title: "你收到了一份新礼物",
      body: `${bossName} 送出了「${working.gift_name_snapshot}」×${working.quantity}`,
      href: "/companion/gifts",
      noticeKey: `gift-order-approved-${working.id}`,
      notificationType: "gift_received",
      relatedApplicationId: working.id,
    }).catch((err) => console.warn("[gift-orders] notify", err?.message || err));
    try {
      scheduleRecomputeSoft();
    } catch {
      /* optional */
    }
  }

  const finalized = await patchOrder(id, {
    status: GIFT_ORDER_STATUS.APPROVED,
    fulfilled_transaction_id: fulfilled.tx?.id || working.fulfilled_transaction_id || null,
    fulfilled_at: nowIso(),
  });

  return {
    order: finalized || working,
    transaction: fulfilled.tx,
    replayed: !!fulfilled.replayed,
    message: fulfilled.replayed ? "已审核通过（幂等）" : "审核通过，礼物已到账",
  };
}

export async function rejectGiftOrder({ orderId, staffId, staffName = "", reason = "" }) {
  const id = String(orderId || "").trim();
  const why = String(reason || "").trim();
  if (!id) throw httpError("缺少礼物订单 ID", 400);
  if (!why) throw httpError("拒绝必须填写原因", 400);
  const order = await getGiftOrderById(id);
  if (!order) throw httpError("礼物订单不存在", 404);
  if (order.status === GIFT_ORDER_STATUS.APPROVED) throw httpError("订单已通过，无法拒绝", 409);
  if (order.status === GIFT_ORDER_STATUS.REJECTED) {
    return { order, replayed: true, message: "已拒绝（幂等）" };
  }
  const updated = await patchOrder(
    id,
    {
      status: GIFT_ORDER_STATUS.REJECTED,
      reviewed_at: nowIso(),
      reviewed_by: staffId || null,
      reviewed_by_name: String(staffName || "").trim(),
      reject_reason: why,
    },
    { onlyStatuses: [...REVIEWABLE, GIFT_ORDER_STATUS.PENDING_PAYMENT] }
  );
  if (!updated) {
    const latest = await getGiftOrderById(id);
    if (latest?.status === GIFT_ORDER_STATUS.REJECTED) {
      return { order: latest, replayed: true, message: "已拒绝（幂等）" };
    }
    throw httpError("拒绝失败，请刷新后重试", 409);
  }
  return { order: updated, replayed: false, message: "已拒绝该礼物订单" };
}

export async function listCompanionReceivedGifts(companionId, { limit = 100 } = {}) {
  const rows = await companionDb(
    "gift_transactions",
    `?receiver_companion_id=eq.${encodeURIComponent(companionId)}&order=created_at.desc&limit=${Math.min(
      200,
      Number(limit) || 100
    )}`
  ).catch((e) => {
    if (isMissingRelation(e)) return [];
    throw e;
  });
  return (rows || []).filter((r) => {
    const st = String(r.fulfillment_status || "").toLowerCase();
    return !st || st === "completed";
  });
}

export async function getCompanionGiftWall(companionId) {
  const rows = await companionDb(
    "companion_gift_wall",
    `?companion_id=eq.${encodeURIComponent(companionId)}&total_quantity=gt.0&order=total_quantity.desc&limit=100`
  ).catch((e) => {
    if (isMissingRelation(e)) return [];
    throw e;
  });
  return (rows || []).map((r) => ({
    giftId: r.gift_id,
    giftName: r.gift_name,
    giftImage: r.gift_image_url || "",
    totalQuantity: Number(r.total_quantity || 0),
    lastReceivedAt: r.last_received_at || "",
  }));
}
