/**
 * Formal public account / document codes (never reuse sequence numbers).
 * - Boss:        MCJ00001…
 * - Companion:   PW00001…  (only after application approved)
 * - CS:          no public code — admin-filled display_name only
 * - Order:       MCJO000001…
 * - Withdraw:    WD000001…
 * - CS payroll:  CSW000001…
 */

const BOSS_PREFIX = "MCJ";
const COMPANION_PREFIX = "PW";
const ORDER_PREFIX = "MCJO";
const WITHDRAW_PREFIX = "WD";
const CS_PAYROLL_PREFIX = "CSW";
const PAD = 5;
const ORDER_PAD = 6;
const PAYOUT_PAD = 6;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEV_LOGIN_RE = /\.meow\.test$/i;

export function formatBossCode(n) {
  const num = Math.max(1, Math.floor(Number(n) || 0));
  return `${BOSS_PREFIX}${String(num).padStart(PAD, "0")}`;
}

export function formatCompanionCode(n) {
  const num = Math.max(1, Math.floor(Number(n) || 0));
  return `${COMPANION_PREFIX}${String(num).padStart(PAD, "0")}`;
}

export function formatOrderNo(n) {
  const num = Math.max(1, Math.floor(Number(n) || 0));
  return `${ORDER_PREFIX}${String(num).padStart(ORDER_PAD, "0")}`;
}

export function formatWithdrawalNo(n) {
  const num = Math.max(1, Math.floor(Number(n) || 0));
  return `${WITHDRAW_PREFIX}${String(num).padStart(PAYOUT_PAD, "0")}`;
}

export function formatCsPayrollNo(n) {
  const num = Math.max(1, Math.floor(Number(n) || 0));
  return `${CS_PAYROLL_PREFIX}${String(num).padStart(PAYOUT_PAD, "0")}`;
}

/** Parse MCJ00001 / legacy B100001 → numeric sequence value. */
export function parseBossCodeNumber(raw) {
  const s = String(raw || "").trim();
  let m = s.match(/^MCJ0*(\d+)$/i);
  if (m) return Number(m[1]);
  m = s.match(/^B(\d+)$/i);
  if (m) {
    const n = Number(m[1]);
    if (n >= 100001) return n - 100000;
    return n;
  }
  return 0;
}

/** Parse PW00001 / legacy P100001 → numeric sequence value. */
export function parseCompanionCodeNumber(raw) {
  const s = String(raw || "").trim();
  let m = s.match(/^PW0*(\d+)$/i);
  if (m) return Number(m[1]);
  m = s.match(/^P(\d+)$/i);
  if (m) {
    const n = Number(m[1]);
    if (n >= 100001) return n - 100000;
    return n;
  }
  return 0;
}

export function parseOrderNoNumber(raw) {
  const s = String(raw || "").trim();
  let m = s.match(/^MCJO0*(\d+)$/i);
  if (m) return Number(m[1]);
  // Legacy MCJ-timestamp-xxxx / CS-timestamp — not a sequence number
  return 0;
}

export function parseWithdrawalNoNumber(raw) {
  const s = String(raw || "").trim();
  let m = s.match(/^WD0*(\d+)$/i);
  if (m) return Number(m[1]);
  return 0;
}

export function parseCsPayrollNoNumber(raw) {
  const s = String(raw || "").trim();
  let m = s.match(/^CSW0*(\d+)$/i);
  if (m) return Number(m[1]);
  return 0;
}

export function isBossCode(raw) {
  return /^MCJ\d+$/i.test(String(raw || "").trim()) || /^B\d+$/i.test(String(raw || "").trim());
}

export function isCompanionCode(raw) {
  return /^PW\d+$/i.test(String(raw || "").trim()) || /^P\d+$/i.test(String(raw || "").trim());
}

export function isFormalOrderNo(raw) {
  return /^MCJO\d+$/i.test(String(raw || "").trim());
}

export function isDbUuid(raw) {
  return UUID_RE.test(String(raw || "").trim());
}

export function isDevLogin(raw) {
  const s = String(raw || "").trim();
  return DEV_LOGIN_RE.test(s) || /^(service|boss|companion|admin)\./i.test(s);
}

/** Hide .meow.test / UUID from operator-facing labels. */
export function publicDisplayName(row = {}, fallback = "-") {
  const name = String(row.display_name || row.displayName || row.nickname || row.name || "").trim();
  if (name && !isDevLogin(name) && !isDbUuid(name) && !/@/.test(name) && !/^草稿保留/i.test(name)) {
    return name;
  }
  const email = String(row.email || "").trim();
  if (email && !isDevLogin(email) && !isDbUuid(email)) return email;
  return fallback;
}

/**
 * Resolve public companion code from row fields.
 * Prefer companion_code; fall back to formatting companion_uid / legacy P#.
 */
export function resolveCompanionPublicCode(row = {}, extras = {}) {
  const direct = String(row.companion_code || extras.companionCode || extras.publicId || "").trim();
  if (/^PW\d+$/i.test(direct)) return direct.toUpperCase().replace(/^pw/i, "PW");
  if (/^P\d+$/i.test(direct)) {
    const n = parseCompanionCodeNumber(direct);
    return n ? formatCompanionCode(n) : "";
  }
  const uid = Number(row.companion_uid || extras.companionUid || 0);
  if (uid >= 100001) return formatCompanionCode(uid - 100000);
  if (uid > 0) return formatCompanionCode(uid);
  return "";
}

