/**
 * Boss loyalty points read API (phase 1 UI).
 * Auth-scoped: user_id always comes from the Bearer token profile — never from client body/query.
 */
import fs from "node:fs";
import path from "node:path";
import { hasBossRole } from "./_account-roles.js";
import {
  emptyPointsAccountView,
  getUserPointsAccount,
  hasPointsDb,
  listUserPointsLedger,
  viewPointsAccount,
  viewPointsLedgerRow,
} from "./_user-points.js";
import { isMissingRelation } from "./_wallet.js";

loadLocalEnv();

const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];

function loadLocalEnv() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const rawLine of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (key && value && !process.env[key]) process.env[key] = value;
  }
}

function envValue(key) {
  if (key === "SUPABASE_URL") return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  if (key === "SUPABASE_ANON_KEY") {
    return process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
  }
  return process.env[key] || "";
}

function json(res, status, data) {
  if (typeof res.setHeader === "function") {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
  }
  res.status(status).json(data);
}

function hasDb() {
  return REQUIRED_ENV.every((key) => envValue(key));
}

function authHeaders(extra = {}) {
  return { apikey: envValue("SUPABASE_ANON_KEY"), "Content-Type": "application/json", ...extra };
}

function serviceHeaders(extra = {}) {
  const key = envValue("SUPABASE_SERVICE_ROLE_KEY");
  const base = {
    apikey: key,
    "Content-Type": "application/json",
    "User-Agent": "MCJ-Server/1.0",
    Prefer: "return=representation",
    ...extra,
  };
  if (!String(key || "").startsWith("sb_secret_")) base.Authorization = `Bearer ${key}`;
  return base;
}

function authUrl(route) {
  return `${envValue("SUPABASE_URL")}/auth/v1/${route}`;
}

function restUrl(table, query = "") {
  return `${envValue("SUPABASE_URL")}/rest/v1/${table}${query}`;
}

function tokenFrom(req) {
  return String(req.headers.authorization || req.headers["x-mcj-access-token"] || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
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
    const message =
      body?.message ||
      body?.hint ||
      body?.details ||
      body?.error_description ||
      (typeof body === "string" ? body : "") ||
      "Supabase 请求失败";
    const error = new Error(message);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

async function profileFromToken(req) {
  const token = tokenFrom(req);
  if (!token) {
    const err = new Error("请先登录老板账号。");
    err.status = 401;
    throw err;
  }
  const authUser = await supabaseJson(authUrl("user"), {
    headers: authHeaders({ Authorization: `Bearer ${token}` }),
  });
  const rows = await supabaseJson(restUrl("profiles", `?id=eq.${encodeURIComponent(authUser.id)}&limit=1`), {
    headers: serviceHeaders(),
  });
  const profile = Array.isArray(rows) ? rows[0] : null;
  if (!profile) {
    const err = new Error("账号资料不存在。");
    err.status = 403;
    throw err;
  }
  if (!hasBossRole(profile, { authUser })) {
    const err = new Error("当前账号不是老板角色。");
    err.status = 403;
    throw err;
  }
  if (String(profile.status || "").toLowerCase() === "disabled") {
    const err = new Error("账号已停用。");
    err.status = 403;
    throw err;
  }
  return profile;
}

export default async function handler(req, res) {
  if (!hasDb()) {
    return json(res, 503, { ok: false, message: "未配置 Supabase，积分中心无法读取真实数据。" });
  }

  try {
    const profile = await profileFromToken(req);
    // Never trust client-supplied user_id / boss_id — always use token profile.
    const userId = profile.id;

    if (req.method === "GET") {
      const limitRaw = Number(req.query?.limit || 50);
      const limit = Number.isFinite(limitRaw) ? limitRaw : 50;

      if (!hasPointsDb()) {
        return json(res, 200, {
          ok: true,
          tablesReady: false,
          account: emptyPointsAccountView(userId),
          ledger: [],
          message: "积分表未初始化，当前显示为 0。",
        });
      }

      let accountRow = null;
      let ledgerRows = [];
      try {
        [accountRow, ledgerRows] = await Promise.all([
          getUserPointsAccount(userId),
          listUserPointsLedger(userId, { limit }),
        ]);
      } catch (error) {
        if (isMissingRelation(error)) {
          return json(res, 200, {
            ok: true,
            tablesReady: false,
            account: emptyPointsAccountView(userId),
            ledger: [],
            message: "积分表未初始化，当前显示为 0。",
          });
        }
        throw error;
      }

      return json(res, 200, {
        ok: true,
        tablesReady: true,
        account: viewPointsAccount(accountRow, userId),
        ledger: (ledgerRows || []).map(viewPointsLedgerRow),
        message: "",
      });
    }

    res.setHeader("Allow", "GET");
    return json(res, 405, { ok: false, message: "Method Not Allowed" });
  } catch (error) {
    const status = Number(error?.status) || 500;
    return json(res, status >= 400 && status < 600 ? status : 500, {
      ok: false,
      message: error?.message || "积分接口异常",
    });
  }
}
