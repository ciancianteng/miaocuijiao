/**
 * Live Staging smoke for Boss ↔ Companion 直属关系（requires tables already migrated）.
 *
 * Usage:
 *   BASE=https://meow-cuijiao-homepage-git-cu-a8401b-ciancianteng-4581s-projects.vercel.app \
 *   node scripts/smoke-boss-companion-relations-live.mjs
 *
 * Optional: ADMIN_EMAIL, ADMIN_PASS, BOSS_EMAIL, COMPANION_EMAIL, PASS
 * Never touches Production.
 */
const BASE = (process.env.BASE || process.env.MCJ_PREVIEW_URL || "").replace(/\/$/, "");
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@meow.test";
const ADMIN_PASS = process.env.ADMIN_PASS || process.env.PASS || "McjTest@12345678";
const BOSS_EMAIL = process.env.BOSS_EMAIL || "boss@meow.test";
const COMPANION_EMAIL = process.env.COMPANION_EMAIL || "companion@meow.test";
const PASS = process.env.PASS || "McjTest@12345678";

if (!BASE) {
  console.error("FAIL: set BASE to Preview URL");
  process.exit(2);
}

const results = [];
function step(name, ok, detail = "") {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "").slice(0, 800) });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? " :: " + String(detail).slice(0, 220) : ""}`);
  return ok;
}

async function api(path, { method = "GET", token, body, admin = true } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(token
        ? {
            Authorization: "Bearer " + token,
            ...(admin ? { "x-mcj-admin-role": "admin" } : {}),
          }
        : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function portalLogin(email, password, portal) {
  const login = await api("/api/auth", {
    method: "POST",
    body: { action: "login", email, password, loginPortal: portal, role: portal === "admin" ? "admin" : undefined },
    admin: false,
  });
  const token = login.json?.session?.accessToken || "";
  const id = login.json?.session?.user?.id || "";
  return { token, id, raw: login.json };
}

async function sbPasswordLogin(email, password) {
  const cfg = await fetch(BASE + "/api/public/realtime-config").then((r) => r.json());
  const url = String(cfg.url || "").replace(/\/$/, "");
  const anon = cfg.anonKey || "";
  const res = await fetch(url + "/auth/v1/token?grant_type=password", {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json().catch(() => ({}));
  return {
    token: json.access_token || "",
    id: json.user?.id || "",
    raw: json,
  };
}

const admin = await portalLogin(ADMIN_EMAIL, ADMIN_PASS, "admin");
step("admin_login", !!admin.token, admin.id || admin.raw?.message || "");

if (!admin.token) {
  console.log(JSON.stringify({ ok: false, results }, null, 2));
  process.exit(1);
}

const jwtSub = JSON.parse(Buffer.from(admin.token.split(".")[1], "base64url").toString()).sub;
step("auth_uid_eq_profiles_id", jwtSub === admin.id, `sub=${jwtSub} id=${admin.id}`);

const list = await api("/api/admin/boss-companion-relations?action=list&status=", { token: admin.token });
if (list.json?.tablesReady === false) {
  step("tables_ready", false, list.json?.message || "tablesReady=false — run Staging migration first");
  console.log(
    JSON.stringify(
      {
        ok: false,
        results,
        hint: "Paste supabase/migrations/20260901_boss_companion_relations.sql into Staging SQL Editor (cfccwysniduwkjskiqgy)",
      },
      null,
      2
    )
  );
  process.exit(1);
}
step("tables_ready", true, `relations=${(list.json?.relations || []).length}`);

// Prefer known four-end test accounts so boss/companion read APIs can be verified.
const bossLogin = await sbPasswordLogin(BOSS_EMAIL, PASS);
const companionLogin = await sbPasswordLogin(COMPANION_EMAIL, PASS);
step("boss_login", !!bossLogin.token, bossLogin.id || JSON.stringify(bossLogin.raw).slice(0, 120));
step("companion_login", !!companionLogin.token, companionLogin.id || JSON.stringify(companionLogin.raw).slice(0, 120));

let bossId = process.env.BOSS_ID || bossLogin.id || "";
let companionId = process.env.COMPANION_ID || companionLogin.id || "";
let boss2Id = process.env.BOSS2_ID || "";

if (!bossId || !companionId) {
  const bosses = await api("/api/admin/bosses?limit=20", { token: admin.token });
  const players = await api("/api/admin/players?limit=40", { token: admin.token });
  const bossList = bosses.json?.bosses || [];
  const playerList = players.json?.players || [];
  const bossIds = bossList.map((b) => b.id).filter(Boolean);
  const companionIds = playerList
    .map((p) => p.user_id || p.userId || p.id)
    .filter(Boolean)
    .filter((id) => !bossIds.includes(id) && id !== admin.id);
  if (!bossId) bossId = bossIds[0] || "";
  if (!boss2Id) boss2Id = bossIds.find((id) => id !== bossId) || "";
  if (!companionId) companionId = companionIds[0] || "";
}
if (!boss2Id && bossLogin.id) {
  const bosses = await api("/api/admin/bosses?limit=20", { token: admin.token });
  boss2Id = (bosses.json?.bosses || []).map((b) => b.id).find((id) => id && id !== bossId) || "";
}

const picked = { bossId, companionId, boss2Id };
step("pick_targets", !!(picked.bossId && picked.companionId), JSON.stringify(picked));

if (!picked.bossId || !picked.companionId) {
  console.log(JSON.stringify({ ok: false, results, message: "no boss/companion ids available" }, null, 2));
  process.exit(1);
}

await api("/api/admin/boss-companion-relations?action=unbind", {
  method: "POST",
  token: admin.token,
  body: {
    action: "unbind",
    companionId: picked.companionId,
    remark: "live-smoke-cleanup",
    reason: "live-smoke-cleanup",
  },
});

const bind = await api("/api/admin/boss-companion-relations?action=bind", {
  method: "POST",
  token: admin.token,
  body: {
    action: "bind",
    bossId: picked.bossId,
    companionId: picked.companionId,
    remark: "live-smoke-bind",
    reason: "live-smoke-bind",
  },
});
step("bind", bind.json?.ok === true, bind.json?.message || JSON.stringify(bind.json).slice(0, 240));

const hist1 = await api(
  "/api/admin/boss-companion-relations?action=history&companionId=" + encodeURIComponent(picked.companionId),
  { token: admin.token }
);
step(
  "history_after_bind",
  (hist1.json?.events || []).some((e) => e.action === "bind" && String(e.reason || "").includes("live-smoke")),
  `events=${(hist1.json?.events || []).length}`
);

// Four-end read: Boss + Companion portals after admin bind
if (bossLogin.token && bossLogin.id === picked.bossId) {
  const bossView = await api("/api/boss/direct-companions", { token: bossLogin.token, admin: false });
  const ids = (bossView.json?.companions || []).map((c) => c.companionId || c.companion?.id || c.id);
  step(
    "boss_read_after_bind",
    bossView.json?.ok === true && ids.includes(picked.companionId),
    `companions=${ids.length} ok=${bossView.json?.ok}`
  );
} else {
  step("boss_read_after_bind", true, "SKIPPED (boss token unavailable or id mismatch)");
}

if (companionLogin.token && companionLogin.id === picked.companionId) {
  const compView = await api("/api/companion/direct-boss", { token: companionLogin.token, admin: false });
  const bossFromComp = compView.json?.boss?.id || compView.json?.relation?.bossId || "";
  step(
    "companion_read_after_bind",
    compView.json?.ok === true && bossFromComp === picked.bossId,
    `boss=${bossFromComp || "null"} ok=${compView.json?.ok}`
  );
} else {
  step("companion_read_after_bind", true, "SKIPPED (companion token unavailable or id mismatch)");
}

if (picked.boss2Id) {
  const rebind = await api("/api/admin/boss-companion-relations?action=rebind", {
    method: "POST",
    token: admin.token,
    body: {
      action: "rebind",
      companionId: picked.companionId,
      newBossId: picked.boss2Id,
      remark: "live-smoke-rebind",
      reason: "live-smoke-rebind",
    },
  });
  step("rebind", rebind.json?.ok === true, rebind.json?.message || JSON.stringify(rebind.json).slice(0, 240));
} else {
  step("rebind", true, "SKIPPED (only one boss available)");
}

const unbind = await api("/api/admin/boss-companion-relations?action=unbind", {
  method: "POST",
  token: admin.token,
  body: {
    action: "unbind",
    companionId: picked.companionId,
    remark: "live-smoke-unbind",
    reason: "live-smoke-unbind",
  },
});
step("unbind", unbind.json?.ok === true, unbind.json?.message || "");

if (companionLogin.token && companionLogin.id === picked.companionId) {
  const after = await api("/api/companion/direct-boss", { token: companionLogin.token, admin: false });
  step(
    "companion_read_after_unbind",
    after.json?.ok === true && !after.json?.boss,
    after.json?.message || "cleared"
  );
} else {
  step("companion_read_after_unbind", true, "SKIPPED");
}

const hist2 = await api(
  "/api/admin/boss-companion-relations?action=history&companionId=" + encodeURIComponent(picked.companionId),
  { token: admin.token }
);
const actions = (hist2.json?.events || []).map((e) => e.action);
step("history_append_only", actions.includes("bind") && actions.includes("unbind"), actions.join(","));

const failed = results.some((r) => r.result === "FAIL");
console.log(JSON.stringify({ ok: !failed, base: BASE, picked, results }, null, 2));
process.exit(failed ? 1 : 0);
