/**
 * Companion appointment requests.
 * These rows are not orders: no wallet debit, no grab hall, no 30-minute refund.
 * Flow: boss submits → companion confirms → boss acknowledges (awaiting payment, still no charge).
 */
import { hasBossRole } from "./_account-roles.js";
import { insertCompanionNotification } from "./_companion-inbox.js";
import { priceForGame } from "./_game-prices.js";
import { availabilityCode } from "./_companion-public-map.js";
import { notifyBoss, restUrl, serviceHeaders, supabaseJson } from "./_wallet.js";
import { loadPublicServices } from "./platform/services.js";
import { packAppointmentText, unpackAppointmentText } from "./_appointment-text.js";

const TZ = "Asia/Shanghai";
const OPEN_CONFLICT = ["pending", "confirmed", "awaiting_payment", "in_progress"];
const STAFF_ROLES = new Set(["admin", "super_admin", "customer_service"]);

function json(res, status, data) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(data);
}

function envUrl() {
  return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
}

function anonKey() {
  return process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
}

function tokenFrom(req) {
  return String(req.headers.authorization || req.headers["x-mcj-access-token"] || req.headers["x-mcj-companion-token"] || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
}

function money(value) {
  const n = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function nowIso() {
  return new Date().toISOString();
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

function ymd(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function hm(date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const h = parts.find((p) => p.type === "hour")?.value || "00";
  const m = parts.find((p) => p.type === "minute")?.value || "00";
  return `${h}:${m}`;
}

function minutes(hhmm) {
  const m = String(hhmm || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

async function requireUser(req) {
  const token = tokenFrom(req);
  if (!token) throw Object.assign(new Error("请先登录"), { status: 401 });
  const user = await supabaseJson(`${envUrl()}/auth/v1/user`, {
    headers: { apikey: anonKey(), Authorization: `Bearer ${token}` },
  });
  if (!user?.id) throw Object.assign(new Error("登录已失效"), { status: 401 });
  const rows = await supabaseJson(restUrl("profiles", `?id=eq.${encodeURIComponent(user.id)}&select=*&limit=1`), {
    headers: serviceHeaders(),
  });
  const profile = rows?.[0];
  if (!profile || profile.status === "disabled") throw Object.assign(new Error("账号不可用"), { status: 403 });
  return profile;
}

function isStaff(profile) {
  return STAFF_ROLES.has(String(profile?.role || "").toLowerCase());
}

async function loadCompanion(companionId) {
  const rows = await supabaseJson(
    restUrl("companion_profiles", `?user_id=eq.${encodeURIComponent(companionId)}&select=*&limit=1`),
    { headers: serviceHeaders() }
  );
  return rows?.[0] || null;
}

async function loadSettings(companionId) {
  try {
    const rows = await supabaseJson(
      restUrl("companion_booking_settings", `?companion_id=eq.${encodeURIComponent(companionId)}&limit=1`),
      { headers: serviceHeaders() }
    );
    return rows?.[0] || { companion_id: companionId, accept_booking: true, available_dates: [], time_ranges: [] };
  } catch (err) {
    if (/does not exist|schema cache/i.test(String(err.message || err))) {
      throw Object.assign(new Error("预约功能尚未在 Staging 建表"), { status: 503 });
    }
    throw err;
  }
}

async function loadApprovedServicePrices(userId) {
  const id = String(userId || "").trim();
  if (!id) return [];
  try {
    const rows = await supabaseJson(
      restUrl(
        "companion_services",
        `?companion_id=eq.${encodeURIComponent(id)}&enabled=eq.true&review_status=eq.approved&select=service_id,service_name,price,enabled,review_status`
      ),
      { headers: serviceHeaders() }
    );
    return Array.isArray(rows) ? rows : [];
  } catch (error) {
    if (/42703|column|schema cache|PGRST|does not exist|relation/i.test(String(error?.message || error || ""))) return [];
    throw error;
  }
}

async function quoteFromCompanion(row, serviceName) {
  const rows = await loadApprovedServicePrices(row?.user_id || "");
  return money(priceForGame(row, serviceName, "", rows));
}

async function assertServiceEnabled(serviceName) {
  const name = String(serviceName || "").trim();
  if (!name) return;
  const bundle = await loadPublicServices().catch(() => ({ services: [] }));
  const hit = (bundle.services || []).find((s) => String(s.name || s.title || "").trim() === name);
  if (hit && hit.enabled === false) {
    throw Object.assign(new Error("该服务已停用，不能预约"), { status: 400 });
  }
}

function assertWindow(settings, start, end) {
  const dates = Array.isArray(settings.available_dates) ? settings.available_dates.map(String) : [];
  if (dates.length && !dates.includes(ymd(start))) {
    throw Object.assign(new Error("该日期不在陪玩可预约日期内"), { status: 400 });
  }
  const ranges = Array.isArray(settings.time_ranges) ? settings.time_ranges : [];
  if (!ranges.length) return;
  const startMin = minutes(hm(start));
  const endMin = minutes(hm(end));
  const inside = ranges.some((range) => {
    const a = minutes(range.start || range.from);
    const b = minutes(range.end || range.to);
    if (a == null || b == null || b <= a) return false;
    return startMin >= a && endMin <= b && ymd(start) === ymd(end);
  });
  if (!inside) throw Object.assign(new Error("预约时间不在陪玩可预约时段内"), { status: 400 });
}

async function assertNoConflict(companionId, startIso, endIso) {
  const rows = await supabaseJson(
    restUrl(
      "companion_appointments",
      `?companion_id=eq.${encodeURIComponent(companionId)}&status=in.(${OPEN_CONFLICT.join(",")})&start_at=lt.${encodeURIComponent(endIso)}&end_at=gt.${encodeURIComponent(startIso)}&select=id&limit=1`
    ),
    { headers: serviceHeaders() }
  );
  if (Array.isArray(rows) && rows.length) {
    throw Object.assign(new Error("该时段与已有预约冲突"), { status: 409 });
  }
}

export function appointmentOrderKey(id) {
  return `appt:${String(id || "").trim()}`.slice(0, 80);
}

export function appointmentOrderBlocked(order, action) {
  if (String(order?.order_type || order?.orderType || "") !== "appointment") return null;
  if (action === "pay_order") return { status: 409, message: "预约订单请提交付款凭证，不能直接扣款。" };
  if (action === "reject_direct_order" || action === "return_to_grab_hall") {
    return { status: 409, message: "预约订单不能退回抢单大厅。" };
  }
  return null;
}

export function appointmentRefundBlocked(order) {
  if (String(order?.order_type || order?.orderType || "") !== "appointment") return null;
  return { status: 409, message: "预约订单不走普通退款，请按预约单处理。重复提交也不会退款。" };
}

function publicAppointment(row, order) {
  return {
    id: row.id,
    bossId: row.boss_id,
    companionId: row.companion_id,
    serviceName: row.service_name,
    unitPrice: money(row.unit_price),
    hours: Number(row.hours),
    totalAmount: money(row.total_amount),
    startAt: row.start_at,
    endAt: row.end_at,
    ...unpackAppointmentText(row.requirements || ""),
    status: row.status,
    chargeState: row.charge_state || "none",
    charged: false,
    orderId: row.order_id || order?.id || null,
    orderStatus: order?.status || null,
    orderType: order?.order_type || null,
    createdAt: row.created_at,
  };
}

async function findAppointmentOrder(appointmentId) {
  const key = appointmentOrderKey(appointmentId);
  if (!key || key === "appt:") return null;
  const rows = await supabaseJson(
    restUrl("orders", `?idempotency_key=eq.${encodeURIComponent(key)}&limit=1`),
    { headers: serviceHeaders() }
  );
  return rows?.[0] || null;
}

async function ordersForAppointments(rows) {
  const keys = (rows || []).map((row) => appointmentOrderKey(row.id)).filter((key) => key && key !== "appt:");
  const map = new Map();
  if (!keys.length) return map;
  const or = keys.map((key) => `idempotency_key.eq.${encodeURIComponent(key)}`).join(",");
  const found = await supabaseJson(
    restUrl("orders", `?or=(${or})&select=id,status,order_type,idempotency_key,companion_id,assignment_type`),
    { headers: serviceHeaders() }
  );
  for (const order of found || []) {
    const key = String(order.idempotency_key || "");
    if (key.startsWith("appt:")) map.set(key.slice(5), order);
  }
  return map;
}

async function createAppointmentOrder(row) {
  const existing = await findAppointmentOrder(row.id);
  if (existing) {
    if (String(existing.order_type || "") !== "appointment") {
      throw Object.assign(new Error("预约关联到了非预约订单，已停止。"), { status: 409 });
    }
    if (existing.status !== "awaiting_payment") {
      throw Object.assign(new Error("预约订单已进入后续状态，不能重复接受。"), { status: 409 });
    }
    return existing;
  }
  const serviceName = String(row.service_name || "陪玩服务");
  const payload = {
    order_no: `MCJA${String(row.id || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 16) || Date.now()}`,
    boss_id: row.boss_id,
    companion_id: row.companion_id,
    order_type: "appointment",
    assignment_type: "assigned",
    game: serviceName,
    title: `预约 · ${serviceName}`,
    description: String(row.requirements || ""),
    service_name: serviceName,
    hours: Number(row.hours),
    unit_price: money(row.unit_price),
    total_amount: money(row.total_amount),
    status: "awaiting_payment",
    idempotency_key: appointmentOrderKey(row.id),
    payment_method: "manual",
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  try {
    const created = await supabaseJson(restUrl("orders"), {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify(payload),
    });
    return created?.[0] || created;
  } catch (err) {
    const text = String(err?.message || err || "");
    if (/duplicate|23505/i.test(text)) {
      const again = await findAppointmentOrder(row.id);
      if (again) return again;
    }
    if (/check constraint|23514|invalid input value for enum/i.test(text)) {
      throw Object.assign(new Error("数据库尚未允许订单类型 appointment，已停止建单。"), { status: 503 });
    }
    throw err;
  }
}

function appointmentLinkOk(row, order) {
  if (!order) return !row?.order_id;
  if (String(order.order_type || "") !== "appointment") return false;
  if (String(order.idempotency_key || "") !== appointmentOrderKey(row?.id)) return false;
  if (row?.order_id && String(row.order_id) !== String(order.id)) return false;
  return true;
}

async function cancelLinkedOrder(appointmentId) {
  const order = await findAppointmentOrder(appointmentId);
  if (!order) return { ok: true, order: null, code: "none" };
  if (String(order.order_type || "") !== "appointment") {
    return { ok: false, status: 409, code: "type", message: "关联订单类型异常，已停止取消。" };
  }
  if (String(order.idempotency_key || "") !== appointmentOrderKey(appointmentId)) {
    return { ok: false, status: 409, code: "mismatch", message: "预约与订单关联不一致，已停止取消。" };
  }
  if (order.status === "cancelled") return { ok: true, order, code: "cancelled" };
  if (order.status !== "awaiting_payment") {
    return { ok: false, status: 409, code: "later_status", message: "预约订单已进入后续状态，不能取消。" };
  }
  const saved = await supabaseJson(
    restUrl("orders", `?id=eq.${encodeURIComponent(order.id)}&status=eq.awaiting_payment&order_type=eq.appointment`),
    {
      method: "PATCH",
      headers: serviceHeaders(),
      body: JSON.stringify({ status: "cancelled", updated_at: nowIso() }),
    }
  );
  if (saved?.[0]) return { ok: true, order: saved[0], code: "cancelled" };
  const fresh = await findAppointmentOrder(appointmentId);
  if (
    fresh?.status === "cancelled" &&
    String(fresh.order_type || "") === "appointment" &&
    String(fresh.idempotency_key || "") === appointmentOrderKey(appointmentId)
  ) {
    return { ok: true, order: fresh, code: "cancelled" };
  }
  if (fresh && fresh.status !== "awaiting_payment") {
    return { ok: false, status: 409, code: "later_status", message: "预约订单状态已变化，不能取消。" };
  }
  return { ok: false, status: 409, code: "conflict", message: "预约订单状态已变化，不能取消。" };
}

async function releaseClosedAppointmentOrder(appointmentId) {
  const rows = await supabaseJson(
    restUrl("companion_appointments", `?id=eq.${encodeURIComponent(appointmentId)}&select=id,status&limit=1`),
    { headers: serviceHeaders() }
  );
  const status = rows?.[0]?.status;
  if (status !== "cancelled" && status !== "rejected") return { released: false };
  return { released: true, status, linkedCancel: await cancelLinkedOrder(appointmentId) };
}

export async function confirmAppointmentForPaidOrder(order) {
  if (String(order?.order_type || "") !== "appointment") return null;
  if (String(order.status || "") !== "confirmed") return null;
  const key = String(order.idempotency_key || "");
  if (!key.startsWith("appt:")) return null;
  const appointmentId = key.slice(5);
  const saved = await supabaseJson(
    restUrl("companion_appointments", `?id=eq.${encodeURIComponent(appointmentId)}&status=eq.awaiting_payment`),
    {
      method: "PATCH",
      headers: serviceHeaders(),
      body: JSON.stringify({ status: "confirmed", updated_at: nowIso(), charge_state: "none" }),
    }
  );
  return saved?.[0] || null;
}

async function markAppointmentExpired(row) {
  const saved = await supabaseJson(
    restUrl("companion_appointments", `?id=eq.${encodeURIComponent(row.id)}&status=eq.${encodeURIComponent(row.status)}`),
    {
      method: "PATCH",
      headers: serviceHeaders(),
      body: JSON.stringify({ status: "expired", updated_at: nowIso() }),
    }
  );
  if (saved?.[0]?.status === "expired") {
    row.status = "expired";
    return true;
  }
  return false;
}

async function expireOne(row) {
  const order = await findAppointmentOrder(row.id);
  if (!appointmentLinkOk(row, order)) return;
  if (order && order.status === "awaiting_payment") {
    const cancel = await cancelLinkedOrder(row.id);
    if (!cancel.ok) return;
  }
  await markAppointmentExpired(row);
}

async function retryExpiredPayable(row) {
  const order = await findAppointmentOrder(row.id);
  if (!order || order.status !== "awaiting_payment") return;
  if (!appointmentLinkOk(row, order)) return;
  await cancelLinkedOrder(row.id);
}

async function expireStale(rows) {
  const now = Date.now();
  await Promise.all(
    (rows || []).map(async (row) => {
      try {
        if (row.status === "expired") {
          await retryExpiredPayable(row);
          return;
        }
        if (!["pending", "confirmed"].includes(row.status)) return;
        if (!(Date.parse(row.end_at) < now)) return;
        await expireOne(row);
      } catch {
        /* Keep the current appointment status so a later list can retry the cancel. */
      }
    })
  );
}

async function findByIdempotency(bossId, key) {
  const rows = await supabaseJson(
    restUrl(
      "companion_appointments",
      `?boss_id=eq.${encodeURIComponent(bossId)}&idempotency_key=eq.${encodeURIComponent(key)}&limit=1`
    ),
    { headers: serviceHeaders() }
  );
  return rows?.[0] || null;
}

export default async function handler(req, res) {
  try {
    const body = req.method === "GET" ? {} : await parseBody(req);
    const action = String((req.method === "GET" ? req.query?.action : body.action) || "list").trim();

    if (req.method === "GET" && action === "quote") {
      const companionId = String(req.query.companion || req.query.companionId || "").trim();
      const hours = money(req.query.hours || 1);
      const serviceName = String(req.query.service || "").trim();
      const row = await loadCompanion(companionId);
      if (!row) return json(res, 404, { ok: false, message: "陪玩不存在" });
      const settings = await loadSettings(companionId).catch(() => ({ accept_booking: true }));
      const unit = await quoteFromCompanion(row, serviceName);
      return json(res, 200, {
        ok: true,
        unitPrice: unit,
        hours,
        totalAmount: money(unit * (hours || 0)),
        acceptsBooking: settings.accept_booking !== false,
        availabilityStatus: availabilityCode(row),
        chargeState: "none",
      });
    }

    const profile = await requireUser(req);

    if (action === "save_settings") {
      const companion = await loadCompanion(profile.id);
      if (!companion) return json(res, 403, { ok: false, message: "只有陪玩可以设置预约" });
      const dates = Array.isArray(body.availableDates) ? body.availableDates.map((d) => String(d).slice(0, 10)).filter(Boolean) : [];
      const ranges = Array.isArray(body.timeRanges) ? body.timeRanges : [];
      const saved = await supabaseJson(restUrl("companion_booking_settings", "?on_conflict=companion_id"), {
        method: "POST",
        headers: serviceHeaders({ Prefer: "resolution=merge-duplicates,return=representation" }),
        body: JSON.stringify({
          companion_id: profile.id,
          accept_booking: body.acceptBooking !== false,
          available_dates: dates,
          time_ranges: ranges,
          updated_at: nowIso(),
        }),
      });
      return json(res, 200, { ok: true, settings: saved?.[0] || saved });
    }

    if (req.method === "GET" && action === "settings") {
      const companion = await loadCompanion(profile.id);
      if (!companion) return json(res, 403, { ok: false, message: "只有陪玩可以查看预约设置" });
      return json(res, 200, { ok: true, settings: await loadSettings(profile.id) });
    }

    if (req.method === "GET" && (action === "mine" || action === "list" || action === "boss" || action === "staff")) {
      let query = "?select=*&order=created_at.desc&limit=100";
      if (action === "staff") {
        if (!isStaff(profile)) return json(res, 403, { ok: false, message: "无权查看预约" });
      } else if (action === "boss") {
        if (!hasBossRole(profile)) return json(res, 403, { ok: false, message: "请使用老板账号" });
        query = `?boss_id=eq.${encodeURIComponent(profile.id)}&select=*&order=created_at.desc&limit=100`;
      } else {
        const companion = await loadCompanion(profile.id);
        if (!companion && !hasBossRole(profile)) return json(res, 403, { ok: false, message: "无权查看预约" });
        query = companion
          ? `?companion_id=eq.${encodeURIComponent(profile.id)}&select=*&order=created_at.desc&limit=100`
          : `?boss_id=eq.${encodeURIComponent(profile.id)}&select=*&order=created_at.desc&limit=100`;
      }
      const rows = await supabaseJson(restUrl("companion_appointments", query), { headers: serviceHeaders() });
      await expireStale(rows);
      const linked = await ordersForAppointments(rows);
      return json(res, 200, { ok: true, appointments: (rows || []).map((row) => publicAppointment(row, linked.get(row.id))) });
    }

    if (action === "create") {
      if (!hasBossRole(profile)) return json(res, 403, { ok: false, message: "请使用老板账号预约" });
      const companionId = String(body.companionId || body.companion_id || "").trim();
      const serviceName = String(body.serviceName || body.service || "").trim();
      const hours = money(body.hours);
      const idem = String(body.idempotencyKey || body.idempotency_key || "").trim().slice(0, 80);
      if (!companionId || !idem) return json(res, 400, { ok: false, message: "缺少陪玩或预约单号" });
      if (!(hours >= 0.5) || hours > 24) return json(res, 400, { ok: false, message: "预约时长无效" });
      const start = new Date(body.startAt || body.start_at || "");
      if (!Number.isFinite(start.getTime())) return json(res, 400, { ok: false, message: "请选择预约时间" });
      if (start.getTime() <= Date.now() - 60 * 1000) return json(res, 400, { ok: false, message: "不能选择已经过去的时间" });
      const end = new Date(start.getTime() + hours * 3600 * 1000);
      const existing = await findByIdempotency(profile.id, idem);
      if (existing) return json(res, 200, { ok: true, duplicate: true, appointment: publicAppointment(existing) });
      const companion = await loadCompanion(companionId);
      if (!companion) return json(res, 404, { ok: false, message: "陪玩不存在" });
      if (companion.allow_orders === false) return json(res, 400, { ok: false, message: "该陪玩服务未启用" });
      const settings = await loadSettings(companionId);
      if (settings.accept_booking === false) return json(res, 400, { ok: false, message: "该陪玩已关闭预约" });
      await assertServiceEnabled(serviceName);
      assertWindow(settings, start, end);
      await assertNoConflict(companionId, start.toISOString(), end.toISOString());
      const unit = await quoteFromCompanion(companion, serviceName);
      if (!(unit > 0)) return json(res, 400, { ok: false, message: "陪玩未设置可预约价格" });
      const clientUnit = body.unitPrice != null ? money(body.unitPrice) : unit;
      const total = money(unit * hours);
      const clientTotal = body.totalAmount != null ? money(body.totalAmount) : total;
      if (Math.abs(clientUnit - unit) > 0.01 || Math.abs(clientTotal - total) > 0.01) {
        return json(res, 400, { ok: false, message: "预约价格与陪玩服务价格不一致", unitPrice: unit, totalAmount: total });
      }
      let created;
      try {
        created = await supabaseJson(restUrl("companion_appointments"), {
          method: "POST",
          headers: serviceHeaders(),
          body: JSON.stringify({
            boss_id: profile.id,
            companion_id: companionId,
            service_name: serviceName || "陪玩服务",
            unit_price: unit,
            hours,
            total_amount: total,
            start_at: start.toISOString(),
            end_at: end.toISOString(),
            requirements: packAppointmentText(body.requirements, body.note || body.remark || body.bossNote),
            status: "pending",
            idempotency_key: idem,
            charge_state: "none",
            created_at: nowIso(),
            updated_at: nowIso(),
          }),
        });
      } catch (err) {
        if (/duplicate|23505/i.test(String(err.message || err))) {
          const again = await findByIdempotency(profile.id, idem);
          if (again) return json(res, 200, { ok: true, duplicate: true, appointment: publicAppointment(again) });
        }
        throw err;
      }
      const row = created?.[0] || created;
      await insertCompanionNotification({
        companionUserId: companionId,
        category: "order",
        title: "新的预约申请",
        body: `老板提交了预约：${serviceName || "陪玩服务"}，${ymd(start)} ${hm(start)}，预计 ${total} 猫粮。确认前不会扣款。`,
        href: "/companion-appointments.html",
        noticeKey: `appointment-new-${row.id}`,
      }).catch(() => null);
      return json(res, 200, {
        ok: true,
        appointment: publicAppointment(row),
        message: "预约申请已提交。陪玩确认前不会扣除猫粮，也不会生成支付订单。",
      });
    }

    const id = String(body.id || "").trim();
    if (!id) return json(res, 400, { ok: false, message: "缺少预约 ID" });
    const rows = await supabaseJson(restUrl("companion_appointments", `?id=eq.${encodeURIComponent(id)}&limit=1`), {
      headers: serviceHeaders(),
    });
    const row = rows?.[0];
    if (!row) return json(res, 404, { ok: false, message: "预约不存在" });

    if (action === "accept" || action === "reject") {
      if (String(row.companion_id) !== String(profile.id)) return json(res, 403, { ok: false, message: "不能修改别人的预约" });
      if (row.status !== "pending") {
        if (row.status === "cancelled" || row.status === "rejected") {
          const released = await releaseClosedAppointmentOrder(id);
          if (released.released && !released.linkedCancel.ok) {
            return json(res, released.linkedCancel.status || 409, { ok: false, message: released.linkedCancel.message });
          }
        }
        return json(res, 409, { ok: false, message: "该预约已处理" });
      }
      if (action === "reject") {
        const saved = await supabaseJson(
          restUrl("companion_appointments", `?id=eq.${encodeURIComponent(id)}&status=eq.pending`),
          {
            method: "PATCH",
            headers: serviceHeaders(),
            body: JSON.stringify({ status: "rejected", updated_at: nowIso(), charge_state: "none" }),
          }
        );
        const updated = saved?.[0];
        if (!updated) return json(res, 409, { ok: false, message: "该预约已处理" });
        const linkedCancel = await cancelLinkedOrder(id);
        if (!linkedCancel.ok) {
          return json(res, linkedCancel.status || 409, { ok: false, message: linkedCancel.message });
        }
        await notifyBoss(row.boss_id, "预约已拒绝", "陪玩已拒绝这次预约。没有产生扣款，也没有创建订单。", "appointment", updated.id);
        return json(res, 200, { ok: true, appointment: publicAppointment(updated) });
      }
      const order = await createAppointmentOrder(row);
      if (!order?.id || String(order?.order_type || "") !== "appointment" || String(order?.companion_id || "") !== String(row.companion_id)) {
        return json(res, 409, { ok: false, message: "预约订单未绑定已接受的陪玩，已停止。" });
      }
      if (order.assignment_type && order.assignment_type !== "assigned") {
        return json(res, 409, { ok: false, message: "预约订单分配类型异常，已停止。" });
      }
      const saved = await supabaseJson(
        restUrl(
          "companion_appointments",
          `?id=eq.${encodeURIComponent(id)}&status=eq.${encodeURIComponent(row.status)}`
        ),
        {
          method: "PATCH",
          headers: serviceHeaders(),
          body: JSON.stringify({
            status: "awaiting_payment",
            order_id: order.id,
            updated_at: nowIso(),
            charge_state: "none",
          }),
        }
      );
      const updated = saved?.[0];
      if (!updated || updated.status !== "awaiting_payment" || String(updated.order_id || "") !== String(order.id)) {
        const released = await releaseClosedAppointmentOrder(id);
        if (released.released) {
          if (!released.linkedCancel.ok) {
            return json(res, released.linkedCancel.status || 409, { ok: false, message: released.linkedCancel.message });
          }
          const message = released.status === "rejected"
            ? "预约已拒绝，关联订单已停止付款。"
            : "预约已取消，关联订单已停止付款。";
          return json(res, 409, { ok: false, message });
        }
        return json(res, 409, { ok: false, message: "预约状态已变化，未标记接受。" });
      }
      await notifyBoss(
        row.boss_id,
        "预约已接受",
        `陪玩已接受预约。请对订单 ${order.id} 提交付款凭证。确认前不会扣除猫粮。`,
        "appointment",
        updated.id
      );
      return json(res, 200, {
        ok: true,
        appointment: publicAppointment(updated, order),
        message: "预约已接受。请提交付款凭证，审核通过前服务不会开始。",
      });
    }

    if (action === "cancel") {
      if (String(row.boss_id) !== String(profile.id) && !isStaff(profile)) {
        return json(res, 403, { ok: false, message: "不能取消别人的预约" });
      }
      if (!["pending", "confirmed", "awaiting_payment"].includes(row.status)) {
        return json(res, 409, { ok: false, message: "当前状态不能取消" });
      }
      const linkedCancel = await cancelLinkedOrder(id);
      if (!linkedCancel.ok) return json(res, linkedCancel.status || 409, { ok: false, message: linkedCancel.message });
      const saved = await supabaseJson(
        restUrl("companion_appointments", `?id=eq.${encodeURIComponent(id)}&status=eq.${encodeURIComponent(row.status)}`),
        {
          method: "PATCH",
          headers: serviceHeaders(),
          body: JSON.stringify({ status: "cancelled", updated_at: nowIso(), charge_state: "none" }),
        }
      );
      const updated = saved?.[0];
      if (!updated) return json(res, 409, { ok: false, message: "预约状态已变化" });
      return json(res, 200, { ok: true, appointment: publicAppointment(updated, linkedCancel.order), charged: false });
    }

    if (action === "ack") {
      return json(res, 409, { ok: false, message: "请通过预约订单提交付款凭证。此操作不会改变预约状态，也不会扣款。" });
    }

    return json(res, 400, { ok: false, message: "未知操作" });
  } catch (err) {
    return json(res, err.status || 500, { ok: false, message: err.message || "预约失败" });
  }
}
