import "./_load-env.js";

const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const CONFIG_DATE = "1970-01-01";
const PREFIX = "MCJ_CS_META:";

function hasDb() {
  return REQUIRED_ENV.every((key) => process.env[key]);
}
function restUrl(table, query = "") {
  return `${process.env.SUPABASE_URL}/rest/v1/${table}${query}`;
}
function serviceHeaders(extra = {}) {
  return {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
    ...extra,
  };
}
async function supabaseJson(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    throw new Error(body?.message || body?.error_description || body?.hint || body?.details || "Supabase 请求失败");
  }
  return body;
}
async function maybeRows(table, query = "") {
  if (!hasDb()) return [];
  try {
    const rows = await supabaseJson(restUrl(table, query), { headers: serviceHeaders() });
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}
function nowIso() {
  return new Date().toISOString();
}
function todayKey() {
  return new Date().toISOString().slice(0, 10);
}
function monthKey() {
  return new Date().toISOString().slice(0, 7);
}
function num(v) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}
function round(v) {
  return Math.round(num(v) * 100) / 100;
}
function parseMeta(note) {
  const text = String(note || "");
  const idx = text.indexOf(PREFIX);
  if (idx === -1) return {};
  try {
    return JSON.parse(text.slice(idx + PREFIX.length));
  } catch {
    return {};
  }
}
function stringifyMeta(meta) {
  return `${PREFIX}${JSON.stringify(meta || {})}`;
}
function monthStart(month = monthKey()) {
  return `${month}-01`;
}
async function configRow(serviceId) {
  const rows = await maybeRows(
    "customer_service_reports",
    `?customer_service_id=eq.${encodeURIComponent(serviceId)}&report_date=eq.${CONFIG_DATE}&order=created_at.desc&limit=1`
  );
  return rows[0] || null;
}
export async function getServiceConfig(serviceId) {
  const row = await configRow(serviceId);
  const meta = parseMeta(row?.note);
  return {
    rowId: row?.id || "",
    employeeCode: meta.employeeCode || "",
    shiftName: meta.shiftName || "默认班次",
    shiftStart: meta.shiftStart || "09:00",
    shiftEnd: meta.shiftEnd || "18:00",
    joinDate: meta.joinDate || "",
    baseSalary: num(meta.baseSalary || 0),
    attendanceBonus: num(meta.attendanceBonus || 0),
    receptionBonus: num(meta.receptionBonus || 0),
    orderCommission: num(meta.orderCommission || 0),
    nightShiftAllowance: num(meta.nightShiftAllowance || 0),
    standardDays: num(meta.standardDays || 22),
    graceMinutes: num(meta.graceMinutes || 10),
    lateDeduction: num(meta.lateDeduction || 0),
    absenceDeduction: num(meta.absenceDeduction || 0),
    earlyLeaveDeduction: num(meta.earlyLeaveDeduction || 0),
    otherAdjustment: num(meta.otherAdjustment || 0),
    frozen: !!meta.frozen,
  };
}
export async function saveServiceConfig(serviceId, input = {}) {
  const current = await getServiceConfig(serviceId);
  const next = {
    employeeCode: String(input.employeeCode || current.employeeCode || "").trim(),
    shiftName: String(input.shiftName || current.shiftName || "默认班次").trim(),
    shiftStart: String(input.shiftStart || current.shiftStart || "09:00").trim(),
    shiftEnd: String(input.shiftEnd || current.shiftEnd || "18:00").trim(),
    joinDate: String(input.joinDate || current.joinDate || "").trim(),
    baseSalary: num(input.baseSalary != null ? input.baseSalary : current.baseSalary),
    attendanceBonus: num(input.attendanceBonus != null ? input.attendanceBonus : current.attendanceBonus),
    receptionBonus: num(input.receptionBonus != null ? input.receptionBonus : current.receptionBonus),
    orderCommission: num(input.orderCommission != null ? input.orderCommission : current.orderCommission),
    nightShiftAllowance: num(input.nightShiftAllowance != null ? input.nightShiftAllowance : current.nightShiftAllowance),
    standardDays: num(input.standardDays != null ? input.standardDays : current.standardDays || 22),
    graceMinutes: num(input.graceMinutes != null ? input.graceMinutes : current.graceMinutes || 10),
    lateDeduction: num(input.lateDeduction != null ? input.lateDeduction : current.lateDeduction),
    absenceDeduction: num(input.absenceDeduction != null ? input.absenceDeduction : current.absenceDeduction),
    earlyLeaveDeduction: num(input.earlyLeaveDeduction != null ? input.earlyLeaveDeduction : current.earlyLeaveDeduction),
    otherAdjustment: num(input.otherAdjustment != null ? input.otherAdjustment : current.otherAdjustment),
    frozen: !!(input.frozen != null ? input.frozen : current.frozen),
  };
  const payload = {
    customer_service_id: serviceId,
    report_date: CONFIG_DATE,
    shift_start: null,
    shift_end: null,
    orders_handled: 0,
    salary_amount: next.baseSalary,
    note: stringifyMeta({ kind: "config", ...next }),
    status: "approved",
    admin_note: "service_config",
    created_at: nowIso(),
  };
  if (current.rowId) {
    const rows = await supabaseJson(restUrl("customer_service_reports", `?id=eq.${encodeURIComponent(current.rowId)}`), {
      method: "PATCH",
      headers: serviceHeaders(),
      body: JSON.stringify(payload),
    });
    return rows?.[0] || payload;
  }
  const rows = await supabaseJson(restUrl("customer_service_reports"), {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify(payload),
  });
  return rows?.[0] || payload;
}
async function attendanceRow(serviceId, workDate = todayKey()) {
  const rows = await maybeRows(
    "customer_service_reports",
    `?customer_service_id=eq.${encodeURIComponent(serviceId)}&report_date=eq.${encodeURIComponent(workDate)}&order=created_at.desc&limit=1`
  );
  return rows.find((row) => parseMeta(row.note).kind !== "config") || rows[0] || null;
}
function timeText(value) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit" });
  } catch {
    return String(value);
  }
}
function workHours(clockInAt, clockOutAt) {
  if (!clockInAt || !clockOutAt) return 0;
  const diff = (Date.parse(clockOutAt) - Date.parse(clockInAt)) / 3600000;
  return diff > 0 ? round(diff) : 0;
}
function calcAttendanceMeta(config, row, workDate = todayKey()) {
  const meta = parseMeta(row?.note);
  const clockInAt = row?.shift_start || meta.clockInAt || "";
  const clockOutAt = row?.shift_end || meta.clockOutAt || "";
  const shiftStart = `${workDate}T${config.shiftStart || "09:00"}:00.000Z`;
  const shiftEnd = `${workDate}T${config.shiftEnd || "18:00"}:00.000Z`;
  const lateMinutes = clockInAt ? Math.max(0, Math.round((Date.parse(clockInAt) - Date.parse(shiftStart)) / 60000) - num(config.graceMinutes || 0)) : 0;
  const earlyLeaveMinutes = clockOutAt ? Math.max(0, Math.round((Date.parse(shiftEnd) - Date.parse(clockOutAt)) / 60000)) : 0;
  let attendanceStatus = "未打卡";
  if (clockInAt && !clockOutAt) attendanceStatus = lateMinutes > 0 ? "迟到" : "上班中";
  if (clockInAt && clockOutAt) attendanceStatus = earlyLeaveMinutes > 0 ? "早退" : (lateMinutes > 0 ? "迟到" : "正常");
  return {
    ...meta,
    kind: "attendance",
    clockInAt,
    clockOutAt,
    attendanceStatus,
    lateMinutes,
    earlyLeaveMinutes,
    workHours: workHours(clockInAt, clockOutAt),
    clockInText: timeText(clockInAt),
    clockOutText: timeText(clockOutAt),
  };
}
export async function clockInService(serviceId) {
  const workDate = todayKey();
  const existing = await attendanceRow(serviceId, workDate);
  const config = await getServiceConfig(serviceId);
  if (existing?.shift_start) return existing;
  const payload = {
    customer_service_id: serviceId,
    report_date: workDate,
    shift_start: nowIso(),
    shift_end: existing?.shift_end || null,
    orders_handled: num(existing?.orders_handled || 0),
    salary_amount: num(existing?.salary_amount || 0),
    note: stringifyMeta({ kind: "attendance", clockInAt: nowIso() }),
    status: existing?.status || "pending",
    admin_note: existing?.admin_note || "",
    created_at: existing?.created_at || nowIso(),
  };
  const rows = existing?.id
    ? await supabaseJson(restUrl("customer_service_reports", `?id=eq.${encodeURIComponent(existing.id)}`), {
        method: "PATCH",
        headers: serviceHeaders(),
        body: JSON.stringify(payload),
      })
    : await supabaseJson(restUrl("customer_service_reports"), {
        method: "POST",
        headers: serviceHeaders(),
        body: JSON.stringify(payload),
      });
  const saved = rows?.[0] || payload;
  return { row: saved, meta: calcAttendanceMeta(config, saved, workDate) };
}
export async function clockOutService(serviceId) {
  const workDate = todayKey();
  const existing = await attendanceRow(serviceId, workDate);
  if (!existing?.shift_start) throw Object.assign(new Error("请先上班打卡。"), { status: 400 });
  if (existing?.shift_end) return existing;
  const config = await getServiceConfig(serviceId);
  const payload = {
    shift_end: nowIso(),
    note: stringifyMeta({ kind: "attendance", clockInAt: existing.shift_start, clockOutAt: nowIso() }),
  };
  const rows = await supabaseJson(restUrl("customer_service_reports", `?id=eq.${encodeURIComponent(existing.id)}`), {
    method: "PATCH",
    headers: serviceHeaders(),
    body: JSON.stringify(payload),
  });
  const saved = rows?.[0] || { ...existing, ...payload };
  return { row: saved, meta: calcAttendanceMeta(config, saved, workDate) };
}
export async function loadServiceWorkData(serviceId) {
  const [config, profiles, orders, conversations, receptions, reports] = await Promise.all([
    getServiceConfig(serviceId),
    maybeRows("profiles", `?id=eq.${encodeURIComponent(serviceId)}&limit=1`),
    maybeRows("orders", "?order=created_at.desc&limit=1000"),
    maybeRows("conversations", "?order=updated_at.desc&limit=1000"),
    maybeRows("service_receptions", `?customer_service_id=eq.${encodeURIComponent(serviceId)}&order=started_at.desc&limit=1000`),
    maybeRows("customer_service_reports", `?customer_service_id=eq.${encodeURIComponent(serviceId)}&order=report_date.desc&limit=1000`),
  ]);
  const profile = profiles[0] || null;
  const month = monthKey();
  const today = todayKey();
  const attendanceRows = reports.filter((row) => row.report_date !== CONFIG_DATE);
  const todayAttendance = attendanceRows.find((row) => row.report_date === today) || null;
  const attendanceMeta = calcAttendanceMeta(config, todayAttendance, today);
  const monthAttendance = attendanceRows.filter((row) => String(row.report_date || "").slice(0, 7) === month);
  const myOrders = orders.filter((row) => row.customer_service_id === serviceId);
  const myConversations = conversations.filter((row) => row.customer_service_id === serviceId);
  const monthReceptions = receptions.filter((row) => String(row.started_at || "").slice(0, 7) === month);
  const todayOrders = myOrders.filter((row) => String(row.created_at || "").slice(0, 10) === today);
  const todayCompleted = myOrders.filter((row) => row.status === "completed" && String(row.completed_at || row.created_at || "").slice(0, 10) === today).length;
  const todayRefunds = myOrders.filter((row) => ["refund_requested", "refunded"].includes(String(row.status || "")) && String(row.created_at || "").slice(0, 10) === today).length;
  const todayPaid = myOrders.filter((row) => String(row.status || "") === "claimed" && String(row.accepted_at || row.created_at || "").slice(0, 10) === today).length;
  const unreadMessages = 0;
  const actualDays = monthAttendance.filter((row) => !!row.shift_start).length;
  const lateCount = monthAttendance.filter((row) => calcAttendanceMeta(config, row, row.report_date).lateMinutes > 0).length;
  const earlyLeaveCount = monthAttendance.filter((row) => calcAttendanceMeta(config, row, row.report_date).earlyLeaveMinutes > 0).length;
  const absenceCount = Math.max(0, num(config.standardDays || 22) - actualDays);
  const allPerfect = actualDays >= num(config.standardDays || 22) && !lateCount && !earlyLeaveCount && !absenceCount;
  const receptionBonus = round(monthReceptions.length * num(config.receptionBonus || 0));
  const orderCommission = round(myOrders.filter((row) => String(row.created_at || "").slice(0, 7) === month).length * num(config.orderCommission || 0));
  const lateDeduction = round(lateCount * num(config.lateDeduction || 0));
  const absenceDeduction = round(absenceCount * num(config.absenceDeduction || 0));
  const earlyLeaveDeduction = round(earlyLeaveCount * num(config.earlyLeaveDeduction || 0));
  const estimatedSalary = round(num(config.baseSalary || 0) + (allPerfect ? num(config.attendanceBonus || 0) : 0) + receptionBonus + orderCommission + num(config.nightShiftAllowance || 0) + num(config.otherAdjustment || 0) - lateDeduction - absenceDeduction - earlyLeaveDeduction);
  const salaryRecord = {
    salaryMonth: month,
    baseSalary: num(config.baseSalary || 0),
    attendanceBonus: allPerfect ? num(config.attendanceBonus || 0) : 0,
    receptionBonus,
    orderCommission,
    nightShiftAllowance: num(config.nightShiftAllowance || 0),
    lateDeduction,
    absenceDeduction,
    earlyLeaveDeduction,
    otherAdjustment: num(config.otherAdjustment || 0),
    totalSalary: estimatedSalary,
    status: "统计中",
  };
  return {
    profile,
    config,
    todayAttendance: attendanceMeta,
    summary: {
      todayReceptions: monthReceptions.filter((row) => String(row.started_at || "").slice(0, 10) === today).length,
      currentReceptions: myConversations.length,
      todayCompleted,
      todayPaid,
      todayRefunds,
      unreadMessages,
      monthAttendanceDays: actualDays,
      monthLateCount: lateCount,
      monthAbsenceCount: absenceCount,
      estimatedSalary,
    },
    attendance: {
      standardDays: num(config.standardDays || 22),
      actualDays,
      lateCount,
      earlyLeaveCount,
      absenceCount,
      fullAttendance: allPerfect,
      fullAttendanceBonus: allPerfect ? num(config.attendanceBonus || 0) : 0,
      rows: monthAttendance.map((row) => ({ reportDate: row.report_date, ...calcAttendanceMeta(config, row, row.report_date) })),
    },
    salary: {
      current: salaryRecord,
      history: [salaryRecord],
    },
  };
}
