import "./_load-env.js";

const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const CONFIG_DATE = "1970-01-01";
const GLOBAL_CONFIG_ID = "global";
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
function configFromMeta(meta = {}) {
  return {
    employeeCode: meta.employeeCode || "",
    shiftName: meta.shiftName || "默认班次",
    shiftStart: meta.shiftStart || "09:00",
    shiftEnd: meta.shiftEnd || "18:00",
    joinDate: meta.joinDate || "",
    baseSalary: num(meta.baseSalary || 0),
    attendanceBonus: num(meta.attendanceBonus || 0),
    receptionBonus: num(meta.receptionBonus || 0),
    orderCommission: num(meta.orderCommission || 0),
    commissionPercent: num(meta.commissionPercent || 0),
    nightShiftAllowance: num(meta.nightShiftAllowance || 0),
    overtimeAllowance: num(meta.overtimeAllowance || 0),
    standardDays: num(meta.standardDays || 22),
    graceMinutes: num(meta.graceMinutes || 10),
    lateDeduction: num(meta.lateDeduction || 0),
    absenceDeduction: num(meta.absenceDeduction || 0),
    earlyLeaveDeduction: num(meta.earlyLeaveDeduction || 0),
    otherAdjustment: num(meta.otherAdjustment || 0),
    settleOnOrderComplete: meta.settleOnOrderComplete !== false,
    settleOnPayment: !!meta.settleOnPayment,
    clawbackOnRefund: meta.clawbackOnRefund !== false,
    frozen: !!meta.frozen,
  };
}
export function mergeServiceConfig(globalCfg = {}, staffCfg = {}) {
  const hasGlobal = !!globalCfg.rowId;
  return {
    ...staffCfg,
    baseSalary: num(staffCfg.baseSalary) || num(globalCfg.baseSalary),
    attendanceBonus: hasGlobal ? num(globalCfg.attendanceBonus) : num(staffCfg.attendanceBonus) || num(globalCfg.attendanceBonus),
    receptionBonus: hasGlobal ? num(globalCfg.receptionBonus) : num(staffCfg.receptionBonus) || num(globalCfg.receptionBonus),
    orderCommission: hasGlobal ? num(globalCfg.orderCommission) : num(staffCfg.orderCommission) || num(globalCfg.orderCommission),
    commissionPercent: hasGlobal ? num(globalCfg.commissionPercent) : num(staffCfg.commissionPercent) || num(globalCfg.commissionPercent),
    nightShiftAllowance: num(staffCfg.nightShiftAllowance) || num(globalCfg.nightShiftAllowance),
    overtimeAllowance: num(staffCfg.overtimeAllowance) || num(globalCfg.overtimeAllowance),
    settleOnOrderComplete:
      hasGlobal && globalCfg.settleOnOrderComplete != null
        ? !!globalCfg.settleOnOrderComplete
        : globalCfg.settleOnOrderComplete != null
          ? !!globalCfg.settleOnOrderComplete
          : staffCfg.settleOnOrderComplete !== false,
    settleOnPayment:
      hasGlobal && globalCfg.settleOnPayment != null ? !!globalCfg.settleOnPayment : !!globalCfg.settleOnPayment || !!staffCfg.settleOnPayment,
    clawbackOnRefund:
      hasGlobal && globalCfg.clawbackOnRefund != null
        ? !!globalCfg.clawbackOnRefund
        : globalCfg.clawbackOnRefund != null
          ? !!globalCfg.clawbackOnRefund
          : staffCfg.clawbackOnRefund !== false,
    lateDeduction: num(staffCfg.lateDeduction) || num(globalCfg.lateDeduction),
    absenceDeduction: num(staffCfg.absenceDeduction) || num(globalCfg.absenceDeduction),
    earlyLeaveDeduction: num(staffCfg.earlyLeaveDeduction) || num(globalCfg.earlyLeaveDeduction),
    standardDays: num(staffCfg.standardDays) || num(globalCfg.standardDays) || 22,
    graceMinutes: num(staffCfg.graceMinutes) || num(globalCfg.graceMinutes) || 10,
  };
}
function orderAmount(row) {
  return num(row?.amount ?? row?.total_amount ?? row?.total ?? row?.price ?? 0);
}
function orderQualifiesForCommission(row, config) {
  const status = String(row?.status || "");
  if (["cancelled", "canceled", "refunded", "refund_requested", "awaiting_payment"].includes(status)) return false;
  const amount = orderAmount(row);
  if (!(amount > 0)) return false;
  const ps = String(row?.payment_status || row?.paymentStatus || "").toLowerCase();
  const paidHint =
    !!row?.paid_at ||
    !!row?.paidAt ||
    ["paid", "succeeded", "已支付", "success"].includes(ps) ||
    ["pending", "waiting_boss_confirm", "claimed", "confirmed", "in_progress", "completed", "reviewed", "paid"].includes(status);
  if (!paidHint) return false;
  if (config.settleOnOrderComplete && status === "completed") return true;
  if (config.settleOnPayment && ["claimed", "in_progress", "completed", "paid", "confirmed", "waiting_boss_confirm", "pending"].includes(status)) return true;
  if (!config.settleOnOrderComplete && !config.settleOnPayment) return true;
  return false;
}
function calcOrderCommission(orders, config, settlementsByOrderId = {}) {
  // Source of truth: settled ledger rows only (end_reception + paid gate). No speculative live rates.
  let fromLedger = 0;
  const seen = new Set();
  for (const settled of Object.values(settlementsByOrderId || {})) {
    const id = settled.id || settled.orderId || settled.order_id;
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    if (String(settled.status || "") === "settled") {
      fromLedger = round(fromLedger + num(settled.finalAmountRm ?? settled.final_amount_rm));
    }
  }
  return Math.max(0, fromLedger);
}
function monthStart(month = monthKey()) {
  return `${month}-01`;
}
async function configRow(serviceId) {
  // "global" is not a UUID — skip REST query that would 400 on uuid columns.
  if (!serviceId || serviceId === GLOBAL_CONFIG_ID || !/^[0-9a-f-]{36}$/i.test(String(serviceId))) {
    return null;
  }
  const rows = await maybeRows(
    "customer_service_reports",
    `?customer_service_id=eq.${encodeURIComponent(serviceId)}&report_date=eq.${CONFIG_DATE}&order=created_at.desc&limit=1`
  );
  return rows[0] || null;
}
const DEFAULT_GLOBAL_COMMISSION = Object.freeze({
  baseSalary: 350,
  attendanceBonus: 50,
  receptionBonus: 0,
  orderCommission: 2,
  commissionPercent: 5,
  nightShiftAllowance: 0,
  overtimeAllowance: 0,
  otherAdjustment: 0,
  standardDays: 22,
  graceMinutes: 10,
  lateDeduction: 0,
  absenceDeduction: 0,
  earlyLeaveDeduction: 0,
  settleOnOrderComplete: true,
  settleOnPayment: false,
  clawbackOnRefund: true,
});

