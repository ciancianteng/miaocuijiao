/**
 * Boss renewal: a NEW order linked to a completed order.
 * Does not update the source row. parent_order_id stays reserved for multi-group children.
 *
 * Link columns: is_renewal, renewal_of_order_id, renewal_source_order_no.
 * Payment, CS review and companion accept stay on the existing order status machine.
 */

export const RENEWABLE_STATUSES = ["completed", "reviewed"];
export const OPEN_RENEWAL_STATUSES = [
  "awaiting_payment",
  "claimed",
  "pending",
  "confirmed",
  "in_progress",
  "waiting_boss_confirm",
];

export function money(value) {
  const n = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

/** Integer hours only, 1–24. Ignores any client total. */
export function normalizeRenewalHours(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || Math.abs(n - Math.round(n)) > 1e-9) return null;
  const hours = Math.round(n);
  if (hours < 1 || hours > 24) return null;
  return hours;
}

export function quoteRenewalAmount(unitPrice, hours) {
  const unit = money(unitPrice);
  const h = normalizeRenewalHours(hours);
  if (!(unit > 0) || h == null) return null;
  return {
    hours: h,
    unitPrice: unit,
    totalAmount: Math.round(unit * h * 100) / 100,
  };
}

export function renewalEligibility(source, bossId) {
  if (!source?.id) return { ok: false, status: 404, code: "ORDER_NOT_FOUND", message: "原订单不存在。" };
  if (String(source.boss_id || "") !== String(bossId || "")) {
    return { ok: false, status: 403, code: "NOT_ORDER_BOSS", message: "只能为自己的订单续单。" };
  }
  const type = String(source.order_type || "").toLowerCase();
  if (type === "multi_group" && !source.companion_id) {
    return { ok: false, status: 409, code: "RENEWAL_NOT_FOR_MULTI_PARENT", message: "多人订单请对已完成的陪玩子订单续单。" };
  }
  if (!source.companion_id) {
    return { ok: false, status: 409, code: "RENEWAL_NO_COMPANION", message: "原订单没有指定陪玩，不能续单。" };
  }
  if (!RENEWABLE_STATUSES.includes(String(source.status || ""))) {
    return { ok: false, status: 409, code: "RENEWAL_STATUS", message: "只有已完成的订单可以续单。" };
  }
  return { ok: true };
}

export function isOpenRenewal(row) {
  return !!row && OPEN_RENEWAL_STATUSES.includes(String(row.status || ""));
}

const OPEN_STATUS_FILTER = OPEN_RENEWAL_STATUSES.join(",");