export function resolveBossPublicCode(profile = {}, extras = {}) {
  const raw = String(profile.boss_uid || profile.bossUid || extras.bossUid || extras.boss_uid || "").trim();
  if (!raw) return "";
  if (/^MCJ\d+$/i.test(raw)) return raw.toUpperCase().replace(/^mcj/i, "MCJ");
  const n = parseBossCodeNumber(raw);
  return n ? formatBossCode(n) : raw;
}

export function resolveOrderPublicNo(row = {}) {
  const raw = String(row.order_no || row.orderNo || "").trim();
  if (isFormalOrderNo(raw)) return raw.toUpperCase();
  if (raw && !isDbUuid(raw)) return raw;
  return "";
}

export function resolveWithdrawalPublicNo(row = {}) {
  const raw = String(row.withdrawal_no || row.withdrawalNo || row.payroll_no || row.payrollNo || "").trim();
  if (/^WD\d+$/i.test(raw) || /^CSW\d+$/i.test(raw)) return raw.toUpperCase();
  if (raw && !isDbUuid(raw)) return raw;
  return "";
}

/** Anonymous boss label for companion-facing surfaces. */
export function anonymousBossLabel(profile = {}, extras = {}) {
  const code = resolveBossPublicCode(profile, extras);
  return code ? `老板 ${code}` : "老板";
}

export function csDisplayName(row = {}) {
  return publicDisplayName(row, "客服");
}

/**
 * Allocate next formal code via PostgREST RPC.
 * @param {(path:string, query?:string, init?:object)=>Promise<any>} dbFn companionDb / supabaseJson wrapper
 * @param {string} rpcName e.g. mcj_allocate_order_no
 */
export async function allocateCodeViaRpc(dbFn, rpcName) {
  if (typeof dbFn !== "function" || !rpcName) return "";
  try {
    const result = await dbFn(`rpc/${rpcName}`, "", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const code =
      typeof result === "string"
        ? result
        : result?.[rpcName] || result?.code || (Array.isArray(result) ? result[0] : "") || "";
    return String(code || "").trim();
  } catch {
    return "";
  }
}

/**
 * Scan-based fallback allocator (when RPC/migration not yet applied).
 * @param {(path:string, query?:string)=>Promise<any>} listFn returns rows with code field
 * @param {{ field:string, parse:(v:string)=>number, format:(n:number)=>string, table:string }} opts
 */
export async function allocateCodeByScan(listFn, opts) {
  const field = opts.field;
  const parse = opts.parse;
  const format = opts.format;
  const rows = await listFn().catch(() => []);
  let next = 1;
  for (const row of Array.isArray(rows) ? rows : []) {
    const n = parse(row?.[field]);
    if (n) next = Math.max(next, n + 1);
  }
  return format(next);
}

export async function allocateOrderNo(dbFn) {
  const viaRpc = await allocateCodeViaRpc(dbFn, "mcj_allocate_order_no");
  if (isFormalOrderNo(viaRpc)) return viaRpc.toUpperCase();
  const fallback = await allocateCodeByScan(
    () =>
      dbFn("orders", `?select=order_no&order_no=like.MCJO*&order=order_no.desc&limit=200`).catch(() => []),
    { field: "order_no", parse: parseOrderNoNumber, format: formatOrderNo, table: "orders" }
  );
  return fallback || formatOrderNo(Date.now() % 1000000 || 1);
}

export async function allocateWithdrawalNo(dbFn) {
  const viaRpc = await allocateCodeViaRpc(dbFn, "mcj_allocate_withdrawal_no");
  if (/^WD\d+$/i.test(viaRpc)) return viaRpc.toUpperCase();
  const fallback = await allocateCodeByScan(
    () =>
      dbFn("companion_withdrawals", `?select=withdrawal_no&withdrawal_no=like.WD*&order=withdrawal_no.desc&limit=200`).catch(
        () => []
      ),
    { field: "withdrawal_no", parse: parseWithdrawalNoNumber, format: formatWithdrawalNo, table: "companion_withdrawals" }
  );
  return fallback || formatWithdrawalNo(Date.now() % 1000000 || 1);
}

export async function allocateCsPayrollNo(dbFn) {
  const viaRpc = await allocateCodeViaRpc(dbFn, "mcj_allocate_cs_payroll_no");
  if (/^CSW\d+$/i.test(viaRpc)) return viaRpc.toUpperCase();
  const fallback = await allocateCodeByScan(
    () =>
      dbFn("staff_payrolls", `?select=payroll_no&payroll_no=like.CSW*&order=payroll_no.desc&limit=200`).catch(() => []),
    { field: "payroll_no", parse: parseCsPayrollNoNumber, format: formatCsPayrollNo, table: "staff_payrolls" }
  );
  return fallback || formatCsPayrollNo(Date.now() % 1000000 || 1);
}

export {
  BOSS_PREFIX,
  COMPANION_PREFIX,
  ORDER_PREFIX,
  WITHDRAW_PREFIX,
  CS_PAYROLL_PREFIX,
  PAD,
  ORDER_PAD,
  PAYOUT_PAD,
};
