/**
 * Durable OTP store for serverless isolates.
 * Prefers password_reset_requests; falls back to platform_settings rows when that table is missing.
 */
import { createHash, randomInt } from "node:crypto";

function envValue(key, fallback = "") {
  return String(process.env[key] || fallback).trim();
}

function restUrl(table, query = "") {
  return `${envValue("SUPABASE_URL").replace(/\/$/, "")}/rest/v1/${table}${query}`;
}

function serviceHeaders(extra = {}) {
  const key = envValue("SUPABASE_SERVICE_ROLE_KEY") || envValue("SUPABASE_ANON_KEY");
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Prefer: "return=minimal",
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
    const detail =
      body?.error_description ||
      body?.msg ||
      body?.message ||
      body?.hint ||
      body?.details ||
      (typeof body === "string" ? body : "") ||
      `${response.status} ${response.statusText}`;
    throw new Error(detail);
  }
  return body;
}

function memMap() {
  globalThis.__mcjForgotResets = globalThis.__mcjForgotResets || new Map();
  return globalThis.__mcjForgotResets;
}

function settingsOtpId(role, kind, accountKey) {
  const raw = `${role}:${kind}:${accountKey}`.toLowerCase();
  const hash = createHash("sha256").update(raw).digest("hex").slice(0, 24);
  return `mcj_otp_${hash}`;
}

export function randomOtpCode() {
  return String(randomInt(100000, 1000000));
}

