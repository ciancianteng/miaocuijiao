/**
 * XOR id_card auth smoke (no purge — keeps prior lifecycle accounts).
 * Usage: node scripts/accept-id-card-auth.mjs --base=https://....vercel.app
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(root, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).replace(/^['"]|['']$/g, "")];
    })
);

const SUPABASE_URL = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const ANON = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const PASS = "McjTest@12345678";
const ADMIN_EMAIL = process.env.MCJ_ADMIN_EMAIL || "admin@meow.test";
const BASE = (process.argv.find((a) => a.startsWith("--base="))?.slice(7) || "").replace(/\/$/, "");
if (!BASE) throw new Error("need --base=");

const stamp = Date.now();
const email = `companion.idcard.${stamp}@meow.test`;
const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const results = {};
function set(id, status, note = "") {
  results[id] = { status, note: String(note || "").slice(0, 400) };
  console.log(`${status.padEnd(7)} ${id} ${note || ""}`);
}

async function auth(emailAddr, password = PASS) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: emailAddr, password }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`auth ${emailAddr}: ${JSON.stringify(j)}`);
  return j;
}

async function rest(table, qs, { method = "GET", body } = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}${qs || ""}`, {
    method,
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!r.ok) throw new Error(`${method} ${table} ${r.status}: ${text}`);
  return data;
}

async function api(pathname, token, { method = "POST", body } = {}) {
  const r = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: method === "GET" ? undefined : JSON.stringify(body || {}),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ok: r.ok && j.ok !== false, body: j };
}

async function main() {
  console.log("ID_CARD AUTH SMOKE", BASE, email);
  const admin = await auth(ADMIN_EMAIL);
  let companionAuth;
  let profileId = "";
  let userId = "";

  try {
    const creg = await api("/api/companion", null, {
      body: { action: "register", email, password: PASS, nickname: "身份证终验陪玩" },
    });
    if (!creg.ok && !/already|exists|已注册|已存在/i.test(creg.body?.message || "")) {
      throw new Error(creg.body?.message || "register failed");
    }
    companionAuth = await auth(email);
    userId = companionAuth.user?.id || "";
    const apply = await api("/api/companion", companionAuth.access_token, {
      body: {
        action: "submit_application",
        nickname: "身份证终验陪玩",
        intro: "身份证认证路径",
        games: ["Valorant"],
        price: 35,
        voice_type: "甜妹",
        auth_mode: "id_card",
        credential_mode: "id_card",
      },
    });
    if (!apply.ok) throw new Error(apply.body?.message || "submit_application failed");
    const ver = await api("/api/companion", companionAuth.access_token, {
      body: {
        action: "submit_verification",
        real_name: "身份证终验",
        identity_no: "A12345678",
        id_front: TINY_PNG,
        id_back: TINY_PNG,
        method: "bank",
        account_name: "身份证终验",
        bank_account: "1234567890",
        bank_name: "Maybank",
      },
    });
    if (!ver.ok) throw new Error(ver.body?.message || "submit_verification failed");
    const rows = await rest(
      "companion_profiles",
      `?user_id=eq.${encodeURIComponent(userId)}&select=id,application_note,verification_status,deposit_status&limit=1`
    );
    profileId = rows?.[0]?.id || "";
    const note = rows?.[0]?.application_note || "";
    if (!/AUTH_MODE:id_card/i.test(note)) throw new Error(`auth mode not persisted: ${note}`);
    set("id_apply", "PASS", `profile=${profileId}`);
  } catch (e) {
    set("id_apply", "FAIL", e.message);
  }

  try {
    if (!profileId) throw new Error("missing profileId");
    const detail = await api(`/api/admin/players?id=${encodeURIComponent(profileId)}`, admin.access_token, {
      method: "GET",
    });
    const player = detail.body?.player || detail.body?.players?.[0] || detail.body?.data || {};
    const mode = player.authMode || player.auth_mode || player.application?.authMode;
    if (mode !== "id_card") {
      // list fallback
      const list = await api("/api/admin/players", admin.access_token, { method: "GET" });
      const hit = (list.body?.players || []).find((p) => p.id === profileId);
      if ((hit?.authMode || hit?.auth_mode) !== "id_card") {
        throw new Error(`admin authMode=${hit?.authMode || mode || "missing"}`);
      }
    }
    set("id_admin_sees_mode", "PASS", "id_card");
  } catch (e) {
    set("id_admin_sees_mode", "FAIL", e.message);
  }

  try {
    const appOk = await api("/api/admin/players", admin.access_token, {
      body: { action: "review_application", id: profileId, status: "approved" },
    });
    if (!appOk.ok) throw new Error(appOk.body?.message || "review_application failed");
    const rows = await rest(
      "companion_profiles",
      `?id=eq.${encodeURIComponent(profileId)}&select=application_status,verification_status,deposit_status`
    );
    const row = rows?.[0] || {};
    if (!/approved|verified|passed/i.test(String(row.application_status || ""))) {
      throw new Error(`application_status=${row.application_status}`);
    }
    if (!/approved|verified|passed/i.test(String(row.verification_status || ""))) {
      throw new Error(`verification_status=${row.verification_status} (auto id approve failed)`);
    }
    set("id_admin_approve", "PASS", JSON.stringify(row));
  } catch (e) {
    set("id_admin_approve", "FAIL", e.message);
  }

  try {
    companionAuth = await auth(email);
    const pending = await api("/api/companion", companionAuth.access_token, { body: { action: "pending_forced" } });
    for (const item of pending.body?.pendingForced || pending.body?.pending || []) {
      const id = item.id || item.announcementId || item.contentId;
      if (!id) continue;
      await api("/api/companion", companionAuth.access_token, {
        body: {
          action: "acknowledge_forced",
          content_id: id,
          content_version: String(item.version || item.content_version || "1"),
          content_type: item.contentType || "announcement",
        },
      });
    }
    const on = await api("/api/companion", companionAuth.access_token, {
      body: { action: "set_online_status", online_status: "online", availability_status: "online" },
    });
    if (!on.ok) throw new Error(on.body?.message || "online failed");
    const hall = await api("/api/public/companions", null, { method: "GET" });
    const hit = (hall.body?.companions || []).find(
      (c) => c.id === profileId || c.userId === userId || /身份证终验陪玩/.test(c.name || c.nickname || "")
    );
    if (!hit) throw new Error(`not in hall; count=${(hall.body?.companions || []).length}`);
    set("id_hall_visible", "PASS", hit.name || hit.nickname || hit.id);
  } catch (e) {
    set("id_hall_visible", "FAIL", e.message);
  }

  const out = {
    base: BASE,
    email,
    password: PASS,
    profileId,
    at: new Date().toISOString(),
    results,
    pass: Object.values(results).filter((r) => r.status === "PASS").length,
    fail: Object.values(results).filter((r) => r.status === "FAIL").length,
  };
  fs.writeFileSync(path.join(root, "scripts/accept-id-card-auth-results.json"), JSON.stringify(out, null, 2));
  console.log(`SUMMARY PASS=${out.pass} FAIL=${out.fail}`);
  process.exit(out.fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
