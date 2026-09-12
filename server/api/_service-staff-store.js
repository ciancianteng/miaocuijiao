import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const LOCAL_DIR = path.join(process.cwd(), ".local-data");
const LOCAL_FILE = path.join(LOCAL_DIR, "customer-service-staff.json");

export function hashPassword(password) {
  return crypto.createHash("sha256").update(String(password || "")).digest("hex");
}

export function normalizeStaffStatus(status) {
  const value = String(status || "启用").trim();
  if (["ENABLED", "enable", "enabled", "active", "启用", "正常"].includes(value)) return "启用";
  if (["DISABLED", "disable", "disabled", "停用", "冻结"].includes(value)) return "停用";
  return value || "启用";
}

export function safeStaff(row = {}) {
  return {
    id: row.id || row.account || row.uid || "",
    uid: row.uid || row.id || row.account || "",
    account: row.account || row.id || row.uid || "",
    name: row.name || row.nickname || "客服",
    nickname: row.nickname || row.name || "客服",
    role: row.role || "customer_service",
    email: row.email || "",
    phone: row.phone || "",
    status: normalizeStaffStatus(row.status),
    onlineStatus: row.online_status || row.onlineStatus || "离线",
    clockedIn: Boolean(row.clocked_in || row.clockedIn),
    lastLoginAt: row.last_login_at || row.lastLoginAt || "",
    createdAt: row.created_at || row.createdAt || "",
    updatedAt: row.updated_at || row.updatedAt || "",
    todayClockStatus: row.todayClockStatus || "未打卡",
    todayOrders: Number(row.todayOrders || 0),
    monthOrders: Number(row.monthOrders || 0),
    afterSaleCount: Number(row.afterSaleCount || 0),
    todayClockInAt: row.todayClockInAt || "",
    todayClockOutAt: row.todayClockOutAt || "",
    passwordConfigured: Boolean(row.password_hash || row.passwordHash),
  };
}

export async function readLocalStore() {
  try {
    await fs.mkdir(LOCAL_DIR, { recursive: true });
    const raw = await fs.readFile(LOCAL_FILE, "utf8");
    const data = JSON.parse(raw || "{}");
    return {
      staff: Array.isArray(data.staff) ? data.staff : [],
      attendance: Array.isArray(data.attendance) ? data.attendance : [],
      orderRecords: Array.isArray(data.orderRecords) ? data.orderRecords : [],
      quickReplies: Array.isArray(data.quickReplies) ? data.quickReplies : [],
    };
  } catch (error) {
    if (error && error.code === "ENOENT") return { staff: [], attendance: [], orderRecords: [], quickReplies: [] };
    throw error;
  }
}

export async function writeLocalStore(data) {
  await fs.mkdir(LOCAL_DIR, { recursive: true });
  await fs.writeFile(LOCAL_FILE, JSON.stringify(data, null, 2), "utf8");
}

export function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

export function makeLocalStaff(input = {}, existing = null) {
  const now = new Date().toISOString();
  const account = String(input.account || input.id || existing?.account || existing?.id || "").trim();
  const email = String(input.email || existing?.email || "").trim();
  const name = String(input.name || existing?.name || existing?.nickname || "").trim();
  return {
    ...(existing || {}),
    id: account,
    uid: existing?.uid || `CS-${Date.now()}`,
    account,
    role: "customer_service",
    email,
    phone: String(input.phone || existing?.phone || "").trim(),
    name,
    nickname: name,
    status: normalizeStaffStatus(input.status || existing?.status || "启用"),
    online_status: existing?.online_status || "离线",
    clocked_in: Boolean(existing?.clocked_in),
    remark: String(input.remark || existing?.remark || "").trim(),
    created_at: existing?.created_at || now,
    updated_at: now,
    last_login_at: existing?.last_login_at || "",
    password_hash: input.password ? hashPassword(input.password) : existing?.password_hash || "",
  };
}

export function enrichLocalStaffRows(store) {
  const date = todayKey();
  const staffRows = store.staff || [];
  return staffRows.map((staff) => {
    const attendance = (store.attendance || []).filter((row) => row.staff_id === staff.id);
    const today = attendance.find((row) => row.work_date === date);
    const records = (store.orderRecords || []).filter((row) => row.operator_id === staff.id || row.staff_id === staff.id);
    return safeStaff({
      ...staff,
      todayClockStatus: today?.clock_in_at ? (today.clock_out_at ? "已下班" : "已打卡") : "未打卡",
      todayClockInAt: today?.clock_in_at || "",
      todayClockOutAt: today?.clock_out_at || "",
      todayOrders: records.filter((row) => String(row.created_at || "").slice(0, 10) === date).length,
      monthOrders: records.length,
      afterSaleCount: records.filter((row) => /售后|退款/.test(String(row.action || row.remark || ""))).length,
    });
  });
}
