/**
 * Companion appointment requests.
 * These rows are not orders: no wallet debit, no grab hall, no 30-minute refund.
 * Flow: boss submits → companion confirms → boss acknowledges (awaiting payment, still no charge).
 */
import { hasBossRole } from "./_account-roles.js";
import { insertCompanionNotification } from "./_companion-inbox.js";
import { readGamePrices } from "./_game-prices.js";
import { effectiveAvailabilityCode } from "./_companion-public-map.js";
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

function quoteFromCompanion(row, serviceName) {
  const prices = readGamePrices(row);
  const want = String(serviceName || "").trim();
  let unit = 0;
  if (want && prices[want] > 0) unit = prices[want];
  if (!unit && want) {
    const key = Object.keys(prices).find((k) => k && (want.includes(k) || k.includes(want)));
    if (key) unit = prices[key];
  }
  if (!unit) unit = money(row.price);
  return money(unit);
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

function publicAppointment(row) {
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
    createdAt: row.created_at,
  };
}

async function expireStale(rows) {
  const now = Date.now();
  const stale = (rows || []).filter((row) => {
    if (!["pending", "confirmed"].includes(row.status)) return false;
    return Date.parse(row.end_at) < now;
  });
  await Promise.all(
    stale.map((row) =>
      supabaseJson(restUrl("companion_appointments", `?id=eq.${encodeURIComponent(row.id)}&status=eq.${row.status}`), {
        method: "PATCH",
        headers: serviceHeaders(),
        body: JSON.stringify({ status: "expired", updated_at: nowIso() }),
      }).catch(() => null)
    )
  );
  stale.forEach((row) => {
    row.status = "expired";
  });
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
      const unit = quoteFromCompanion(row, serviceName);
      return json(res, 200, {
        ok: true,
        unitPrice: unit,
        hours,
        totalAmount: money(unit * (hours || 0)),
        acceptsBooking: settings.accept_booking !== false,
        availabilityStatus: effectiveAvailabilityCode(row),
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
      return json(res, 200, { ok: true, appointments: (rows || []).map(publicAppointment) });
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
      const unit = quoteFromCompanion(companion, serviceName);
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
      if (row.status !== "pending") return json(res, 409, { ok: false, message: "该预约已处理" });
      const next = action === "accept" ? "confirmed" : "rejected";
      const saved = await supabaseJson(
        restUrl("companion_appointments", `?id=eq.${encodeURIComponent(id)}&status=eq.pending`),
        {
          method: "PATCH",
          headers: serviceHeaders(),
          body: JSON.stringify({ status: next, updated_at: nowIso(), charge_state: "none" }),
        }
      );
      const updated = saved?.[0];
      if (!updated) return json(res, 409, { ok: false, message: "该预约已处理" });
      await notifyBoss(
        row.boss_id,
        next === "confirmed" ? "预约已确认" : "预约已拒绝",
        next === "confirmed"
          ? "陪玩已确认预约。请在预约页确认。当前不会扣除猫粮，也不会生成支付订单。"
          : "陪玩已拒绝这次预约。没有产生扣款。",
        "appointment",
        updated.id
      );
      return json(res, 200, { ok: true, appointment: publicAppointment(updated) });
    }

    if (action === "cancel") {
      if (String(row.boss_id) !== String(profile.id) && !isStaff(profile)) {
        return json(res, 403, { ok: false, message: "不能取消别人的预约" });
      }
      if (!["pending", "confirmed", "awaiting_payment"].includes(row.status)) {
        return json(res, 409, { ok: false, message: "当前状态不能取消" });
      }
      const saved = await supabaseJson(restUrl("companion_appointments", `?id=eq.${encodeURIComponent(id)}`), {
        method: "PATCH",
        headers: serviceHeaders(),
        body: JSON.stringify({ status: "cancelled", updated_at: nowIso(), charge_state: "none" }),
      });
      return json(res, 200, { ok: true, appointment: publicAppointment(saved?.[0] || row), charged: false });
    }

    if (action === "ack") {
      if (String(row.boss_id) !== String(profile.id)) return json(res, 403, { ok: false, message: "不能确认别人的预约" });
      if (row.status !== "confirmed") return json(res, 409, { ok: false, message: "请等待陪玩确认后再确认预约" });
      const saved = await supabaseJson(
        restUrl("companion_appointments", `?id=eq.${encodeURIComponent(id)}&status=eq.confirmed`),
        {
          method: "PATCH",
          headers: serviceHeaders(),
          body: JSON.stringify({ status: "awaiting_payment", updated_at: nowIso(), charge_state: "none" }),
        }
      );
      const updated = saved?.[0];
      if (!updated) return json(res, 409, { ok: false, message: "预约状态已变化" });
      return json(res, 200, {
        ok: true,
        appointment: publicAppointment(updated),
        message: "预约已确认。支付规则尚未开启，本次没有扣除猫粮，也没有创建支付订单。",
      });
    }

    return json(res, 400, { ok: false, message: "未知操作" });
  } catch (err) {
    return json(res, err.status || 500, { ok: false, message: err.message || "预约失败" });
  }
}