function fail(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

async function loadSource(db, id) {
  const rows = await db.supabaseJson(
    db.restUrl("orders", `?id=eq.${encodeURIComponent(id)}&limit=1`),
    { headers: db.serviceHeaders() }
  );
  return rows?.[0] || null;
}

async function findOpenRenewal(db, sourceId, bossId) {
  const rows = await db.supabaseJson(
    db.restUrl(
      "orders",
      `?renewal_of_order_id=eq.${encodeURIComponent(sourceId)}&boss_id=eq.${encodeURIComponent(bossId)}&is_renewal=eq.true&status=in.(${OPEN_STATUS_FILTER})&order=created_at.desc&limit=1`
    ),
    { headers: db.serviceHeaders() }
  );
  return rows?.[0] || null;
}

export async function previewRenewal({ profile, body, db }) {
  const sourceId = String(body.sourceOrderId || body.source_order_id || body.orderId || body.id || "").trim();
  const source = await loadSource(db, sourceId);
  const gate = renewalEligibility(source, profile.id);
  if (!gate.ok) throw fail(gate.status, gate.code, gate.message);
  const hours = normalizeRenewalHours(body.hours ?? source.hours ?? 1);
  if (hours == null) throw fail(400, "BAD_HOURS", "续单小时数请填写 1 到 24 的整数。");
  const unitPrice = await resolveCurrentUnitPrice(db, source);
  const quote = quoteRenewalAmount(unitPrice, hours);
  if (!quote) throw fail(400, "SERVICE_PRICE_MISSING", "该陪玩当前服务没有有效单价，无法续单。");
  const mismatch = clientAmountMismatch(quote, body);
  return {
    sourceOrderId: source.id,
    sourceOrderNo: source.order_no || "",
    companionId: source.companion_id,
    game: source.game || "",
    serviceName: source.service_name || source.game || "",
    serviceType: source.service_type || source.service_name || "",
    ...quote,
    priceChanged: mismatch,
    openRenewal: await findOpenRenewal(db, source.id, profile.id).catch(() => null),
  };
}

async function resolveCurrentUnitPrice(db, source) {
  if (typeof db.resolveCurrentUnitPrice === "function") {
    return money(await db.resolveCurrentUnitPrice(source));
  }
  const { resolveOrderUnitPrice } = await import("./_admin-service-prices.js");
  const { readLocalLevels } = await import("./_companion-levels-store.js");
  const orderable = await db.assertCompanionOrderable(source.companion_id);
  if (!orderable?.ok) {
    throw fail(400, orderable?.code || "COMPANION_NOT_ORDERABLE", orderable?.message || "该陪玩暂不可续单。");
  }
  const cp = orderable.cp;
  const levels = await readLocalLevels().catch(() => []);
  const level =
    (Array.isArray(levels) ? levels : []).find(
      (l) =>
        String(l.id) === String(cp.level_id || "") ||
        String(l.code) === String(cp.level_id || "") ||
        String(l.name) === String(cp.level_name || "")
    ) || null;
  const resolved = await resolveOrderUnitPrice({
    companion: cp,
    companionId: source.companion_id,
    serviceId: String(source.service_id || "").trim(),
    gameName: String(source.service_name || source.game || "").trim(),
    level,
  });
  return money(resolved?.price);
}

/**
 * Insert a new awaiting_payment order. Never patches the source order.
 * A second submit while one renewal is still open returns that row.
 */
export async function createRenewalOrder({ profile, body, db }) {
  const preview = await previewRenewal({ profile, body, db });
  if (preview.priceChanged) {
    throw fail(409, "PRICE_CHANGED", `价格已变化，请按当前单价 ${preview.unitPrice} 猫粮重新确认（应付 ${preview.totalAmount}）。`);
  }
  const existing = preview.openRenewal;
  if (existing?.id) {
    return { order: existing, deduped: true, quote: preview };
  }
  const source = await loadSource(db, preview.sourceOrderId);
  const now = new Date().toISOString();
  const paymentMethod = String(source.payment_method || body.paymentMethod || "duitnow").trim() || "duitnow";
  const gameId = String(source.game_id_value || source.game_id || "").trim();
  const serviceName = preview.serviceName || source.game || "陪玩";
  const companionName = String(body.companionName || "").trim();
  const row = {
    order_no: await db.nextOrderNo(),
    boss_id: profile.id,
    companion_id: source.companion_id,
    customer_service_id: null,
    order_type: "direct_companion",
    assignment_type: "assigned",
    game: source.game || serviceName,
    title: `续单 · ${serviceName} · ${preview.hours}小时`,
    description: [
      `续单，原订单：${source.order_no || source.id}`,
      gameId ? `游戏ID：${gameId}` : "",
      `付款方式：${paymentMethod}`,
      "指定陪玩：续单沿用原陪玩",
    ]
      .filter(Boolean)
      .join("\n"),
    hours: preview.hours,
    unit_price: preview.unitPrice,
    total_amount: preview.totalAmount,
    status: "awaiting_payment",
    created_at: now,
    payment_method: paymentMethod,
    service_name: serviceName,
    game_id_value: gameId,
    notes: `续单，原订单 ${source.order_no || ""}`.trim(),
    quantity: 1,
    pricing_unit: String(source.pricing_unit || "小时"),
    voice_mode: source.voice_mode || "game_mic",
    is_renewal: true,
    renewal_of_order_id: source.id,
    renewal_source_order_no: String(source.order_no || ""),
  };
  if (companionName) row.description += `\n陪玩：${companionName}`;
  let serviceSnapshot = null;
  try {
    serviceSnapshot = await db.buildServiceSnapshotForCompanion(source.companion_id, {
      serviceId: String(source.service_id || "").trim(),
      serviceName,
      unitPrice: preview.unitPrice,
      pricingUnit: row.pricing_unit,
      hours: preview.hours,
      quantity: 1,
    });
  } catch {
    serviceSnapshot = null;
  }
  if (serviceSnapshot) row.service_snapshot = serviceSnapshot;
  const inserted = await insertRenewalRow(db, row, source, profile, preview);
  return inserted;
}

const OPTIONAL_INSERT_COLUMNS = [
  "service_snapshot",
  "voice_mode",
  "game_id_value",
  "notes",
  "quantity",
  "pricing_unit",
  "customer_service_id",
];

async function insertRenewalRow(db, row, source, profile, preview) {
  const payload = { ...row };
  for (let attempt = 0; attempt < OPTIONAL_INSERT_COLUMNS.length + 1; attempt += 1) {
    try {
      const rows = await db.supabaseJson(db.restUrl("orders"), {
        method: "POST",
        headers: db.serviceHeaders(),
        body: JSON.stringify(payload),
      });
      const saved = rows?.[0] || payload;
      if (String(saved.renewal_of_order_id || payload.renewal_of_order_id) !== String(source.id)) {
        throw fail(500, "RENEWAL_LINK_MISSING", "续单没有写上原订单关联，已中止。");
      }
      return { order: saved, deduped: false, quote: preview };
    } catch (err) {
      const msg = String(err?.message || err || "");
      if (/duplicate|unique|23505|idx_orders_one_open_renewal/i.test(msg)) {
        const again = await findOpenRenewal(db, source.id, profile.id);
        if (again) return { order: again, deduped: true, quote: preview };
      }
      if (/renewal_of_order_id|is_renewal|renewal_source_order_no/i.test(msg)) {
        throw fail(503, "RENEWAL_SCHEMA", "续单字段尚未就绪，请先执行订单续单 migration。原订单未修改。");
      }
      const missing = (msg.match(/'([a-z0-9_]+)' column/i) || msg.match(/column "([a-z0-9_]+)"/i) || [])[1];
      if (missing && OPTIONAL_INSERT_COLUMNS.includes(missing) && Object.prototype.hasOwnProperty.call(payload, missing)) {
        delete payload[missing];
        continue;
      }
      throw err;
    }
  }
  throw fail(500, "RENEWAL_INSERT", "续单创建失败。原订单未修改。");
}

/** Client totals are display-only. A mismatch must not be written. */
export function clientAmountMismatch(quote, body = {}) {
  const clientUnit = money(body.unitPrice ?? body.unit_price ?? body.price);
  const clientTotal = money(body.totalAmount ?? body.total_amount ?? body.amount);
  if (clientUnit > 0 && Math.abs(clientUnit - quote.unitPrice) > 0.009) return "unit";
  if (clientTotal > 0 && Math.abs(clientTotal - quote.totalAmount) > 0.009) return "total";
  return "";
}