async function readPlatformCsCommission() {
  if (!hasDb()) return null;
  try {
    const rows = await supabaseJson(restUrl("platform_settings", "?id=eq.global&limit=1"), { headers: serviceHeaders() });
    const data = Array.isArray(rows) ? rows[0]?.data : rows?.data;
    const raw = data?.csCommission;
    if (raw && typeof raw === "object") return { ...configFromMeta(raw), rowId: "platform_settings:global", source: "platform_settings" };
  } catch {
    /* fall through */
  }
  return null;
}

async function writePlatformCsCommission(next, adminId = "") {
  if (!hasDb()) return null;
  try {
    const rows = await supabaseJson(restUrl("platform_settings", "?id=eq.global&limit=1"), { headers: serviceHeaders() });
    const existing = Array.isArray(rows) ? rows[0] : null;
    const prevData = existing?.data && typeof existing.data === "object" ? existing.data : {};
    const data = { ...prevData, csCommission: { ...next, updatedAt: nowIso() } };
    const body = { id: "global", data, updated_at: nowIso() };
    if (adminId) body.updated_by = adminId;
    if (existing?.id) {
      await supabaseJson(restUrl("platform_settings", "?id=eq.global"), {
        method: "PATCH",
        headers: serviceHeaders(),
        body: JSON.stringify({ data, updated_at: nowIso(), ...(adminId ? { updated_by: adminId } : {}) }),
      });
    } else {
      await supabaseJson(restUrl("platform_settings", "?on_conflict=id"), {
        method: "POST",
        headers: serviceHeaders({ Prefer: "resolution=merge-duplicates,return=representation" }),
        body: JSON.stringify(body),
      });
    }
    return data.csCommission;
  } catch {
    return null;
  }
}