export async function storeOtp({ accountKey, role, code, kind = "otp", ttlMs = 15 * 60 * 1000 } = {}) {
  const id = `fpr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const exp = Date.now() + ttlMs;
  const status = `${kind}:${code}:exp:${exp}`;
  const key = String(accountKey || "").trim().toLowerCase();
  const r = String(role || "").trim().toLowerCase();
  const k = String(kind || "otp").trim();
  memMap().set(`${r}:${k}:${key}`, { id, code, exp, kind: k });

  let dbOk = false;
  let dbError = "";
  // 1) preferred dedicated table
  try {
    await supabaseJson(restUrl("password_reset_requests"), {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify({
        id,
        account: key,
        role: r,
        status,
        created_at: new Date().toISOString(),
      }),
    });
    dbOk = true;
  } catch (err) {
    dbError = String(err?.message || err || "");
  }

  // 2) durable fallback: platform_settings row
  if (!dbOk) {
    try {
      const sid = settingsOtpId(r, k, key);
      await supabaseJson(restUrl("platform_settings", "?on_conflict=id"), {
        method: "POST",
        headers: serviceHeaders({ Prefer: "resolution=merge-duplicates,return=minimal" }),
        body: JSON.stringify({
          id: sid,
          data: {
            otp: true,
            account: key,
            role: r,
            kind: k,
            status,
            code,
            exp,
            requestId: id,
            updatedAt: new Date().toISOString(),
          },
          updated_at: new Date().toISOString(),
        }),
      });
      dbOk = true;
      dbError = "";
    } catch (err2) {
      dbError = `${dbError || "password_reset_requests failed"} | platform_settings: ${err2?.message || err2}`;
    }
  }

  if (!dbOk && (k === "register_otp" || k === "login_otp")) {
    throw Object.assign(new Error(`验证码存储失败，请稍后重试。${dbError ? `（${dbError}）` : ""}`), {
      status: 503,
      code: "OTP_STORE_FAILED",
    });
  }
  return { id, exp, dbOk };
}

export async function findOtp(accountKey, role, kind = "otp") {
  const key = String(accountKey || "").trim().toLowerCase();
  const r = String(role || "").trim().toLowerCase();
  const k = String(kind || "otp").trim();
  const otpRe = new RegExp(`^${k}:(\\d{6}):exp:(\\d+)$`);

  // preferred table
  try {
    const rows = await supabaseJson(
      restUrl(
        "password_reset_requests",
        `?account=eq.${encodeURIComponent(key)}&role=eq.${encodeURIComponent(r)}&order=created_at.desc&limit=8`
      ),
      { headers: serviceHeaders({ Prefer: "return=representation" }) }
    );
    for (const row of rows || []) {
      const m = String(row.status || "").match(otpRe);
      if (m) return { id: row.id, code: m[1], exp: Number(m[2]), row, kind: k, source: "password_reset_requests" };
      if (k === "otp") {
        const v = String(row.status || "").match(/^verified:([A-Za-z0-9_-]+):exp:(\d+)$/);
        if (v) return { id: row.id, verifiedToken: v[1], exp: Number(v[2]), row, kind: k, source: "password_reset_requests" };
      }
    }
  } catch {
    /* table may be missing */
  }

  // platform_settings fallback
  try {
    const sid = settingsOtpId(r, k, key);
    const rows = await supabaseJson(restUrl("platform_settings", `?id=eq.${encodeURIComponent(sid)}&select=id,data&limit=1`), {
      headers: serviceHeaders({ Prefer: "return=representation" }),
    });
    const data = rows?.[0]?.data || {};
    const m = String(data.status || "").match(otpRe);
    if (m) {
      return {
        id: data.requestId || sid,
        code: m[1],
        exp: Number(m[2]),
        row: { id: sid, data },
        kind: k,
        source: "platform_settings",
      };
    }
    if (data.verifiedToken && Number(data.exp) > Date.now()) {
      return {
        id: data.requestId || sid,
        verifiedToken: data.verifiedToken,
        exp: Number(data.exp),
        row: { id: sid, data },
        kind: k,
        source: "platform_settings",
      };
    }
  } catch {
    /* ignore */
  }

  const mem = memMap().get(`${r}:${k}:${key}`) || memMap().get(`${r}:${key}`);
  if (mem && (!mem.kind || mem.kind === k)) return { ...mem, source: "memory" };
  return null;
}

export async function markOtpVerified(accountKey, role, kind, rowId, token, ttlMs = 30 * 60 * 1000) {
  const key = String(accountKey || "").trim().toLowerCase();
  const r = String(role || "").trim().toLowerCase();
  const k = String(kind || "otp").trim();
  const exp = Date.now() + ttlMs;
  const statusPrefix = k === "register_otp" ? "register_verified" : "verified";
  const status = `${statusPrefix}:${token}:exp:${exp}`;
  memMap().set(`${r}:${statusPrefix}:${key}`, { id: rowId || token, verifiedToken: token, exp, kind: statusPrefix });

  let wrote = false;
  if (rowId && !String(rowId).startsWith("mcj_otp_")) {
    try {
      await supabaseJson(restUrl("password_reset_requests", `?id=eq.${encodeURIComponent(rowId)}`), {
        method: "PATCH",
        headers: serviceHeaders(),
        body: JSON.stringify({ status }),
      });
      wrote = true;
    } catch {
      /* missing table / row */
    }
  }

  try {
    const sid = settingsOtpId(r, k, key);
    await supabaseJson(restUrl("platform_settings", "?on_conflict=id"), {
      method: "POST",
      headers: serviceHeaders({ Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify({
        id: sid,
        data: {
          otp: true,
          account: key,
          role: r,
          kind: k,
          status,
          verifiedToken: token,
          exp,
          requestId: rowId || token,
          updatedAt: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      }),
    });
    wrote = true;
  } catch (err) {
    if (!wrote) throw err;
  }
  return exp;
}

export async function findRegisterVerified(accountKey, role, token) {
  const key = String(accountKey || "").trim().toLowerCase();
  const r = String(role || "companion").trim().toLowerCase();
  const want = String(token || "").trim();
  if (!want) return null;
  const re = /^register_verified:([A-Za-z0-9_-]+):exp:(\d+)$/;

  try {
    const rows = await supabaseJson(
      restUrl(
        "password_reset_requests",
        `?account=eq.${encodeURIComponent(key)}&role=eq.${encodeURIComponent(r)}&order=created_at.desc&limit=8`
      ),
      { headers: serviceHeaders({ Prefer: "return=representation" }) }
    );
    for (const row of rows || []) {
      const m = String(row.status || "").match(re);
      if (m && m[1] === want && Number(m[2]) > Date.now()) {
        return { id: row.id, verifiedToken: m[1], exp: Number(m[2]), row, source: "password_reset_requests" };
      }
    }
  } catch {
    /* ignore */
  }

  try {
    const sid = settingsOtpId(r, "register_otp", key);
    const rows = await supabaseJson(restUrl("platform_settings", `?id=eq.${encodeURIComponent(sid)}&select=id,data&limit=1`), {
      headers: serviceHeaders({ Prefer: "return=representation" }),
    });
    const data = rows?.[0]?.data || {};
    if (data.verifiedToken === want && Number(data.exp) > Date.now()) {
      return { id: sid, verifiedToken: want, exp: Number(data.exp), row: { id: sid, data }, source: "platform_settings" };
    }
    const m = String(data.status || "").match(re);
    if (m && m[1] === want && Number(m[2]) > Date.now()) {
      return { id: sid, verifiedToken: m[1], exp: Number(m[2]), row: { id: sid, data }, source: "platform_settings" };
    }
  } catch {
    /* ignore */
  }

  const mem = memMap().get(`${r}:register_verified:${key}`);
  if (mem?.verifiedToken === want && Number(mem.exp) > Date.now()) return { ...mem, source: "memory" };
  return null;
}

export async function consumeRegisterVerified(accountKey, role, token) {
  const hit = await findRegisterVerified(accountKey, role, token);
  if (!hit) {
    throw Object.assign(new Error("邮箱验证已失效，请重新获取验证码。"), { status: 400 });
  }
  const key = String(accountKey || "").trim().toLowerCase();
  const r = String(role || "companion").trim().toLowerCase();

  if (hit.id && hit.source === "password_reset_requests") {
    await supabaseJson(restUrl("password_reset_requests", `?id=eq.${encodeURIComponent(hit.id)}`), {
      method: "PATCH",
      headers: serviceHeaders(),
      body: JSON.stringify({ status: `register_used:${Date.now()}` }),
    }).catch(() => null);
  }

  const sid = settingsOtpId(r, "register_otp", key);
  await supabaseJson(restUrl("platform_settings", `?id=eq.${encodeURIComponent(sid)}`), {
    method: "PATCH",
    headers: serviceHeaders(),
    body: JSON.stringify({
      data: {
        otp: true,
        account: key,
        role: r,
        kind: "register_otp",
        status: `register_used:${Date.now()}`,
        verifiedToken: "",
        exp: 0,
        updatedAt: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    }),
  }).catch(() => null);

  try {
    memMap().delete(`${r}:register_verified:${key}`);
  } catch {
    /* ignore */
  }
  return { ok: true, email: key, role: r };
}
