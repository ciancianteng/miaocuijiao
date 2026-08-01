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
function safeStaff(row, stats = {}) {
  return {
    id: row.id,
    account: row.email || row.id,
    name: row.display_name || row.email || "客服",
    email: row.email || "",
    phone: row.phone || "",
    status: row.status === "active" ? "启用" : "停用",
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
  };
}
async function rows() {
  const today = shanghaiToday();
  const month = shanghaiMonth();
  const [staff, orders, conversations, reports] = await Promise.all([
    supabaseJson(restUrl("profiles", "?role=eq.customer_service&order=created_at.desc&limit=500"), { headers: serviceHeaders() }),
    supabaseJson(restUrl("orders", "?order=created_at.desc&limit=1000"), { headers: serviceHeaders() }).catch(() => []),
    supabaseJson(restUrl("conversations", "?order=updated_at.desc&limit=1000"), { headers: serviceHeaders() }).catch(() => []),
    supabaseJson(restUrl("customer_service_reports", "?order=report_date.desc&limit=2000"), { headers: serviceHeaders() }).catch(() => []),
  ]);
  let workApi = null;
  try {
    workApi = await import("../_customer-service-work.js");
  } catch (_) {}
  return staff.map((row) => {
    const ownOrders = orders.filter((o) => o.customer_service_id === row.id);
    const ownReports = (reports || []).filter((r) => r.customer_service_id === row.id && r.report_date !== "1970-01-01");
    const todayRow = ownReports.find((r) => r.report_date === today) || null;
    let todayMeta = null;
    if (workApi && todayRow) {
      todayMeta = workApi.calcAttendanceMeta({ shiftStart: "09:00", shiftEnd: "18:00", graceMinutes: 10 }, todayRow, today);
    } else if (todayRow) {
      todayMeta = {
        attendanceStatus: todayRow.shift_start && !todayRow.shift_end ? "上班中" : todayRow.shift_end ? "已下班" : "未打卡",
        clockInText: todayRow.shift_start || "-",
        clockOutText: todayRow.shift_end || "-",
        workHours: todayRow.salary_amount || 0,
      };
    }
    const monthRows = ownReports
      .filter((r) => String(r.report_date || "").slice(0, 7) === month)
      .map((r) => {
        const m = workApi
          ? workApi.calcAttendanceMeta({ shiftStart: "09:00", shiftEnd: "18:00", graceMinutes: 10 }, r, r.report_date)
          : {
              clockInText: r.shift_start || "-",
              clockOutText: r.shift_end || "-",
              workHours: r.salary_amount || 0,
              isLate: false,
              isAbsent: !r.shift_start,
              attendanceStatus: r.shift_end ? "已下班" : r.shift_start ? "上班中" : "未打卡",
            };
        return {
          date: r.report_date,
          clockInText: m.clockInText || "-",
          clockOutText: m.clockOutText || "-",
          workHours: m.workHours,
          isLate: !!m.isLate,
          isAbsent: !!m.isAbsent,
          attendanceStatus: m.attendanceStatus || "-",
        };
      });
    return safeStaff(row, {
      todayClockStatus: todayMeta?.attendanceStatus || "未打卡",
      todayClockInAt: todayMeta?.clockInText || "-",
      todayClockOutAt: todayMeta?.clockOutText || "-",
      todayWorkHours: todayMeta?.workHours != null ? todayMeta.workHours : "-",
      todayOrders: ownOrders.filter((o) => String(o.created_at || "").slice(0, 10) === today).length,
      monthOrders: ownOrders.filter((o) => String(o.created_at || "").slice(0, 7) === month).length,
      afterSaleCount: ownOrders.filter((o) => o.status === "refund_requested" || o.status === "refunded").length,
      conversations: conversations.filter((c) => c.customer_service_id === row.id).length,
      lastLoginAt: todayRow?.shift_start || ownReports[0]?.created_at || "-",
      attendanceHistory: monthRows,
    });
  });
}
function clean(body = {}) { return { name: String(body.name || body.nickname || "").trim(), email: String(body.email || body.account || "").trim().toLowerCase(), password: String(body.password || ""), phone: String(body.phone || "").trim(), status: String(body.status || "启用") === "停用" ? "disabled" : "active" }; }
function validate(input, isUpdate = false) { if (!input.name) throw Object.assign(new Error("请填写客服昵称。"), { status: 400 }); if (!/^\S+@\S+\.\S+$/.test(input.email)) throw Object.assign(new Error("请填写有效登录邮箱。"), { status: 400 }); if (!isUpdate && input.password.length < 8) throw Object.assign(new Error("临时密码至少 8 位。"), { status: 400 }); if (input.password && input.password.length < 8) throw Object.assign(new Error("临时密码至少 8 位。"), { status: 400 }); }
async function findByEmail(email) { const rows = await supabaseJson(restUrl("profiles", `?email=eq.${encodeURIComponent(email)}&limit=1`), { headers: serviceHeaders() }); return rows[0] || null; }
async function create(input) { validate(input, false); const existing = await findByEmail(input.email); if (existing) throw Object.assign(new Error("该邮箱已存在。"), { status: 409 }); const user = await supabaseJson(authUrl("admin/users"), { method: "POST", headers: serviceHeaders(), body: JSON.stringify({ email: input.email, password: input.password, email_confirm: true, user_metadata: { display_name: input.name } }) }); const row = { id: user.id, role: "customer_service", display_name: input.name, email: input.email, phone: input.phone, avatar_url: "", status: input.status, created_at: new Date().toISOString() }; const profiles = await supabaseJson(restUrl("profiles"), { method: "POST", headers: serviceHeaders(), body: JSON.stringify(row) }); return safeStaff(profiles[0] || row); }
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
      const accounts = await rows();
      return json(res, 200, { ok: true, configured: true, accounts, stats: accounts });
    }
    const body = await parseBody(req);
    const action = String(body.action || "");
    const input = clean(body);
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