export async function getServiceConfig(serviceId) {
  const row = await configRow(serviceId);
  const meta = parseMeta(row?.note);
  return { rowId: row?.id || "", serviceId, ...configFromMeta(meta) };
}
export async function getGlobalCommissionConfig() {
  const fromPlatform = await readPlatformCsCommission();
  if (fromPlatform) return { ...DEFAULT_GLOBAL_COMMISSION, ...fromPlatform, serviceId: GLOBAL_CONFIG_ID };
  // Legacy META row used serviceId="global" which is invalid UUID on strict schemas — skip quietly.
  try {
    const fromMeta = await getServiceConfig(GLOBAL_CONFIG_ID);
    const hasAny =
      fromMeta.rowId ||
      num(fromMeta.baseSalary) ||
      num(fromMeta.orderCommission) ||
      num(fromMeta.commissionPercent) ||
      num(fromMeta.attendanceBonus);
    if (hasAny) return { ...DEFAULT_GLOBAL_COMMISSION, ...fromMeta, serviceId: GLOBAL_CONFIG_ID };
  } catch {
    /* invalid uuid / missing row */
  }
  return { rowId: "", serviceId: GLOBAL_CONFIG_ID, source: "defaults", ...DEFAULT_GLOBAL_COMMISSION, ...configFromMeta({}) };
}
export async function saveGlobalCommissionConfig(input = {}) {
  const current = await getGlobalCommissionConfig();
  const next = {
    baseSalary: num(input.baseSalary != null ? input.baseSalary : current.baseSalary),
    attendanceBonus: num(input.attendanceBonus != null ? input.attendanceBonus : current.attendanceBonus),
    receptionBonus: num(input.receptionBonus != null ? input.receptionBonus : current.receptionBonus),
    orderCommission: num(input.orderCommission != null ? input.orderCommission : current.orderCommission),
    commissionPercent: num(input.commissionPercent != null ? input.commissionPercent : current.commissionPercent),
    nightShiftAllowance: num(input.nightShiftAllowance != null ? input.nightShiftAllowance : current.nightShiftAllowance),
    overtimeAllowance: num(input.overtimeAllowance != null ? input.overtimeAllowance : current.overtimeAllowance),
    otherAdjustment: num(input.otherAdjustment != null ? input.otherAdjustment : current.otherAdjustment),
    standardDays: num(input.standardDays != null ? input.standardDays : current.standardDays || 22),
    graceMinutes: num(input.graceMinutes != null ? input.graceMinutes : current.graceMinutes || 10),
    lateDeduction: num(input.lateDeduction != null ? input.lateDeduction : current.lateDeduction),
    absenceDeduction: num(input.absenceDeduction != null ? input.absenceDeduction : current.absenceDeduction),
    earlyLeaveDeduction: num(input.earlyLeaveDeduction != null ? input.earlyLeaveDeduction : current.earlyLeaveDeduction),
    settleOnOrderComplete: !!(input.settleOnOrderComplete != null ? input.settleOnOrderComplete : current.settleOnOrderComplete !== false),
    settleOnPayment: !!(input.settleOnPayment != null ? input.settleOnPayment : current.settleOnPayment),
    clawbackOnRefund: !!(input.clawbackOnRefund != null ? input.clawbackOnRefund : current.clawbackOnRefund !== false),
  };
  const written = await writePlatformCsCommission(next);
  if (!written) {
    throw Object.assign(new Error("写入 platform_settings.csCommission 失败"), { status: 500 });
  }
  return written;
}
export async function saveServiceConfig(serviceId, input = {}) {
  if (serviceId === GLOBAL_CONFIG_ID) {
    return saveGlobalCommissionConfig(input);
  }
  if (!serviceId || !/^[0-9a-f-]{36}$/i.test(String(serviceId))) {
    throw Object.assign(new Error("无效的客服 ID"), { status: 400 });
  }
  const current = await getServiceConfig(serviceId);
  const defaults = {};
  const next = {
    employeeCode: String(input.employeeCode || current.employeeCode || "").trim(),
    shiftName: String(input.shiftName || current.shiftName || "默认班次").trim(),
    shiftStart: String(input.shiftStart || current.shiftStart || "09:00").trim(),
    shiftEnd: String(input.shiftEnd || current.shiftEnd || "18:00").trim(),
    joinDate: String(input.joinDate || current.joinDate || "").trim(),
    baseSalary: num(input.baseSalary != null ? input.baseSalary : current.baseSalary != null ? current.baseSalary : defaults.baseSalary),
    attendanceBonus: num(
      input.attendanceBonus != null ? input.attendanceBonus : current.attendanceBonus != null ? current.attendanceBonus : defaults.attendanceBonus
    ),
    receptionBonus: num(input.receptionBonus != null ? input.receptionBonus : current.receptionBonus),
    orderCommission: num(
      input.orderCommission != null ? input.orderCommission : current.orderCommission != null ? current.orderCommission : defaults.orderCommission
    ),
    commissionPercent: num(
      input.commissionPercent != null
        ? input.commissionPercent
        : current.commissionPercent != null
          ? current.commissionPercent
          : defaults.commissionPercent
    ),
    nightShiftAllowance: num(input.nightShiftAllowance != null ? input.nightShiftAllowance : current.nightShiftAllowance),
    standardDays: num(input.standardDays != null ? input.standardDays : current.standardDays || 22),
    graceMinutes: num(input.graceMinutes != null ? input.graceMinutes : current.graceMinutes || 10),
    lateDeduction: num(input.lateDeduction != null ? input.lateDeduction : current.lateDeduction),
    absenceDeduction: num(input.absenceDeduction != null ? input.absenceDeduction : current.absenceDeduction),
    earlyLeaveDeduction: num(input.earlyLeaveDeduction != null ? input.earlyLeaveDeduction : current.earlyLeaveDeduction),
    otherAdjustment: num(input.otherAdjustment != null ? input.otherAdjustment : current.otherAdjustment),
    settleOnOrderComplete: !!(input.settleOnOrderComplete != null ? input.settleOnOrderComplete : current.settleOnOrderComplete !== false),
    settleOnPayment: !!(input.settleOnPayment != null ? input.settleOnPayment : current.settleOnPayment),
    clawbackOnRefund: !!(input.clawbackOnRefund != null ? input.clawbackOnRefund : current.clawbackOnRefund !== false),
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

async function listSessionsForService(serviceId, opts = {}) {
  const month = String(opts.month || "").trim();
  const workDate = String(opts.workDate || "").trim();
  let query = `?service_id=eq.${encodeURIComponent(serviceId)}&order=clock_in_at.desc&limit=500`;
  if (workDate) {
    query = `?service_id=eq.${encodeURIComponent(serviceId)}&work_date=eq.${encodeURIComponent(workDate)}&order=clock_in_at.desc&limit=100`;
  } else if (month) {
    query = `?service_id=eq.${encodeURIComponent(serviceId)}&work_date=gte.${month}-01&work_date=lte.${month}-31&order=clock_in_at.desc&limit=500`;
  }
  const rows = await maybeRows("cs_attendance_sessions", query);
  return Array.isArray(rows) ? rows : [];
}

async function openSessionForService(serviceId) {
  const rows = await maybeRows(
    "cs_attendance_sessions",
    `?service_id=eq.${encodeURIComponent(serviceId)}&status=eq.open&order=clock_in_at.desc&limit=1`
  );
  return rows[0] || null;
}

function sessionTypeLabel(type) {
  const t = String(type || "normal").toLowerCase();
  if (t === "overtime") return "加班";
  if (t === "temp") return "临时补班";
  if (t === "night") return "夜班";
  return "正常班";
}

function durationMinutes(clockInAt, clockOutAt) {
  if (!clockInAt) return 0;
  const end = clockOutAt ? Date.parse(clockOutAt) : Date.now();
  const start = Date.parse(clockInAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.round(((end - start) / 60000) * 100) / 100;
}

function inferSessionType(config, workDate, priorClosedCount, clockInAt) {
  if (priorClosedCount > 0) return "overtime";
  try {
    const p = shanghaiParts(new Date(clockInAt));
    const hm = `${p.hour}:${p.minute}`;
    const nightStart = String(config.nightShiftStart || "22:00");
    if (hm >= nightStart || hm < "06:00") return "night";
  } catch {
    /* ignore */
  }
  return "normal";
}

function viewSession(row = {}, config = {}) {
  const workDate = String(row.work_date || row.workDate || todayKey());
  const clockInAt = row.clock_in_at || row.clockInAt || "";
  const clockOutAt = row.clock_out_at || row.clockOutAt || "";
  const sessionType = String(row.session_type || row.sessionType || "normal");
  const mins =
    num(row.duration_minutes || row.durationMinutes) ||
    durationMinutes(clockInAt, clockOutAt);
  const hours = Math.round((mins / 60) * 100) / 100;
  const shiftStart = `${workDate}T${config.shiftStart || "09:00"}:00+08:00`;
  const shiftEnd = `${workDate}T${config.shiftEnd || "18:00"}:00+08:00`;
  const lateMinutes =
    sessionType === "normal" && clockInAt
      ? Math.max(0, Math.round((Date.parse(clockInAt) - Date.parse(shiftStart)) / 60000) - num(config.graceMinutes || 0))
      : 0;
  const earlyLeaveMinutes =
    sessionType === "normal" && clockOutAt
      ? Math.max(0, Math.round((Date.parse(shiftEnd) - Date.parse(clockOutAt)) / 60000))
      : 0;
  const open = String(row.status || "") === "open" || (!!clockInAt && !clockOutAt);
  return {
    id: row.id || "",
    serviceId: row.service_id || row.serviceId || "",
    reportDate: workDate,
    workDate,
    clockInAt,
    clockOutAt,
    sessionType,
    sessionTypeLabel: sessionTypeLabel(sessionType),
    durationMinutes: mins,
    workHours: hours,
    status: open ? "open" : row.status || "closed",
    attendanceStatus: open ? "上班中" : clockOutAt ? (sessionType === "overtime" ? "加班已下班" : "已下班") : "未打卡",
    dutyStatus: open ? "on_duty" : clockOutAt ? "off_duty" : "none",
    lateMinutes: num(row.late_minutes != null ? row.late_minutes : lateMinutes),
    earlyLeaveMinutes: num(row.early_leave_minutes != null ? row.early_leave_minutes : earlyLeaveMinutes),
    isLate: (num(row.late_minutes != null ? row.late_minutes : lateMinutes) || 0) > 0,
    isEarlyLeave: (num(row.early_leave_minutes != null ? row.early_leave_minutes : earlyLeaveMinutes) || 0) > 0,
    clockInText: timeText(clockInAt),
    clockOutText: timeText(clockOutAt),
    note: row.note || "",
    adminNote: row.admin_note || row.adminNote || "",
  };
}

function aggregateTodaySessions(config, sessions = [], workDate = todayKey()) {
  const daySessions = (sessions || []).filter((s) => String(s.work_date || s.workDate || "") === workDate);
  const views = daySessions.map((s) => viewSession(s, config));
  const open = views.find((v) => v.status === "open" || (!v.clockOutAt && v.clockInAt));
  const closed = views.filter((v) => v.clockOutAt);
  const finishedMinutes = closed.reduce((sum, v) => sum + num(v.durationMinutes), 0);
  const liveMinutes = open ? durationMinutes(open.clockInAt, null) : 0;
  const overtimeMinutes = views
    .filter((v) => v.sessionType === "overtime" || v.sessionType === "night")
    .reduce((sum, v) => sum + (v.clockOutAt ? num(v.durationMinutes) : durationMinutes(v.clockInAt, null)), 0);
  const totalMinutes = finishedMinutes + liveMinutes;
  const latestClosed = closed[0] || null;
  const first = views.slice().sort((a, b) => String(a.clockInAt).localeCompare(String(b.clockInAt)))[0] || null;
  return {
    reportDate: workDate,
    kind: "attendance",
    sessions: views,
    openSession: open || null,
    sessionCount: views.length,
    closedCount: closed.length,
    clockInAt: open?.clockInAt || latestClosed?.clockInAt || first?.clockInAt || "",
    clockOutAt: open ? "" : latestClosed?.clockOutAt || "",
    clockInText: open?.clockInText || latestClosed?.clockInText || first?.clockInText || "",
    clockOutText: open ? "上班中" : latestClosed?.clockOutText || "",
    attendanceStatus: open
      ? open.sessionType === "overtime" || open.sessionType === "night"
        ? "加班中"
        : "上班中"
      : closed.length
        ? "班次已结束，可再次上班"
        : "未打卡",
    dutyStatus: open ? "on_duty" : closed.length ? "off_duty" : "none",
    workHours: Math.round((totalMinutes / 60) * 100) / 100,
    overtimeHours: Math.round((overtimeMinutes / 60) * 100) / 100,
    durationMinutes: Math.round(totalMinutes * 100) / 100,
    lateMinutes: views.reduce((sum, v) => sum + num(v.lateMinutes), 0),
    earlyLeaveMinutes: views.reduce((sum, v) => sum + num(v.earlyLeaveMinutes), 0),
    isLate: views.some((v) => v.isLate),
    isEarlyLeave: views.some((v) => v.isEarlyLeave),
    isAbsent: !views.length && String(workDate) < todayKey(),
    // 核心：下班后仍可再次上班
    canClockIn: !open,
    canClockOut: !!open,
    clockedIn: !!open,
    clockedOut: !open && closed.length > 0,
    finishedWorkHours: Math.round((finishedMinutes / 60) * 100) / 100,
    sessionType: open?.sessionType || latestClosed?.sessionType || "normal",
    sessionTypeLabel: open?.sessionTypeLabel || latestClosed?.sessionTypeLabel || "",
  };
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
/** @deprecated day-row meta — prefer aggregateTodaySessions for multi-shift */
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
    attendanceStatus = "班次已结束，可再次上班";
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
    canClockIn: !clockInAt || !!clockOutAt,
    canClockOut: !!(clockInAt && !clockOutAt),
    clockedIn: !!(clockInAt && !clockOutAt),
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
      overtimeAllowance: 0,
      nightShiftAllowance: 0,
      nightShiftStart: "22:00",
    },
    extra || {}
  );
}

/** Sync legacy daily report row for wage/history (optional, non-blocking). */
async function syncLegacyDayReport(serviceId, workDate, agg) {
  try {
    const existing = await attendanceRow(serviceId, workDate);
    const open = agg.openSession;
    const first = (agg.sessions || []).slice().sort((a, b) => String(a.clockInAt).localeCompare(String(b.clockInAt)))[0];
    const lastClosed = (agg.sessions || []).filter((s) => s.clockOutAt).sort((a, b) => String(b.clockOutAt).localeCompare(String(a.clockOutAt)))[0];
    const payload = {
      customer_service_id: serviceId,
      report_date: workDate,
      shift_start: open?.clockInAt || first?.clockInAt || null,
      shift_end: open ? null : lastClosed?.clockOutAt || null,
      salary_amount: num(agg.workHours),
      note: stringifyMeta({
        kind: "attendance",
        multiSession: true,
        sessionCount: agg.sessionCount,
        overtimeHours: agg.overtimeHours,
        clockInAt: open?.clockInAt || first?.clockInAt || "",
        clockOutAt: open ? "" : lastClosed?.clockOutAt || "",
        workHours: agg.workHours,
        dutyStatus: agg.dutyStatus,
        workDate,
      }),
      status: existing?.status || "pending",
      admin_note: "attendance_sessions",
      created_at: existing?.created_at || nowIso(),
    };
    if (existing?.id) {
      await supabaseJson(restUrl("customer_service_reports", `?id=eq.${encodeURIComponent(existing.id)}`), {
        method: "PATCH",
        headers: serviceHeaders(),
        body: JSON.stringify(payload),
      });
    } else if (payload.shift_start) {
      await supabaseJson(restUrl("customer_service_reports", "?on_conflict=customer_service_id,report_date"), {
        method: "POST",
        headers: serviceHeaders({ Prefer: "resolution=merge-duplicates,return=representation" }),
        body: JSON.stringify(payload),
      });
    }
  } catch (err) {
    console.warn("[cs-attendance] legacy day sync failed", err?.message || err);
  }
}

/** Fast path multi-shift: each clock-in creates a new session row. */
export async function clockInService(serviceId, opts = {}) {
  if (!hasDb()) throw Object.assign(new Error("未配置数据库，无法打卡。"), { status: 503 });
  const t0 = Date.now();
  const workDate = todayKey();
  const config = defaultClockConfig(opts.config);
  const open = await openSessionForService(serviceId);
  if (open?.id) {
    const sessions = await listSessionsForService(serviceId, { workDate });
    return {
      row: open,
      meta: aggregateTodaySessions(config, sessions, workDate),
      already: true,
      elapsedMs: Date.now() - t0,
    };
  }
  const todaySessions = await listSessionsForService(serviceId, { workDate });
  const priorClosed = todaySessions.filter((s) => s.clock_out_at || s.status === "closed").length;
  const started = nowIso();
  const sessionType =
    String(opts.sessionType || opts.session_type || "").trim() ||
    inferSessionType(config, workDate, priorClosed, started);
  const shiftStart = `${workDate}T${config.shiftStart || "09:00"}:00+08:00`;
  const lateMinutes =
    sessionType === "normal"
      ? Math.max(0, Math.round((Date.parse(started) - Date.parse(shiftStart)) / 60000) - num(config.graceMinutes || 0))
      : 0;
  const payload = {
    service_id: serviceId,
    work_date: workDate,
    clock_in_at: started,
    clock_out_at: null,
    session_type: sessionType,
    duration_minutes: 0,
    status: "open",
    late_minutes: lateMinutes,
    early_leave_minutes: 0,
    note: "",
    admin_note: "",
    created_at: started,
    updated_at: started,
  };
  let saved = null;
  try {
    const rows = await supabaseJson(restUrl("cs_attendance_sessions"), {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify(payload),
    });
    saved = rows?.[0] || null;
  } catch (err) {
    // Table missing → fall back to legacy single-day row
    if (/cs_attendance_sessions|PGRST|schema cache|does not exist/i.test(String(err?.message || ""))) {
      return clockInServiceLegacy(serviceId, opts);
    }
    throw Object.assign(new Error(err?.message || "上班打卡写入失败，请重试。"), { status: 500 });
  }
  if (!saved?.id) throw Object.assign(new Error("上班打卡写入失败，请重试。"), { status: 500 });
  const sessions = await listSessionsForService(serviceId, { workDate });
  const meta = aggregateTodaySessions(config, sessions, workDate);
  await syncLegacyDayReport(serviceId, workDate, meta);
  return { row: saved, meta, already: false, elapsedMs: Date.now() - t0 };
}

async function clockInServiceLegacy(serviceId, opts = {}) {
  const t0 = Date.now();
  const workDate = todayKey();
  const config = defaultClockConfig(opts.config);
  const existing = await attendanceRow(serviceId, workDate);
  // Legacy: if already clocked out, allow re-open by clearing end (multi-shift polyfill on same row is lossy —
  // still better to show canClockIn). Prefer sessions table.
  if (existing?.shift_start && !existing?.shift_end) {
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
    shift_end: null,
    orders_handled: num(existing?.orders_handled || 0),
    salary_amount: 0,
    note: stringifyMeta({
      kind: "attendance",
      clockInAt: started,
      dutyStatus: "on_duty",
      workDate,
      sessionType: existing?.shift_end ? "overtime" : "normal",
    }),
    status: existing?.status || "pending",
    admin_note: "attendance",
    created_at: existing?.created_at || started,
  };
  let saved;
  if (existing?.id) {
    const rows = await supabaseJson(restUrl("customer_service_reports", `?id=eq.${encodeURIComponent(existing.id)}`), {
      method: "PATCH",
      headers: serviceHeaders(),
      body: JSON.stringify(payload),
    });
    saved = rows?.[0] || { ...existing, ...payload, id: existing.id };
  } else {
    const rows = await supabaseJson(restUrl("customer_service_reports", "?on_conflict=customer_service_id,report_date"), {
      method: "POST",
      headers: serviceHeaders({ Prefer: "resolution=merge-duplicates,return=representation" }),
      body: JSON.stringify(payload),
    });
    saved = rows?.[0] || null;
  }
  const meta = calcAttendanceMeta(config, saved, workDate);
  meta.canClockIn = false;
  meta.canClockOut = true;
  meta.attendanceStatus = meta.sessionType === "overtime" ? "加班中" : "上班中";
  return { row: saved, meta, already: false, elapsedMs: Date.now() - t0 };
}

export async function clockOutService(serviceId, opts = {}) {
  if (!hasDb()) throw Object.assign(new Error("未配置数据库，无法打卡。"), { status: 503 });
  const t0 = Date.now();
  const workDate = todayKey();
  const config = defaultClockConfig(opts.config);
  const open = await openSessionForService(serviceId);
  if (!open) {
    // Fallback legacy
    const existing = await attendanceRow(serviceId, workDate);
    if (!existing?.shift_start) throw Object.assign(new Error("请先上班打卡。"), { status: 400 });
    if (existing?.shift_end) {
      const meta = calcAttendanceMeta(config, existing, workDate);
      meta.canClockIn = true;
      meta.canClockOut = false;
      meta.attendanceStatus = "班次已结束，可再次上班";
      return { row: existing, meta, already: true, elapsedMs: Date.now() - t0 };
    }
    return clockOutServiceLegacy(serviceId, opts);
  }
  const ended = nowIso();
  const mins = durationMinutes(open.clock_in_at, ended);
  const shiftEnd = `${String(open.work_date || workDate)}T${config.shiftEnd || "18:00"}:00+08:00`;
  const earlyLeaveMinutes =
    open.session_type === "normal"
      ? Math.max(0, Math.round((Date.parse(shiftEnd) - Date.parse(ended)) / 60000))
      : 0;
  const payload = {
    clock_out_at: ended,
    duration_minutes: mins,
    status: "closed",
    early_leave_minutes: earlyLeaveMinutes,
    updated_at: ended,
  };
  let saved;
  try {
    const rows = await supabaseJson(restUrl("cs_attendance_sessions", `?id=eq.${encodeURIComponent(open.id)}`), {
      method: "PATCH",
      headers: serviceHeaders(),
      body: JSON.stringify(payload),
    });
    saved = rows?.[0] || { ...open, ...payload };
  } catch (err) {
    if (/cs_attendance_sessions|PGRST|schema cache|does not exist/i.test(String(err?.message || ""))) {
      return clockOutServiceLegacy(serviceId, opts);
    }
    throw Object.assign(new Error(err?.message || "下班打卡写入失败，请重试。"), { status: 500 });
  }
  const sessions = await listSessionsForService(serviceId, { workDate: String(open.work_date || workDate) });
  const meta = aggregateTodaySessions(config, sessions, String(open.work_date || workDate));
  await syncLegacyDayReport(serviceId, String(open.work_date || workDate), meta);
  return { row: saved, meta, already: false, elapsedMs: Date.now() - t0 };
}

async function clockOutServiceLegacy(serviceId, opts = {}) {
  const t0 = Date.now();
  const workDate = todayKey();
  const config = defaultClockConfig(opts.config);
  const existing = await attendanceRow(serviceId, workDate);
  if (!existing?.shift_start) throw Object.assign(new Error("请先上班打卡。"), { status: 400 });
  if (existing?.shift_end) {
    const meta = calcAttendanceMeta(config, existing, workDate);
    meta.canClockIn = true;
    meta.canClockOut = false;
    return { row: existing, meta, already: true, elapsedMs: Date.now() - t0 };
  }
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
  const saved = rows?.[0] || { ...existing, ...payload };
  const meta = calcAttendanceMeta(config, saved, workDate);
  meta.canClockIn = true;
  meta.canClockOut = false;
  meta.attendanceStatus = "班次已结束，可再次上班";
  return { row: saved, meta, already: false, elapsedMs: Date.now() - t0 };
}
/** Admin / wage: flatten attendance history — prefer multi-session rows. */
export async function listAttendanceHistory(opts = {}) {
  const month = String(opts.month || monthKey());
  const serviceId = String(opts.serviceId || "").trim();
  const [profiles, sessions, reports] = await Promise.all([
    maybeRows("profiles", "?role=eq.customer_service&limit=500"),
    (async () => {
      try {
        let q = `?work_date=gte.${month}-01&work_date=lte.${month}-31&order=clock_in_at.desc&limit=2000`;
        if (serviceId) q = `?service_id=eq.${encodeURIComponent(serviceId)}&work_date=gte.${month}-01&work_date=lte.${month}-31&order=clock_in_at.desc&limit=500`;
        return await maybeRows("cs_attendance_sessions", q);
      } catch {
        return [];
      }
    })(),
    (async () => {
      const query = serviceId
        ? `?customer_service_id=eq.${encodeURIComponent(serviceId)}&report_date=gte.${month}-01&report_date=lte.${month}-31&order=report_date.desc&limit=500`
        : `?report_date=gte.${month}-01&report_date=lte.${month}-31&order=report_date.desc&limit=2000`;
      return maybeRows("customer_service_reports", query);
    })(),
  ]);
  const nameById = (profiles || []).reduce((m, p) => {
    m[p.id] = p.display_name || p.email || p.id;
    return m;
  }, {});
  const configCache = {};
  async function cfgFor(sid) {
    if (!configCache[sid]) configCache[sid] = await getServiceConfig(sid);
    return configCache[sid];
  }
  const rows = [];
  if (Array.isArray(sessions) && sessions.length) {
    for (const s of sessions) {
      const config = await cfgFor(s.service_id);
      const v = viewSession(s, config);
      rows.push({
        id: s.id,
        serviceId: s.service_id,
        serviceName: nameById[s.service_id] || s.service_id,
        date: v.workDate,
        sessionType: v.sessionType,
        sessionTypeLabel: v.sessionTypeLabel,
        clockInAt: v.clockInAt,
        clockOutAt: v.clockOutAt,
        clockInText: v.clockInText || "-",
        clockOutText: v.clockOutText || "-",
        workHours: v.workHours,
        durationMinutes: v.durationMinutes,
        attendanceStatus: v.attendanceStatus,
        isLate: v.isLate,
        isAbsent: false,
        isEarlyLeave: v.isEarlyLeave,
        fullAttendance: !v.isLate && !v.isEarlyLeave && !!v.clockOutAt && v.sessionType === "normal",
        lateMinutes: v.lateMinutes,
        earlyLeaveMinutes: v.earlyLeaveMinutes,
        multiSession: true,
      });
    }
    return rows;
  }
  for (const row of reports || []) {
    if (row.report_date === CONFIG_DATE) continue;
    const metaKind = parseMeta(row.note).kind;
    if (metaKind === "config") continue;
    const config = await cfgFor(row.customer_service_id);
    const meta = calcAttendanceMeta(config, row, row.report_date);
    rows.push({
      id: row.id,
      serviceId: row.customer_service_id,
      serviceName: nameById[row.customer_service_id] || row.customer_service_id,
      date: row.report_date,
      sessionType: "normal",
      sessionTypeLabel: "正常班",
      clockInAt: meta.clockInAt,
      clockOutAt: meta.clockOutAt,
      clockInText: meta.clockInText || "-",
      clockOutText: meta.clockOutText || "-",
      workHours: meta.workHours,
      attendanceStatus: meta.attendanceStatus,
      isLate: meta.isLate,
      isAbsent: meta.isAbsent,
      isEarlyLeave: meta.isEarlyLeave,
      fullAttendance: !meta.isLate && !meta.isEarlyLeave && !meta.isAbsent && !!meta.clockedIn,
      lateMinutes: meta.lateMinutes,
      multiSession: false,
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
    bonusRm: round(num(salary.bonusRewards || 0) || num(salary.attendanceBonus || 0) + num(salary.receptionBonus || 0) + num(salary.orderCommission || 0) + num(salary.nightShiftAllowance || 0)),
    deductionRm: round(num(salary.penaltyTotal || 0) || num(salary.lateDeduction || 0) + num(salary.absenceDeduction || 0) + num(salary.earlyLeaveDeduction || 0)),
    netSalaryRm: num(salary.totalSalary || 0),
    note: `自动读取 ${monthKey()} 打卡与接待统计`,
    attendance: att,
    salary,
  };
}
export async function loadServiceWorkData(serviceId) {
  const [staffConfig, globalConfig, profiles, orders, conversations, receptions, reports, monthSessions, settlements] = await Promise.all([
    getServiceConfig(serviceId),
    getGlobalCommissionConfig(),
    maybeRows("profiles", `?id=eq.${encodeURIComponent(serviceId)}&limit=1`),
    maybeRows("orders", "?order=created_at.desc&limit=1000"),
    maybeRows("conversations", "?order=updated_at.desc&limit=1000"),
    maybeRows("service_receptions", `?customer_service_id=eq.${encodeURIComponent(serviceId)}&order=started_at.desc&limit=1000`),
    maybeRows("customer_service_reports", `?customer_service_id=eq.${encodeURIComponent(serviceId)}&order=report_date.desc&limit=1000`),
    listSessionsForService(serviceId, { month: monthKey() }).catch(() => []),
    (async () => {
      try {
        const settleApi = await import("./_cs-commission-settle.js");
        return settleApi.listCommissionSettlements({ serviceId, limit: 500 });
      } catch {
        return [];
      }
    })(),
  ]);
  const config = mergeServiceConfig(globalConfig, staffConfig);
  const profile = profiles[0] || null;
  const month = monthKey();
  const today = todayKey();
  const attendanceRows = reports.filter((row) => row.report_date !== CONFIG_DATE);
  const sessions = Array.isArray(monthSessions) ? monthSessions : [];
  const todaySessions = sessions.filter((s) => String(s.work_date || "") === today);
  const attendanceMeta =
    todaySessions.length || sessions.length
      ? aggregateTodaySessions(config, todaySessions.length ? todaySessions : sessions.filter((s) => String(s.work_date) === today), today)
      : calcAttendanceMeta(config, attendanceRows.find((row) => row.report_date === today) || null, today);
  // Ensure canClockIn after clock-out even on legacy path
  if (attendanceMeta.clockOutAt && !attendanceMeta.openSession) {
    attendanceMeta.canClockIn = true;
    attendanceMeta.canClockOut = false;
    if (attendanceMeta.attendanceStatus === "已下班") attendanceMeta.attendanceStatus = "班次已结束，可再次上班";
  }
  const monthAttendance = attendanceRows.filter((row) => String(row.report_date || "").slice(0, 7) === month);
  const myOrders = orders.filter((row) => row.customer_service_id === serviceId);
  const myConversations = conversations.filter((row) => row.customer_service_id === serviceId);
  const monthReceptions = receptions.filter((row) => String(row.started_at || "").slice(0, 7) === month);
  const todayOrders = myOrders.filter((row) => String(row.created_at || "").slice(0, 10) === today);
  const todayCompleted = myOrders.filter((row) => row.status === "completed" && String(row.completed_at || row.created_at || "").slice(0, 10) === today).length;
  const todayRefunds = myOrders.filter((row) => ["refund_requested", "refunded"].includes(String(row.status || "")) && String(row.created_at || "").slice(0, 10) === today).length;
  const todayPaid = myOrders.filter((row) => String(row.status || "") === "claimed" && String(row.accepted_at || row.created_at || "").slice(0, 10) === today).length;
  const unreadMessages = 0;
  const sessionViews = sessions.map((s) => viewSession(s, config));
  const closedMonth = sessionViews.filter((v) => v.clockOutAt || v.status === "closed");
  const daysWithWork = new Set(sessionViews.map((v) => v.workDate).filter(Boolean));
  const actualDays = daysWithWork.size || monthAttendance.filter((row) => !!row.shift_start).length;
  const lateCount =
    sessionViews.filter((v) => v.isLate).length ||
    monthAttendance.filter((row) => calcAttendanceMeta(config, row, row.report_date).lateMinutes > 0).length;
  const earlyLeaveCount =
    sessionViews.filter((v) => v.isEarlyLeave).length ||
    monthAttendance.filter((row) => calcAttendanceMeta(config, row, row.report_date).earlyLeaveMinutes > 0).length;
  const absenceCount = Math.max(0, num(config.standardDays || 22) - actualDays);
  const allPerfect = actualDays >= num(config.standardDays || 22) && !lateCount && !earlyLeaveCount && !absenceCount;
  const monthOrders = myOrders.filter((row) => String(row.created_at || "").slice(0, 7) === month);
  const completedOrders = myOrders.filter((row) => row.status === "completed");
  const monthCompletedOrders = monthOrders.filter((row) => row.status === "completed");
  const settlementsByOrderId = {};
  (settlements || []).forEach((s) => {
    const oid = s.orderId || s.order_id;
    if (oid) settlementsByOrderId[oid] = s;
  });
  const receptionBonus = round(monthReceptions.length * num(config.receptionBonus || 0));
  const orderCommission = calcOrderCommission(monthOrders, config, settlementsByOrderId);
  const lateDeduction = round(lateCount * num(config.lateDeduction || 0));
  const absenceDeduction = round(absenceCount * num(config.absenceDeduction || 0));
  const earlyLeaveDeduction = round(earlyLeaveCount * num(config.earlyLeaveDeduction || 0));
  const overtimeClosed = closedMonth.filter((v) => v.sessionType === "overtime");
  const nightClosed = closedMonth.filter((v) => v.sessionType === "night");
  const overtimeHoursMonth = round(overtimeClosed.reduce((sum, v) => sum + num(v.workHours), 0));
  const nightHoursMonth = round(nightClosed.reduce((sum, v) => sum + num(v.workHours), 0));
  // Snapshot-style: overtime/night allowance from config × completed sessions (historical settlements keep own snapshot)
  const overtimeAllowanceRm = round(overtimeClosed.length * num(config.overtimeAllowance || 0));
  const nightShiftAllowanceRm = round(
    nightClosed.length > 0 ? num(config.nightShiftAllowance || 0) : num(config.nightShiftAllowance || 0) && !sessions.length ? num(config.nightShiftAllowance || 0) : nightClosed.length * num(config.nightShiftAllowance || 0)
  );
  const nightPay = nightClosed.length ? round(nightClosed.length * num(config.nightShiftAllowance || 0)) : 0;
  const bonusRewards = round(
    receptionBonus +
      (allPerfect ? num(config.attendanceBonus || 0) : 0) +
      overtimeAllowanceRm +
      nightPay
  );
  const penaltyTotal = round(lateDeduction + absenceDeduction + earlyLeaveDeduction);
  const estimatedSalary = round(num(config.baseSalary || 0) + bonusRewards + orderCommission + num(config.otherAdjustment || 0) - penaltyTotal);
  const settledOnly = (settlements || []).filter((s) => (s.status || "") === "settled");
  function settlementDay(s) {
    const raw = s.settledAt || s.settled_at || s.createdAt || s.created_at || "";
    if (!raw) return "";
    try {
      return todayKey(new Date(raw));
    } catch {
      return String(raw).slice(0, 10);
    }
  }
  const incomeToday = round(
    settledOnly.filter((s) => settlementDay(s) === today).reduce((sum, s) => sum + num(s.finalAmountRm ?? s.final_amount_rm), 0)
  );
  const incomeMonth = round(
    settledOnly.filter((s) => settlementDay(s).slice(0, 7) === month).reduce((sum, s) => sum + num(s.finalAmountRm ?? s.final_amount_rm), 0)
  );
  const incomeTotal = round(settledOnly.reduce((sum, s) => sum + num(s.finalAmountRm ?? s.final_amount_rm), 0));
  const monthWorkMinutes = sessionViews.reduce(
    (sum, v) => sum + (v.clockOutAt ? num(v.durationMinutes) : v.status === "open" ? durationMinutes(v.clockInAt, null) : 0),
    0
  );
  const salaryRecord = {
    salaryMonth: month,
    baseSalary: num(config.baseSalary || 0),
    attendanceBonus: allPerfect ? num(config.attendanceBonus || 0) : 0,
    receptionBonus,
    orderCommission,
    commissionPercent: num(config.commissionPercent || 0),
    orderFixedReward: num(config.orderCommission || 0),
    nightShiftAllowance: nightPay,
    overtimeAllowance: overtimeAllowanceRm,
    overtimeHours: overtimeHoursMonth,
    nightHours: nightHoursMonth,
    monthWorkHours: round(monthWorkMinutes / 60),
    lateDeduction,
    absenceDeduction,
    earlyLeaveDeduction,
    bonusRewards,
    penaltyTotal,
    otherAdjustment: num(config.otherAdjustment || 0),
    totalSalary: estimatedSalary,
    incomeToday,
    incomeMonth,
    incomeTotal,
    status: "统计中",
  };
  const attendanceHistoryRows = sessionViews.length
    ? sessionViews
        .slice()
        .sort((a, b) => String(b.clockInAt).localeCompare(String(a.clockInAt)))
        .map((v) => ({
          reportDate: v.workDate,
          date: v.workDate,
          ...v,
        }))
    : monthAttendance.map((row) => {
        const m = calcAttendanceMeta(config, row, row.report_date);
        return { reportDate: row.report_date, date: row.report_date, ...m };
      });
  return {
    profile,
    config,
    globalConfig,
    todayAttendance: attendanceMeta,
    summary: {
      todayReceptions: monthReceptions.filter((row) => String(row.started_at || "").slice(0, 10) === today).length,
      monthReceptions: monthReceptions.length,
      totalReceptions: receptions.length,
      currentReceptions: myConversations.length,
      completedOrders: completedOrders.length,
      monthCompletedOrders: monthCompletedOrders.length,
      todayCompleted,
      todayPaid,
      todayRefunds,
      unreadMessages,
      monthAttendanceDays: actualDays,
      monthLateCount: lateCount,
      monthAbsenceCount: absenceCount,
      monthOvertimeHours: overtimeHoursMonth,
      estimatedSalary,
      incomeToday,
      incomeMonth,
      incomeTotal,
      withdrawableSalary: estimatedSalary,
    },
    attendance: {
      standardDays: num(config.standardDays || 22),
      actualDays,
      lateCount,
      earlyLeaveCount,
      absenceCount,
      fullAttendance: allPerfect,
      fullAttendanceBonus: allPerfect ? num(config.attendanceBonus || 0) : 0,
      overtimeHours: overtimeHoursMonth,
      nightHours: nightHoursMonth,
      monthWorkHours: round(monthWorkMinutes / 60),
      rows: attendanceHistoryRows,
    },
    salary: {
      current: salaryRecord,
      history: [salaryRecord],
    },
    commissionSettlements: (settlements || []).slice(0, 80).map((s) => ({
      id: s.id,
      orderId: s.orderId || s.order_id,
      orderNo: s.orderNo || s.order_no || "",
      rewardType: s.rewardType || s.reward_type || "order_commission",
      category: s.category || "",
      categoryLabel: s.categoryLabel || "",
      paidAmount: num(s.paidAmount ?? s.orderAmount),
      paymentStatus: s.paymentStatus || "",
      fixedRewardRm: num(s.fixedRewardRm ?? s.fixed_reward_rm),
      percentCommissionRm: num(s.percentCommissionRm ?? s.percent_commission_rm),
      nightShiftRm: num(s.nightShiftRm ?? s.night_shift_rm),
      attendanceBonusRm: num(s.attendanceBonusRm ?? s.attendance_bonus_rm),
      clawbackRm: num(s.clawbackRm ?? s.clawback_rm),
      finalAmountRm: num(s.finalAmountRm ?? s.final_amount_rm),
      status: s.status,
      settlementStatus: s.settlementStatus || s.status,
      settledAt: s.settledAt || s.settled_at || "",
    })),
  };
}
