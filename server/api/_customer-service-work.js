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
function shanghaiParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const map = {};
  parts.forEach((p) => {
    if (p.type !== "literal") map[p.type] = p.value;
  });
  return map;
}
function todayKey(date = new Date()) {
  const p = shanghaiParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}
function monthKey(date = new Date()) {
  return todayKey(date).slice(0, 7);
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
    const p = shanghaiParts(new Date(value));
    return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
  } catch {
    return String(value);
  }
}
function workHours(clockInAt, clockOutAt) {
  if (!clockInAt) return 0;
  const end = clockOutAt ? Date.parse(clockOutAt) : Date.now();
  const diff = (end - Date.parse(clockInAt)) / 3600000;
  return diff > 0 ? round(diff) : 0;
}
export function calcAttendanceMeta(config, row, workDate = todayKey()) {
  const meta = parseMeta(row?.note);
  const clockInAt = row?.shift_start || meta.clockInAt || "";
  const clockOutAt = row?.shift_end || meta.clockOutAt || "";
  const shiftStart = `${workDate}T${config.shiftStart || "09:00"}:00+08:00`;
  const shiftEnd = `${workDate}T${config.shiftEnd || "18:00"}:00+08:00`;
  const lateMinutes = clockInAt ? Math.max(0, Math.round((Date.parse(clockInAt) - Date.parse(shiftStart)) / 60000) - num(config.graceMinutes || 0)) : 0;
  const earlyLeaveMinutes = clockOutAt ? Math.max(0, Math.round((Date.parse(shiftEnd) - Date.parse(clockOutAt)) / 60000)) : 0;
  const hours = workHours(clockInAt, clockOutAt);
  const today = todayKey();
  const isLate = lateMinutes > 0;
  const isEarlyLeave = earlyLeaveMinutes > 0;
  const isAbsent = !clockInAt && String(workDate) < today;
  let attendanceStatus = "未打卡";
  let dutyStatus = "none";
  if (clockInAt && !clockOutAt) {
    attendanceStatus = "上班中";
    dutyStatus = "on_duty";
  } else if (clockInAt && clockOutAt) {
    attendanceStatus = "已下班";
    dutyStatus = "off_duty";
  } else if (isAbsent) {
    attendanceStatus = "缺勤";
    dutyStatus = "absent";
  }
  return {
    ...meta,
    kind: "attendance",
    reportDate: workDate,
    clockInAt,
    clockOutAt,
    attendanceStatus,
    dutyStatus,
    lateMinutes,
    earlyLeaveMinutes,
    isLate,
    isEarlyLeave,
    isAbsent,
    workHours: hours,
    clockInText: timeText(clockInAt),
    clockOutText: timeText(clockOutAt),
    canClockIn: !clockInAt,
    canClockOut: !!(clockInAt && !clockOutAt),
    clockedIn: !!clockInAt,
    clockedOut: !!(clockInAt && clockOutAt),
  };
}
async function verifyAttendanceWrite(serviceId, workDate, expect) {
  const row = await attendanceRow(serviceId, workDate);
  if (!row?.id) throw Object.assign(new Error("打卡写入失败：未找到考勤记录，请重试。"), { status: 500 });
  if (expect?.shift_start && !row.shift_start) {
    throw Object.assign(new Error("上班打卡写入失败，请重试。"), { status: 500 });
  }
  if (expect?.shift_end && !row.shift_end) {
    throw Object.assign(new Error("下班打卡写入失败，请重试。"), { status: 500 });
  }
  return row;
}
function defaultClockConfig(extra) {
  return Object.assign(
    {
      shiftStart: "09:00",
      shiftEnd: "18:00",
      graceMinutes: 10,
    },
    extra || {}
  );
}
/** Fast path: one read + one write. No config/bootstrap/history. */
export async function clockInService(serviceId, opts = {}) {
  if (!hasDb()) throw Object.assign(new Error("未配置数据库，无法打卡。"), { status: 503 });
  const t0 = Date.now();
  const workDate = todayKey();
  const config = defaultClockConfig(opts.config);
  const existing = await attendanceRow(serviceId, workDate);
  if (existing?.shift_start) {
    return {
      row: existing,
      meta: calcAttendanceMeta(config, existing, workDate),
      already: true,
      elapsedMs: Date.now() - t0,
    };
  }
  const started = nowIso();
  const payload = {
    customer_service_id: serviceId,
    report_date: workDate,
    shift_start: started,
    shift_end: existing?.shift_end || null,
    orders_handled: num(existing?.orders_handled || 0),
    salary_amount: 0,
    note: stringifyMeta({
      kind: "attendance",
      clockInAt: started,
      dutyStatus: "on_duty",
      workDate,
    }),
    status: existing?.status || "pending",
    admin_note: "attendance",
    created_at: existing?.created_at || started,
  };
  let saved = null;
  if (existing?.id) {
    const rows = await supabaseJson(restUrl("customer_service_reports", `?id=eq.${encodeURIComponent(existing.id)}`), {
      method: "PATCH",
      headers: serviceHeaders(),
      body: JSON.stringify(payload),
    });
    saved = rows?.[0] || { ...existing, ...payload, id: existing.id };
  } else {
    try {
      const rows = await supabaseJson(
        restUrl("customer_service_reports", "?on_conflict=customer_service_id,report_date"),
        {
          method: "POST",
          headers: serviceHeaders({ Prefer: "resolution=merge-duplicates,return=representation" }),
          body: JSON.stringify(payload),
        }
      );
      saved = rows?.[0] || null;
    } catch (_) {
      const rows = await supabaseJson(restUrl("customer_service_reports"), {
        method: "POST",
        headers: serviceHeaders(),
        body: JSON.stringify(payload),
      });
      saved = rows?.[0] || null;
    }
  }
  if (!saved?.id || !saved.shift_start) {
    saved = await verifyAttendanceWrite(serviceId, workDate, { shift_start: true });
  }
  return {
    row: saved,
    meta: calcAttendanceMeta(config, saved, workDate),
    already: false,
    elapsedMs: Date.now() - t0,
  };
}
export async function clockOutService(serviceId, opts = {}) {
  if (!hasDb()) throw Object.assign(new Error("未配置数据库，无法打卡。"), { status: 503 });
  const t0 = Date.now();
  const workDate = todayKey();
  const config = defaultClockConfig(opts.config);
  const existing = await attendanceRow(serviceId, workDate);
  if (!existing?.shift_start) throw Object.assign(new Error("请先上班打卡。"), { status: 400 });
  if (existing?.shift_end) {
    return {
      row: existing,
      meta: calcAttendanceMeta(config, existing, workDate),
      already: true,
      elapsedMs: Date.now() - t0,
    };
  }
  if (!existing?.id) throw Object.assign(new Error("找不到今日上班记录，请先重新上班打卡。"), { status: 400 });
  const ended = nowIso();
  const hours = workHours(existing.shift_start, ended);
  const payload = {
    shift_end: ended,
    salary_amount: hours,
    note: stringifyMeta({
      kind: "attendance",
      clockInAt: existing.shift_start,
      clockOutAt: ended,
      workHours: hours,
      dutyStatus: "off_duty",
      workDate,
    }),
    admin_note: "attendance",
  };
  const rows = await supabaseJson(restUrl("customer_service_reports", `?id=eq.${encodeURIComponent(existing.id)}`), {
    method: "PATCH",
    headers: serviceHeaders(),
    body: JSON.stringify(payload),
  });
  let saved = rows?.[0] || { ...existing, ...payload };
  if (!saved.shift_end) {
    saved = await verifyAttendanceWrite(serviceId, workDate, { shift_end: true });
  }
  return {
    row: saved,
    meta: calcAttendanceMeta(config, saved, workDate),
    already: false,
    elapsedMs: Date.now() - t0,
  };
}
/** Admin / wage: flatten attendance history for one or all CS staff. */
export async function listAttendanceHistory(opts = {}) {
  const month = String(opts.month || monthKey());
  const serviceId = String(opts.serviceId || "").trim();
  const query = serviceId
    ? `?customer_service_id=eq.${encodeURIComponent(serviceId)}&report_date=gte.${month}-01&report_date=lte.${month}-31&order=report_date.desc&limit=500`
    : `?report_date=gte.${month}-01&report_date=lte.${month}-31&order=report_date.desc&limit=2000`;
  const [reports, profiles] = await Promise.all([
    maybeRows("customer_service_reports", query),
    maybeRows("profiles", "?role=eq.customer_service&limit=500"),
  ]);
  const nameById = (profiles || []).reduce((m, p) => {
    m[p.id] = p.display_name || p.email || p.id;
    return m;
  }, {});
  const configCache = {};
  const rows = [];
  for (const row of reports || []) {
    if (row.report_date === CONFIG_DATE) continue;
    const metaKind = parseMeta(row.note).kind;
    if (metaKind === "config") continue;
    if (!configCache[row.customer_service_id]) {
      configCache[row.customer_service_id] = await getServiceConfig(row.customer_service_id);
    }
    const config = configCache[row.customer_service_id];
    const meta = calcAttendanceMeta(config, row, row.report_date);
    rows.push({
      id: row.id,
      serviceId: row.customer_service_id,
      serviceName: nameById[row.customer_service_id] || row.customer_service_id,
      date: row.report_date,
      clockInAt: meta.clockInAt,
      clockOutAt: meta.clockOutAt,
      clockInText: meta.clockInText || "-",
      clockOutText: meta.clockOutText || "-",
      workHours: meta.workHours,
      attendanceStatus: meta.attendanceStatus,
      isLate: meta.isLate,
      isAbsent: meta.isAbsent,
      isEarlyLeave: meta.isEarlyLeave,
      lateMinutes: meta.lateMinutes,
    });
  }
  return rows;
}
/** Build payroll draft numbers from live attendance + reception stats. */
export async function payrollDraftFromAttendance(serviceId, periodStart, periodEnd) {
  const work = await loadServiceWorkData(serviceId);
  const salary = work?.salary?.current || {};
  const att = work?.attendance || {};
  return {
    staffId: serviceId,
    periodStart: periodStart || `${monthKey()}-01`,
    periodEnd: periodEnd || todayKey(),
    workDays: num(att.actualDays || 0),
    fullAttendance: !!att.fullAttendance,
    receptionCount: num(work?.summary?.monthReceptions || 0),
    orderCount: 0,
    baseSalaryRm: num(salary.baseSalary || 0),
    bonusRm: round(num(salary.attendanceBonus || 0) + num(salary.receptionBonus || 0) + num(salary.orderCommission || 0) + num(salary.nightShiftAllowance || 0)),
    deductionRm: round(num(salary.lateDeduction || 0) + num(salary.absenceDeduction || 0) + num(salary.earlyLeaveDeduction || 0)),
    netSalaryRm: num(salary.totalSalary || 0),
    note: `自动读取 ${monthKey()} 打卡与接待统计`,
    attendance: att,
    salary,
  };
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
      monthReceptions: monthReceptions.length,
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
      rows: monthAttendance.map((row) => {
        const m = calcAttendanceMeta(config, row, row.report_date);
        return { reportDate: row.report_date, date: row.report_date, ...m };
      }),
    },
    salary: {
      current: salaryRecord,
      history: [salaryRecord],
    },
  };
}
