import {
  companionDb,
  isMissingRelation,
} from "../_companion-media-store.js";
import { resolveCompanionAvatar, resolveCompanionCover } from "../_companion-public-map.js";
import { debitWallet, getWallet, money as walletMoney, writeAdminLog } from "../_wallet.js";
import { scheduleRecomputeSoft } from "../_popularity.js";
import { servicesFromGamePrices, readGamePrices } from "../_game-prices.js";
import { hasBossRole } from "../_account-roles.js";
import { allocateOrderNo } from "../_account-codes.js";

const REQUIRED = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];

function json(res, status, data) {
  return res.status(status).json(data);
}
function hasDb() {
  return REQUIRED.every((k) => process.env[k] || (k === "SUPABASE_URL" && process.env.VITE_SUPABASE_URL) || (k === "SUPABASE_ANON_KEY" && (process.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY)));
}
function url() {
  return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
}
function anonKey() {
  return process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
}
function serviceHeaders(extra = {}) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
    ...extra,
  };
}
function anonHeaders(extra = {}) {
  return { apikey: anonKey(), "Content-Type": "application/json", ...extra };
}
function rest(table, query = "") {
  return `${url()}/rest/v1/${table}${query}`;
}
function nowIso() {
  return new Date().toISOString();
}
function money(v) {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}
function no(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
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
async function supabaseJson(fetchUrl, init = {}) {
  const response = await fetch(fetchUrl, init);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    throw Object.assign(new Error(body?.message || body?.hint || text || `HTTP ${response.status}`), {
      status: response.status,
      body,
    });
  }
  return body;
}
function tokenFrom(req) {
  return String(req.headers.authorization || req.headers["x-mcj-access-token"] || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
}
async function requireBoss(req) {
  const token = tokenFrom(req);
  if (!token) throw Object.assign(new Error("请先登录老板账号"), { status: 401 });
  const user = await supabaseJson(`${url()}/auth/v1/user`, {
    headers: anonHeaders({ Authorization: `Bearer ${token}` }),
  });
  const rows = await supabaseJson(rest("profiles", `?id=eq.${encodeURIComponent(user.id)}&limit=1`), {
    headers: serviceHeaders(),
  });
  const profile = rows?.[0];
  if (!profile || !hasBossRole(profile, { authUser: user })) {
    throw Object.assign(new Error("请使用老板账号操作"), { status: 403 });
  }
  if (profile.status !== "active") throw Object.assign(new Error("账号已停用"), { status: 403 });
  return profile;
}

function availabilityOf(companion = {}) {
  if (!/approved|verified|passed/.test(String(companion.verification_status || ""))) return "offline";
  const raw = String(companion.availability_status || companion.online_status || "offline").toLowerCase();
  if (raw === "online") return "online";
  if (raw === "busy") return "busy";
  if (raw === "paused") return "paused";
  return "offline";
}

function availabilityText(code) {
  return ({ online: "在线可接单", busy: "忙碌中", paused: "暂停接单", offline: "离线" })[code] || "离线";
}

function publicId(companion = {}) {
  if (companion.companion_uid) return `P${companion.companion_uid}`;
  return "";
}

async function loadCompanion(userId) {
  const rows = await supabaseJson(
    rest("companion_profiles", `?user_id=eq.${encodeURIComponent(userId)}&limit=1`),
    { headers: serviceHeaders() }
  );
  return rows?.[0] || null;
}

async function loadCompanionServices(companionUserId, companionRow) {
  let rows = [];
  try {
    rows = await companionDb(
      "companion_services",
      `?companion_id=eq.${encodeURIComponent(companionUserId)}&enabled=eq.true&review_status=eq.approved&order=updated_at.desc`
    );
  } catch (e) {
    if (!isMissingRelation(e)) throw e;
  }
  if (rows?.length) {
    return rows.map((r) => ({
      id: r.id,
      serviceId: r.service_id || "",
      name: r.service_name || "服务",
      price: money(r.price),
      pricingUnit: r.pricing_unit || "小时",
      specs: Array.isArray(r.specs) && r.specs.length ? r.specs : defaultSpecs(r.pricing_unit),
      requiresGameId: r.requires_game_id !== false,
      customFields: Array.isArray(r.custom_fields) ? r.custom_fields : [],
    }));
  }
  // Fallback: one service per game with its own price (boss picks game → auto price)
  const fromGames = servicesFromGamePrices(companionRow || {});
  const unit = companionRow?.pricing_unit || "小时";
  return fromGames.map((s) => ({
    ...s,
    pricingUnit: s.pricingUnit || unit,
    specs: defaultSpecs(unit),
    requiresGameId: !/语音|陪聊|聊天/i.test(s.name),
    customFields: [],
  }));
}

function defaultSpecs(unit) {
  const u = String(unit || "小时");
  if (/局/.test(u)) {
    return [
      { id: "1", label: "1 局", quantity: 1 },
      { id: "3", label: "3 局", quantity: 3 },
      { id: "5", label: "5 局", quantity: 5 },
      { id: "custom", label: "自定义局数", quantity: 1, custom: true },
    ];
  }
  if (/分钟/.test(u)) {
    return [
      { id: "30m", label: "30 分钟", quantity: 0.5 },
      { id: "1h", label: "1 小时", quantity: 1 },
      { id: "2h", label: "2 小时", quantity: 2 },
      { id: "custom", label: "自定义时长", quantity: 1, custom: true },
    ];
  }
  return [
    { id: "1h", label: "1 小时", quantity: 1 },
    { id: "2h", label: "2 小时", quantity: 2 },
    { id: "3h", label: "3 小时", quantity: 3 },
    { id: "night", label: "包晚", quantity: 8 },
    { id: "custom", label: "自定义时长", quantity: 1, custom: true },
  ];
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
  await supabaseJson(rest("transactions"), {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify({
      user_id: companionId,
      order_id: relatedId || null,
      transaction_type: "companion_income",
      amount,
      status: "completed",
      note: note || "礼物/打赏收益",
      created_at: nowIso(),
    }),
  });
}

export default async function handler(req, res) {
  if (!hasDb()) return json(res, 503, { ok: false, message: "数据库未配置" });
  try {
    const body = req.method === "GET" ? {} : await parseBody(req);
    const action = String(req.method === "GET" ? req.query.action || "catalog" : body.action || "").trim();

    if (req.method === "GET" && action === "catalog") {
      const companionId = String(req.query.companionId || req.query.id || "").trim();
      if (!companionId) return json(res, 400, { ok: false, message: "缺少陪玩 ID" });
      const companion = await loadCompanion(companionId);
      if (!companion) return json(res, 404, { ok: false, message: "陪玩不存在" });
      let profile = null;
      try {
        const profiles = await supabaseJson(
          rest("profiles", `?id=eq.${encodeURIComponent(companion.user_id)}&select=id,display_name,avatar_url&limit=1`),
          { headers: serviceHeaders() }
        );
        profile = profiles?.[0] || null;
      } catch {
        profile = null;
      }
      const services = await loadCompanionServices(companionId, companion);
      let gifts = [];
      try {
        gifts = await companionDb("gifts", "?enabled=eq.true&deleted_at=is.null&order=sort_order.asc&limit=100");
      } catch (e) {
        if (!isMissingRelation(e)) throw e;
      }
      const avail = availabilityOf(companion);
      const rate = await giftCommissionRate(companion);
      return json(res, 200, {
        ok: true,
        companion: {
          id: companion.user_id,
          publicId: publicId(companion),
          name: companion.nickname || profile?.display_name || "",
          level: companion.level_name || "",
          avatar: resolveCompanionAvatar(profile || {}, companion),
          cover: resolveCompanionCover(profile || {}, companion),
          price: money(companion.price),
          gamePrices: readGamePrices(companion),
          pricingUnit: companion.pricing_unit || "小时",
          availabilityStatus: avail,
          availabilityText: availabilityText(avail),
          canStartNow: avail === "online",
          verificationStatus: companion.verification_status || "",
          depositStatus: companion.deposit_status || "",
          giftCommissionRate: rate,
        },
        services,
        gifts: (gifts || []).map((g) => ({
          id: g.id,
          name: g.name,
          iconUrl: g.icon_url || "",
          catFoodPrice: money(g.cat_food_price),
          featured: !!g.featured,
          animationLevel: g.animation_level || "normal",
        })),
      });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return json(res, 405, { ok: false, message: "Method Not Allowed" });
    }

    const boss = await requireBoss(req);

    if (action === "create_and_pay") {
      const companionId = String(body.companionId || body.companion_id || "").trim();
      const idempotencyKey = String(body.idempotencyKey || body.idempotency_key || "").trim();
      if (!companionId) return json(res, 400, { ok: false, message: "缺少陪玩" });
      if (!idempotencyKey) return json(res, 400, { ok: false, message: "缺少 idempotency_key" });

      // Idempotent replay
      try {
        const existing = await supabaseJson(
          rest("orders", `?idempotency_key=eq.${encodeURIComponent(idempotencyKey)}&limit=1`),
          { headers: serviceHeaders() }
        );
        if (existing?.[0]) {
          // Recover missed companion notify on retry (inbox/mail are idempotent by notice_key).
          const replayed = existing[0];
          if (String(replayed.status || "") === "claimed" && replayed.companion_id) {
            try {
              const { notifyCompanionOrderAssigned } = await import("../_companion-order-notify.js");
              await Promise.race([
                notifyCompanionOrderAssigned(replayed, { eventType: "assign", email: "" }).catch((err) =>
                  console.warn("[marketplace/create_and_pay] companion notify replay", err?.message || err)
                ),
                new Promise((resolve) => setTimeout(resolve, 3500)),
              ]);
            } catch (err) {
              console.warn("[marketplace/create_and_pay] companion notify replay import", err?.message || err);
            }
          }
          return json(res, 200, { ok: true, message: "订单已存在（防重复提交）", order: replayed, replayed: true });
        }
      } catch (e) {
        if (!/idempotency|column/i.test(String(e.message || ""))) {
          /* continue if column missing until SQL */
        }
      }

      const companion = await loadCompanion(companionId);
      if (!companion) return json(res, 404, { ok: false, message: "陪玩不存在" });
      if (companion.verification_status && !/approved|verified/.test(companion.verification_status)) {
        return json(res, 400, { ok: false, message: "该陪玩尚未通过审核，暂不可下单" });
      }
      const avail = availabilityOf(companion);
      const startNow = !!body.startNow;
      if (startNow && avail !== "online") {
        return json(res, 400, { ok: false, message: "陪玩当前不可立即开始，请预约或咨询客服" });
      }
      if (avail === "paused") {
        return json(res, 400, { ok: false, message: "陪玩已暂停接单，可预约或咨询客服" });
      }

      const services = await loadCompanionServices(companionId, companion);
      const serviceKey = String(body.serviceId || body.service_id || services[0]?.id || "");
      const service = services.find((s) => String(s.id) === serviceKey) || services[0];
      if (!service) return json(res, 400, { ok: false, message: "没有可下单服务" });

      const quantity = Math.max(0.5, money(body.quantity || 1));
      // Server-authoritative unit price from companion service listing — never trust client unitPrice.
      const unitPrice = money(service.price);
      if (unitPrice <= 0) return json(res, 400, { ok: false, message: "单价无效" });
      const clientUnit = money(body.unitPrice != null ? body.unitPrice : body.unit_price);
      if (clientUnit > 0 && Math.abs(clientUnit - unitPrice) > 0.05) {
        return json(res, 400, { ok: false, message: `价格已变化，请刷新后重试（单价 ${unitPrice}）` });
      }
      // Server recompute total — never trust client total alone
      const total = Math.round(unitPrice * quantity * 100) / 100;
      const clientTotal = money(body.totalAmount || body.total_amount);
      if (clientTotal > 0 && Math.abs(clientTotal - total) > 0.05) {
        return json(res, 400, { ok: false, message: `价格已变化，请刷新后重试（应付 ${total}）` });
      }

      const gameIdValue = String(body.gameIdValue || body.game_id_value || "").trim();
      if (service.requiresGameId && !gameIdValue) {
        return json(res, 400, { ok: false, message: "请填写老板游戏 ID" });
      }

      const wallet = await getWallet(boss.id).catch(() => null);
      const { viewWallet } = await import("../_wallet.js");
      const vw = viewWallet(wallet || {}, boss.id);
      if (vw.frozen) return json(res, 400, { ok: false, message: "钱包已冻结，无法支付" });
      const available = money(vw.totalBalance);
      if (available < total) {
        return json(res, 400, {
          ok: false,
          code: "INSUFFICIENT_BALANCE",
          message: "猫粮余额不足",
          need: total,
          available,
          rechargeUrl: "/recharge.html",
        });
      }

      const formalOrderNo = await allocateOrderNo(companionDb).catch(() => `MCJO${String(Date.now()).slice(-6)}`);
      const orderPayload = {
        order_no: formalOrderNo || `MCJO${String(Date.now()).slice(-6)}`,
        boss_id: boss.id,
        companion_id: companionId,
        customer_service_id: null,
        order_type: "direct_companion",
        game: service.name,
        title: `${service.name} · ${quantity}${service.pricingUnit}`,
        description: String(body.notes || body.specialRequests || ""),
        hours: quantity,
        unit_price: unitPrice,
        total_amount: total,
        status: "awaiting_payment",
        created_at: nowIso(),
        service_name: service.name,
        quantity,
        pricing_unit: service.pricingUnit,
        game_id_value: gameIdValue,
        server_name: String(body.server || body.serverName || ""),
        rank_name: String(body.rank || body.rankName || ""),
        contact_info: String(body.contact || body.contactInfo || ""),
        scheduled_at: body.scheduledAt || null,
        start_now: startNow && avail === "online",
        notes: String(body.notes || ""),
        special_requests: String(body.specialRequests || ""),
        custom_fields: body.customFields || {},
        paid_cat_food: 0,
        idempotency_key: idempotencyKey,
        price_snapshot: {
          unitPrice,
          quantity,
          total,
          serviceName: service.name,
          pricingUnit: service.pricingUnit,
          availability: avail,
        },
      };

      let created;
      try {
        const rows = await supabaseJson(rest("orders"), {
          method: "POST",
          headers: serviceHeaders(),
          body: JSON.stringify(orderPayload),
        });
        created = rows?.[0];
      } catch (e) {
        // Retry without new columns if schema not migrated
        if (/column|PGRST/i.test(String(e.message || ""))) {
          const basic = {
            order_no: orderPayload.order_no,
            boss_id: boss.id,
            companion_id: companionId,
            order_type: "direct_companion",
            game: service.name,
            title: orderPayload.title,
            description: orderPayload.description,
            hours: quantity,
            unit_price: unitPrice,
            total_amount: total,
            status: "awaiting_payment",
            created_at: nowIso(),
          };
          const rows = await supabaseJson(rest("orders"), {
            method: "POST",
            headers: serviceHeaders(),
            body: JSON.stringify(basic),
          });
          created = rows?.[0];
        } else throw e;
      }
      if (!created?.id) return json(res, 500, { ok: false, message: "创建订单失败" });

      try {
        await debitWallet({
          bossId: boss.id,
          amount: total,
          transactionType: "order_payment",
          idempotencyKey: `order-pay:${idempotencyKey}`,
          reason: `直选陪玩订单 ${created.order_no}`,
          relatedOrderId: created.id,
          operatorId: boss.id,
        });
      } catch (e) {
        await supabaseJson(rest("orders", `?id=eq.${encodeURIComponent(created.id)}`), {
          method: "PATCH",
          headers: serviceHeaders(),
          body: JSON.stringify({ status: "cancelled", cancelled_at: nowIso() }),
        }).catch(() => null);
        if (/不足|insufficient|balance/i.test(String(e.message || ""))) {
          return json(res, 400, {
            ok: false,
            code: "INSUFFICIENT_BALANCE",
            message: "猫粮余额不足",
            rechargeUrl: "/recharge.html",
          });
        }
        throw e;
      }

      const paid = await supabaseJson(rest("orders", `?id=eq.${encodeURIComponent(created.id)}`), {
        method: "PATCH",
        headers: serviceHeaders(),
        body: JSON.stringify({
          status: "claimed",
          paid_cat_food: total,
          accepted_at: null,
        }),
      });

      const claimedOrder = paid?.[0] || { ...created, status: "claimed", companion_id: companionId, paid_cat_food: total };
      // Paid + companion bound → same inbox / Realtime / Email path as orders pay_order / want_him.
      // Mail failure must not roll back the already-paid order.
      if (claimedOrder?.companion_id) {
        try {
          const { notifyCompanionOrderAssigned } = await import("../_companion-order-notify.js");
          await Promise.race([
            notifyCompanionOrderAssigned(claimedOrder, { eventType: "assign", email: "" }).catch((err) =>
              console.warn("[marketplace/create_and_pay] companion notify", err?.message || err)
            ),
            new Promise((resolve) => setTimeout(resolve, 3500)),
          ]);
        } catch (err) {
          console.warn("[marketplace/create_and_pay] companion notify import", err?.message || err);
        }
      }

      return json(res, 200, {
        ok: true,
        message: "支付成功，等待陪玩确认",
        order: claimedOrder,
        statusText: "已支付待陪玩确认",
      });
    }

    if (action === "send_gift" || action === "send_tip") {
      const companionId = String(body.companionId || body.companion_id || "").trim();
      const idempotencyKey = String(body.idempotencyKey || body.idempotency_key || "").trim();
      if (!companionId) return json(res, 400, { ok: false, message: "缺少陪玩" });
      if (!idempotencyKey) return json(res, 400, { ok: false, message: "缺少 idempotency_key" });

      try {
        const existed = await companionDb(
          "gift_transactions",
          `?idempotency_key=eq.${encodeURIComponent(idempotencyKey)}&limit=1`
        );
        if (existed?.[0]) {
          return json(res, 200, { ok: true, message: "已处理（防重复）", transaction: existed[0], replayed: true });
        }
      } catch (e) {
        if (!isMissingRelation(e)) throw e;
      }

      const companion = await loadCompanion(companionId);
      if (!companion) return json(res, 404, { ok: false, message: "陪玩不存在" });
      const rate = await giftCommissionRate(companion);
      let gross = 0;
      let giftName = "打赏";
      let giftId = null;
      let quantity = 1;

      if (action === "send_gift") {
        giftId = String(body.giftId || body.gift_id || "").trim();
        quantity = Math.max(1, Math.floor(Number(body.quantity || 1)));
        const gifts = await companionDb("gifts", `?id=eq.${encodeURIComponent(giftId)}&enabled=eq.true&limit=1`).catch((e) => {
          if (isMissingRelation(e)) return [];
          throw e;
        });
        const gift = gifts?.[0];
        if (!gift) return json(res, 400, { ok: false, message: "礼物不存在或已下架" });
        giftName = gift.name;
        gross = money(gift.cat_food_price) * quantity;
      } else {
        gross = money(body.amount || body.catFood || body.cat_food);
        quantity = 1;
        giftName = "自由打赏";
        if (gross <= 0) return json(res, 400, { ok: false, message: "请输入打赏数量" });
      }

      const commissionAmount = Math.round(gross * (rate / 100) * 100) / 100;
      const companionIncome = Math.round((gross - commissionAmount) * 100) / 100;
      const message = String(body.message || "").trim();

      try {
        await debitWallet({
          bossId: boss.id,
          amount: gross,
          transactionType: action === "send_gift" ? "gift" : "tip",
          idempotencyKey: `gift:${idempotencyKey}`,
          reason: `${giftName} x${quantity} → ${companion.nickname || companionId}`,
          operatorId: boss.id,
        });
      } catch (e) {
        if (/不足|insufficient|balance/i.test(String(e.message || ""))) {
          return json(res, 400, {
            ok: false,
            code: "INSUFFICIENT_BALANCE",
            message: "猫粮余额不足",
            rechargeUrl: "/recharge.html",
          });
        }
        // If transaction type not allowed by wallet RPC, retry as order_payment-like
        try {
          await debitWallet({
            bossId: boss.id,
            amount: gross,
            transactionType: "order_payment",
            idempotencyKey: `gift:${idempotencyKey}`,
            reason: `${giftName} x${quantity}`,
            operatorId: boss.id,
          });
        } catch (e2) {
          if (/不足|insufficient|balance/i.test(String(e2.message || ""))) {
            return json(res, 400, {
              ok: false,
              code: "INSUFFICIENT_BALANCE",
              message: "猫粮余额不足",
              rechargeUrl: "/recharge.html",
            });
          }
          throw e2;
        }
      }

      await creditCompanionIncome(companionId, companionIncome, `${giftName}收益`, null);

      let tx = null;
      try {
        const rows = await companionDb("gift_transactions", "", {
          method: "POST",
          body: JSON.stringify({
            tx_no: no("GIFT"),
            sender_boss_id: boss.id,
            receiver_companion_id: companionId,
            gift_id: giftId,
            gift_name: giftName,
            quantity,
            gross_cat_food: gross,
            platform_commission_rate: rate,
            platform_commission_amount: commissionAmount,
            companion_income: companionIncome,
            message,
            related_order_id: body.relatedOrderId || null,
            kind: action === "send_gift" ? "gift" : "tip",
            idempotency_key: idempotencyKey,
            created_at: nowIso(),
          }),
        });
        tx = rows?.[0] || null;
      } catch (e) {
        if (!isMissingRelation(e)) throw e;
      }

      scheduleRecomputeSoft();
      return json(res, 200, {
        ok: true,
        message: action === "send_gift" ? "礼物已送出" : "打赏成功",
        transaction: tx,
        snapshot: {
          grossCatFood: gross,
          platformCommissionRate: rate,
          platformCommissionAmount: commissionAmount,
          companionIncome,
          giftName,
          quantity,
        },
      });
    }

    return json(res, 400, { ok: false, message: "未知操作" });
  } catch (error) {
    return json(res, error.status || 500, { ok: false, message: error.message || "接口异常" });
  }
}
