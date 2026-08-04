import { csDisplayName } from "../_account-codes.js";

const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
const ADMIN_ROLES = new Set(["admin", "super_admin"]);

function json(res, status, data) { return res.status(status).json(data); }
function hasDb() { return REQUIRED_ENV.every((key) => process.env[key]); }
function restUrl(table, query = "") { return `${process.env.SUPABASE_URL}/rest/v1/${table}${query}`; }
function authUrl(path) { return `${process.env.SUPABASE_URL}/auth/v1/${path}`; }
function serviceHeaders(extra = {}) { return { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json", Prefer: "return=representation", ...extra }; }
function anonHeaders(extra = {}) { return { apikey: process.env.SUPABASE_ANON_KEY, "Content-Type": "application/json", ...extra }; }
function supabaseError(body, response) {
  const parts = [body?.error_description, body?.msg, body?.message, body?.error, body?.hint, body?.details, typeof body === "string" ? body : ""].filter(Boolean);
  const base = parts[0] || "Supabase 请求失败";
  const code = body?.code ? ` [${body.code}]` : "";
  return `${base}${code} (HTTP ${response.status})`;
}
async function supabaseJson(url, init = {}) { const response = await fetch(url, init); const text = await response.text(); let body = null; try { body = text ? JSON.parse(text) : null; } catch { body = text; } if (!response.ok) throw Object.assign(new Error(supabaseError(body, response)), { status: response.status }); return body; }
async function parseBody(req) { if (req.body && typeof req.body === "object") return req.body; const chunks = []; for await (const chunk of req) chunks.push(chunk); try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return {}; } }
function tokenFrom(req) { return String(req.headers.authorization || req.headers["x-mcj-access-token"] || "").replace(/^Bearer\s+/i, "").trim(); }
async function profileById(id) { const rows = await supabaseJson(restUrl("profiles", `?id=eq.${encodeURIComponent(id)}&limit=1`), { headers: serviceHeaders() }); return rows[0] || null; }
async function requireAdmin(req) { const token = tokenFrom(req); if (!token) throw Object.assign(new Error("请先使用管理员账号登录后台。"), { status: 401 }); const user = await supabaseJson(authUrl("user"), { headers: anonHeaders({ Authorization: `Bearer ${token}` }) }); const profile = await profileById(user.id); if (!profile || !ADMIN_ROLES.has(profile.role)) throw Object.assign(new Error("没有客服账号管理权限。"), { status: 403 }); if (profile.status !== "active") throw Object.assign(new Error("管理员账号已停用。"), { status: 403 }); return profile; }
function shanghaiToday() {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}
function shanghaiMonth() {
  return shanghaiToday().slice(0, 7);
}
function isDbUuid(v) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || "").trim());
}
function isDevLogin(v) {
  const s = String(v || "").trim().toLowerCase();
  if (!s) return false;
  if (/\.meow\.test$/i.test(s)) return true;
  if (/^(service|boss|companion|admin)\./i.test(s)) return true;
  if (isDbUuid(s)) return true;
  return false;
}
function formatCsCode(row = {}) {
  const direct = String(row.cs_code || row.staff_code || row.csCode || row.staffCode || "").trim();
  if (/^CS\d+$/i.test(direct)) return direct.toUpperCase();
  const name = String(row.display_name || row.displayName || row.name || "").trim();
  const m = name.match(/(\d{3,8})$/);
  if (m) return `CS${String(m[1]).padStart(6, "0")}`;
  return "";
}
function deriveOnlineStatus(stats = {}) {
  const clock = String(stats.todayClockStatus || "");
  const receptions = Number(stats.todayReceptions || 0) || 0;
  if (/上班|工作中|在岗/i.test(clock)) {
    if (receptions > 0) return "接待中";
    return "在线";
  }
  if (/接待/i.test(clock)) return "接待中";
  return "离线";
}
function safeStaff(row, stats = {}) {
  const rawEmail = row.email || "";
  const csCode = formatCsCode(row);
  return {
    id: row.id,
    account: rawEmail || "",
    name: csDisplayName(row),
    csCode: csCode || "未分配",
    email: isDevLogin(rawEmail) ? "" : rawEmail,
    rawEmail,
    loginEmail: isDevLogin(rawEmail) ? "" : rawEmail,
    phone: row.phone || "",
    status: row.status === "active" ? "启用" : "停用",
    onlineStatus: deriveOnlineStatus(stats),
    todayClockStatus: stats.todayClockStatus || "未打卡",
    todayClockInAt: stats.todayClockInAt || "-",
    todayClockOutAt: stats.todayClockOutAt || "-",
    todayWorkHours: stats.todayWorkHours != null ? stats.todayWorkHours : "-",
    todayOrders: stats.todayOrders || 0,
    monthOrders: stats.monthOrders || 0,
    afterSaleCount: stats.afterSaleCount || 0,
    conversations: stats.conversations || 0,
    lastLoginAt: stats.lastLoginAt || "-",
    createdAt: row.created_at || "",
    remark: "",
    attendanceHistory: stats.attendanceHistory || [],
    todayReceptions: stats.todayReceptions || 0,
    monthReceptions: stats.monthReceptions || 0,
    totalReceptions: stats.totalReceptions || 0,
    completedOrders: stats.completedOrders || 0,
    monthCompletedOrders: stats.monthCompletedOrders || 0,
    estimatedSalary: stats.estimatedSalary || 0,
    baseSalary: stats.baseSalary || 0,
    orderCommission: stats.orderCommission || 0,
    receptionBonus: stats.receptionBonus || 0,
    attendanceBonus: stats.attendanceBonus || 0,
    nightShiftAllowance: stats.nightShiftAllowance || 0,
    otherAdjustment: stats.otherAdjustment || 0,
    lateDeduction: stats.lateDeduction || 0,
    absenceDeduction: stats.absenceDeduction || 0,
    earlyLeaveDeduction: stats.earlyLeaveDeduction || 0,
    bonusRewards: stats.bonusRewards || 0,
    penaltyTotal: stats.penaltyTotal || 0,
    wageDetail: stats.wageDetail || null,
  };
}
function orderQualifiesForCommission(row, config) {
  const status = String(row?.status || "");
  if (config.settleOnOrderComplete && status === "completed") return true;
  if (config.settleOnPayment && ["claimed", "in_progress", "completed", "paid"].includes(status)) return true;
  if (!config.settleOnOrderComplete && !config.settleOnPayment) return !["cancelled", "canceled"].includes(status);
  return false;
}
function calcOrderCommissionLocal(orders, config, settlementsByOrderId = {}) {
  const qualifying = (orders || []).filter((row) => orderQualifiesForCommission(row, config));
  let flat = 0;
  let percent = 0;
  let clawback = 0;
  let fromLedger = 0;
  for (const row of qualifying) {
    const settled = settlementsByOrderId[row.id];
    if (settled && settled.status === "settled") {
      fromLedger = round(fromLedger + num(settled.finalAmountRm ?? settled.final_amount_rm));
      continue;
    }
    if (settled && (settled.status === "clawed_back" || settled.status === "cancelled")) continue;
    flat = round(flat + num(config.orderCommission || 0));
    const status = String(row?.status || "");
    if (!(config.clawbackOnRefund && ["refunded", "refund_requested"].includes(status))) {
      const amount = num(row?.amount ?? row?.total_amount ?? row?.total ?? row?.price ?? 0);
      percent = round(percent + (amount * num(config.commissionPercent || 0)) / 100);
    }
  }
  if (config.clawbackOnRefund) {
    clawback = round(
      (orders || [])
        .filter((row) => {
          if (!["refunded", "refund_requested"].includes(String(row?.status || ""))) return false;
          const settled = settlementsByOrderId[row.id];
          if (settled && (settled.status === "clawed_back" || settled.status === "cancelled" || settled.status === "settled")) return false;
          return true;
        })
        .reduce((sum, row) => {
          const amount = num(row?.amount ?? row?.total_amount ?? row?.total ?? row?.price ?? 0);
          return sum + num(config.orderCommission || 0) + (amount * num(config.commissionPercent || 0)) / 100;
        }, 0)
    );
  }
  return Math.max(0, round(fromLedger + flat + percent - clawback));
}
async function rows() {
  const today = shanghaiToday();
  const month = shanghaiMonth();
  const [staff, orders, conversations, reports, receptions] = await Promise.all([
    supabaseJson(restUrl("profiles", "?role=eq.customer_service&order=created_at.desc&limit=500"), { headers: serviceHeaders() }),
    supabaseJson(restUrl("orders", "?order=created_at.desc&limit=1000"), { headers: serviceHeaders() }).catch(() => []),
    supabaseJson(restUrl("conversations", "?order=updated_at.desc&limit=1000"), { headers: serviceHeaders() }).catch(() => []),
    supabaseJson(restUrl("customer_service_reports", "?order=report_date.desc&limit=2000"), { headers: serviceHeaders() }).catch(() => []),
    supabaseJson(restUrl("service_receptions", "?order=started_at.desc&limit=2000"), { headers: serviceHeaders() }).catch(() => []),
  ]);
  let workApi = null;
  let globalConfig = { shiftStart: "09:00", shiftEnd: "18:00", graceMinutes: 10, standardDays: 22 };
  let settlementsAll = [];
  try {
    workApi = await import("../_customer-service-work.js");
    globalConfig = await workApi.getGlobalCommissionConfig();
  } catch (_) {}
  try {
    const settleApi = await import("../_cs-commission-settle.js");
    settlementsAll = await settleApi.listCommissionSettlements({ limit: 500 });
  } catch (_) {
    settlementsAll = [];
  }
  // Single global config + already-fetched rows — no N× loadServiceWorkData (was hanging create/list).
  const staffConfig = workApi ? workApi.mergeServiceConfig(globalConfig, {}) : globalConfig;
  return staff.map((row) => {
    const ownOrders = orders.filter((o) => o.customer_service_id === row.id);
    const ownReceptions = (receptions || []).filter((r) => r.customer_service_id === row.id);
    const ownReports = (reports || []).filter((r) => r.customer_service_id === row.id && r.report_date !== "1970-01-01");
    const settlementsByOrderId = {};
    (settlementsAll || [])
      .filter((s) => String(s.serviceId || s.service_id || "") === String(row.id))
      .forEach((s) => {
        const oid = s.orderId || s.order_id;
        if (oid) settlementsByOrderId[oid] = s;
      });
    const todayRow = ownReports.find((r) => r.report_date === today) || null;
    let todayMeta = null;
    if (workApi && todayRow) {
      todayMeta = workApi.calcAttendanceMeta(staffConfig, todayRow, today);
    } else if (todayRow) {
      todayMeta = {
        attendanceStatus: todayRow.shift_start && !todayRow.shift_end ? "上班中" : todayRow.shift_end ? "已下班" : "未打卡",
        clockInText: todayRow.shift_start || "-",
        clockOutText: todayRow.shift_end || "-",
        workHours: todayRow.salary_amount || 0,
      };
    }
    const monthAttendance = ownReports.filter((r) => String(r.report_date || "").slice(0, 7) === month);
    const monthRows = monthAttendance.map((r) => {
      const m = workApi
        ? workApi.calcAttendanceMeta(staffConfig, r, r.report_date)
        : {
            clockInText: r.shift_start || "-",
            clockOutText: r.shift_end || "-",
            workHours: r.salary_amount || 0,
            isLate: false,
            isEarlyLeave: false,
            isAbsent: !r.shift_start,
            clockedIn: !!r.shift_start,
            attendanceStatus: r.shift_end ? "已下班" : r.shift_start ? "上班中" : "未打卡",
          };
      return {
        date: r.report_date,
        clockInAt: m.clockInAt || r.shift_start || "",
        clockOutAt: m.clockOutAt || r.shift_end || "",
        clockInText: m.clockInText || "-",
        clockOutText: m.clockOutText || "-",
        workHours: m.workHours,
        isLate: !!m.isLate,
        isEarlyLeave: !!m.isEarlyLeave,
        isAbsent: !!m.isAbsent,
        fullAttendance: !m.isLate && !m.isEarlyLeave && !m.isAbsent && !!m.clockedIn,
        attendanceStatus: m.attendanceStatus || "-",
      };
    });
    const actualDays = monthAttendance.filter((r) => !!r.shift_start).length;
    const lateCount = monthRows.filter((r) => r.isLate).length;
    const earlyLeaveCount = monthRows.filter((r) => r.isEarlyLeave).length;
    const absenceCount = Math.max(0, num(staffConfig.standardDays || 22) - actualDays);
    const allPerfect = actualDays >= num(staffConfig.standardDays || 22) && !lateCount && !earlyLeaveCount && !absenceCount;
    const monthOrders = ownOrders.filter((o) => String(o.created_at || "").slice(0, 7) === month);
    const monthReceptions = ownReceptions.filter((r) => String(r.started_at || "").slice(0, 7) === month);
    const receptionBonus = round(monthReceptions.length * num(staffConfig.receptionBonus || 0));
    const orderCommission = calcOrderCommissionLocal(monthOrders, staffConfig, settlementsByOrderId);
    const attendanceBonus = allPerfect ? num(staffConfig.attendanceBonus || 0) : 0;
    const nightShiftAllowance = num(staffConfig.nightShiftAllowance || 0);
    const otherAdjustment = num(staffConfig.otherAdjustment || 0);
    const lateDeduction = round(lateCount * num(staffConfig.lateDeduction || 0));
    const absenceDeduction = round(absenceCount * num(staffConfig.absenceDeduction || 0));
    const earlyLeaveDeduction = round(earlyLeaveCount * num(staffConfig.earlyLeaveDeduction || 0));
    const bonusRewards = round(receptionBonus + attendanceBonus + nightShiftAllowance);
    const penaltyTotal = round(lateDeduction + absenceDeduction + earlyLeaveDeduction);
    const estimatedSalary = round(num(staffConfig.baseSalary || 0) + bonusRewards + orderCommission + otherAdjustment - penaltyTotal);
    return safeStaff(row, {
      todayClockStatus: todayMeta?.attendanceStatus || "未打卡",
      todayClockInAt: todayMeta?.clockInText || "-",
      todayClockOutAt: todayMeta?.clockOutText || "-",
      todayWorkHours: todayMeta?.workHours != null ? todayMeta.workHours : "-",
      todayOrders: ownOrders.filter((o) => String(o.created_at || "").slice(0, 10) === today).length,
      monthOrders: monthOrders.length,
      afterSaleCount: ownOrders.filter((o) => o.status === "refund_requested" || o.status === "refunded").length,
      conversations: conversations.filter((c) => c.customer_service_id === row.id).length,
      lastLoginAt: todayRow?.shift_start || ownReports[0]?.created_at || "-",
      attendanceHistory: monthRows,
      todayReceptions: ownReceptions.filter((r) => String(r.started_at || "").slice(0, 10) === today).length,
      monthReceptions: monthReceptions.length,
      totalReceptions: ownReceptions.length,
      completedOrders: ownOrders.filter((o) => o.status === "completed").length,
      monthCompletedOrders: monthOrders.filter((o) => o.status === "completed").length,
      estimatedSalary,
      baseSalary: num(staffConfig.baseSalary || 0),
      orderCommission,
      receptionBonus,
      attendanceBonus,
      nightShiftAllowance,
      otherAdjustment,
      lateDeduction,
      absenceDeduction,
      earlyLeaveDeduction,
      bonusRewards,
      penaltyTotal,
      wageDetail: {
        baseSalary: num(staffConfig.baseSalary || 0),
        receptionBonus,
        orderCommission,
        nightShiftAllowance,
        attendanceBonus,
        lateDeduction,
        absenceDeduction,
        earlyLeaveDeduction,
        otherAdjustment,
        totalSalary: estimatedSalary,
        formula: `底薪${num(staffConfig.baseSalary || 0)}+接待${receptionBonus}+提成${orderCommission}+夜班${nightShiftAllowance}+全勤${attendanceBonus}+其他${otherAdjustment}-扣款${penaltyTotal}=${estimatedSalary}`,
      },
    });
  });
}
function num(v) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}
function round(v) {
  return Math.round(num(v) * 100) / 100;
}
function clean(body = {}) { return { name: String(body.name || body.nickname || "").trim(), email: String(body.email || body.account || "").trim().toLowerCase(), password: String(body.password || ""), phone: String(body.phone || "").trim(), status: String(body.status || "启用") === "停用" ? "disabled" : "active" }; }
function validate(input, isUpdate = false) { if (!input.name) throw Object.assign(new Error("请填写客服昵称。"), { status: 400 }); if (!/^\S+@\S+\.\S+$/.test(input.email)) throw Object.assign(new Error("请填写有效登录邮箱。"), { status: 400 }); if (!isUpdate && input.password.length < 8) throw Object.assign(new Error("临时密码至少 8 位。"), { status: 400 }); if (input.password && input.password.length < 8) throw Object.assign(new Error("临时密码至少 8 位。"), { status: 400 }); }
function isDuplicateEmailError(err) {
  const msg = String(err?.message || err || "");
  return /already|exist|registered|duplicate|email_exists|user already|该邮箱已存在/i.test(msg);
}
async function findByEmail(email) { const rows = await supabaseJson(restUrl("profiles", `?email=eq.${encodeURIComponent(email)}&limit=1`), { headers: serviceHeaders() }); return rows[0] || null; }
async function findAuthUserByEmail(email) {
  const target = String(email || "").trim().toLowerCase();
  if (!target) return null;
  try {
    const body = await supabaseJson(authUrl(`admin/users?email=${encodeURIComponent(target)}`), { headers: serviceHeaders() });
    if (Array.isArray(body?.users) && body.users.length) {
      // Never fall back to users[0] — Supabase may return an unfiltered page.
      return body.users.find((u) => String(u.email || "").toLowerCase() === target) || null;
    }
    if (body?.id && String(body.email || "").toLowerCase() === target) return body;
  } catch (_) {}
  try {
    const body = await supabaseJson(authUrl("admin/users?page=1&per_page=200"), { headers: serviceHeaders() });
    const users = Array.isArray(body?.users) ? body.users : [];
    return users.find((u) => String(u.email || "").toLowerCase() === target) || null;
  } catch (_) {
    return null;
  }
}
async function create(input) {
  validate(input, false);
  const existing = await findByEmail(input.email);
  if (existing) throw Object.assign(new Error("该邮箱已存在，请更换邮箱。"), { status: 409 });
  const authExisting = await findAuthUserByEmail(input.email);
  if (authExisting) throw Object.assign(new Error("该邮箱已存在，请更换邮箱。"), { status: 409 });
  let user;
  try {
    user = await supabaseJson(authUrl("admin/users"), {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify({
        email: input.email,
        password: input.password,
        email_confirm: true,
        user_metadata: { display_name: input.name, role: "customer_service" },
        app_metadata: { role: "customer_service" },
      }),
    });
  } catch (err) {
    if (isDuplicateEmailError(err)) throw Object.assign(new Error("该邮箱已存在，请更换邮箱。"), { status: 409 });
    throw Object.assign(new Error(err.message || "创建客服 Auth 账号失败。"), { status: err.status || 500 });
  }
  if (!user?.id) throw Object.assign(new Error("创建客服 Auth 账号失败：未返回用户 ID。"), { status: 500 });
  const row = {
    id: user.id,
    role: "customer_service",
    display_name: input.name,
    email: input.email,
    phone: input.phone,
    avatar_url: "",
    status: input.status,
    created_at: new Date().toISOString(),
  };
  try {
    const profiles = await supabaseJson(restUrl("profiles"), {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify(row),
    });
    return safeStaff(profiles[0] || row);
  } catch (err) {
    if (isDuplicateEmailError(err) || /duplicate|unique|already/i.test(String(err.message || ""))) {
      throw Object.assign(new Error("该邮箱已存在，请更换邮箱。"), { status: 409 });
    }
    throw Object.assign(new Error(err.message || "写入客服资料失败。"), { status: err.status || 500 });
  }
}
async function update(id, input) { validate(input, true); const patch = { display_name: input.name, email: input.email, phone: input.phone, status: input.status }; await supabaseJson(authUrl(`admin/users/${encodeURIComponent(id)}`), { method: "PUT", headers: serviceHeaders(), body: JSON.stringify({ email: input.email, user_metadata: { display_name: input.name }, ...(input.password ? { password: input.password } : {}) }) }); const rows = await supabaseJson(restUrl("profiles", `?id=eq.${encodeURIComponent(id)}`), { method: "PATCH", headers: serviceHeaders(), body: JSON.stringify(patch) }); return safeStaff(rows[0] || { id, ...patch }); }
async function resetPassword(id, password) { if (!password || password.length < 8) throw Object.assign(new Error("新密码至少 8 位。"), { status: 400 }); await supabaseJson(authUrl(`admin/users/${encodeURIComponent(id)}`), { method: "PUT", headers: serviceHeaders(), body: JSON.stringify({ password }) }); }
async function toggle(id, status) { const next = String(status) === "停用" || String(status) === "disabled" ? "disabled" : "active"; await supabaseJson(restUrl("profiles", `?id=eq.${encodeURIComponent(id)}`), { method: "PATCH", headers: serviceHeaders(), body: JSON.stringify({ status: next }) }); }
async function remove(id) { await supabaseJson(authUrl(`admin/users/${encodeURIComponent(id)}`), { method: "DELETE", headers: serviceHeaders() }); }
export default async function handler(req, res) {
  if (!hasDb()) {
    return json(res, req.method === "GET" ? 200 : 503, {
      ok: req.method === "GET",
      configured: false,
      accounts: [],
      stats: [],
      message: "未配置 Supabase，后台不能创建真实客服账号。",
    });
  }
  try {
    await requireAdmin(req);
    if (req.method === "GET") {
      const action = String(req.query.action || "list");
      if (action === "attendance_history") {
        const workApi = await import("../_customer-service-work.js");
        const history = await workApi.listAttendanceHistory({
          month: String(req.query.month || "").trim(),
          serviceId: String(req.query.serviceId || req.query.service_id || "").trim(),
        });
        return json(res, 200, { ok: true, configured: true, history });
      }
      if (action === "commission_config") {
        const workApi = await import("../_customer-service-work.js");
        const config = await workApi.getGlobalCommissionConfig();
        return json(res, 200, { ok: true, configured: true, config });
      }
      const accounts = await rows();
      return json(res, 200, { ok: true, configured: true, accounts, stats: accounts });
    }
    const body = await parseBody(req);
    const action = String(body.action || "");
    const input = clean(body);
    if (action === "save_commission_config") {
      const workApi = await import("../_customer-service-work.js");
      const payload = body.payload || body.config || body;
      await workApi.saveGlobalCommissionConfig({
        baseSalary: payload.baseSalary,
        attendanceBonus: payload.attendanceBonus,
        receptionBonus: payload.receptionBonus,
        orderCommission: payload.orderCommission,
        commissionPercent: payload.commissionPercent,
        nightShiftAllowance: payload.nightShiftAllowance,
        otherAdjustment: payload.otherAdjustment,
        settleOnOrderComplete: payload.settleOnOrderComplete,
        settleOnPayment: payload.settleOnPayment,
        clawbackOnRefund: payload.clawbackOnRefund,
        lateDeduction: payload.lateDeduction,
        absenceDeduction: payload.absenceDeduction,
        earlyLeaveDeduction: payload.earlyLeaveDeduction,
        standardDays: payload.standardDays,
        graceMinutes: payload.graceMinutes,
      });
      const config = await workApi.getGlobalCommissionConfig();
      return json(res, 200, { ok: true, message: "客服佣金设置已保存", config });
    }
    if (action === "create") {
      return json(res, 200, {
        ok: true,
        message: "客服账号已创建，请把登录邮箱和临时密码交给客服。",
        account: await create(input),
        temporaryPassword: input.password,
      });
    }
    if (action === "update") return json(res, 200, { ok: true, message: "客服账号已更新。", account: await update(String(body.id || ""), input) });
    if (action === "reset_password") {
      await resetPassword(String(body.id || ""), String(body.password || ""));
      return json(res, 200, { ok: true, message: "客服临时密码已重置，请交给客服本人。" });
    }
    if (action === "toggle") {
      await toggle(String(body.id || ""), body.status);
      return json(res, 200, { ok: true, message: "客服账号状态已更新。" });
    }
    if (action === "delete") {
      await remove(String(body.id || ""));
      return json(res, 200, { ok: true, message: "客服账号已删除。" });
    }
    return json(res, 400, { ok: false, message: "未知客服账号操作。" });
  } catch (error) {
    return json(res, error.status || 500, { ok: false, message: error.message || "客服账号接口异常。" });
  }
}
