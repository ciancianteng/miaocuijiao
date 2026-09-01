/**
 * Live Staging smoke for Boss ↔ Companion 直属关系（requires tables already migrated）.
 *
 * Usage:
 *   BASE=https://meow-cuijiao-homepage-git-cu-a8401b-ciancianteng-4581s-projects.vercel.app \
 *   node scripts/smoke-boss-companion-relations-live.mjs
 *
 * Optional overrides: BOSS_ID, COMPANION_ID, BOSS2_ID (for rebind), ADMIN_EMAIL, ADMIN_PASS
 * Never touches Production.
 */
const BASE = (process.env.BASE || process.env.MCJ_PREVIEW_URL || "").replace(/\/$/, "");
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@meow.test";
const ADMIN_PASS = process.env.ADMIN_PASS || "McjTest@12345678";

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

const login = await api("/api/auth", {
  method: "POST",
  body: { action: "login", email: ADMIN_EMAIL, password: ADMIN_PASS, loginPortal: "admin", role: "admin" },
  admin: false,
});
const token = login.json?.session?.accessToken || "";
const adminId = login.json?.session?.user?.id || "";
step("admin_login", !!token, adminId || login.json?.message || "");

if (!token) {
  console.log(JSON.stringify({ ok: false, results }, null, 2));
  process.exit(1);
}

const jwtSub = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).sub;
step("auth_uid_eq_profiles_id", jwtSub === adminId, `sub=${jwtSub} id=${adminId}`);

const list = await api("/api/admin/boss-companion-relations?action=list&status=", { token });
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

async function pickBossAndCompanion() {
  let bossId = process.env.BOSS_ID || "";
  let companionId = process.env.COMPANION_ID || "";
  let boss2Id = process.env.BOSS2_ID || "";

  if (!bossId || !companionId) {
    const bosses = await api("/api/admin/bosses?limit=20", { token });
    const players = await api("/api/admin/players?limit=40", { token });
    const bossList = bosses.json?.bosses || [];
    const playerList = players.json?.players || [];
    const bossIds = bossList.map((b) => b.id).filter(Boolean);
    const companionIds = playerList
      .map((p) => p.user_id || p.userId || p.id)
      .filter(Boolean)
      .filter((id) => !bossIds.includes(id) && id !== adminId);

    if (!bossId) bossId = bossIds[0] || "";
    if (!boss2Id) boss2Id = bossIds.find((id) => id !== bossId) || "";
    if (!companionId) companionId = companionIds[0] || "";
  }
  return { bossId, companionId, boss2Id };
}

const picked = await pickBossAndCompanion();
step("pick_targets", !!(picked.bossId && picked.companionId), JSON.stringify(picked));

if (!picked.bossId || !picked.companionId) {
  console.log(JSON.stringify({ ok: false, results, message: "no boss/companion ids available" }, null, 2));
  process.exit(1);
}

// cleanup any prior active
await api("/api/admin/boss-companion-relations?action=unbind", {
  method: "POST",
  token,
  body: { action: "unbind", companionId: picked.companionId, remark: "live-smoke-cleanup" },
});

const bind = await api("/api/admin/boss-companion-relations?action=bind", {
  method: "POST",
  token,
  body: {
    action: "bind",
    bossId: picked.bossId,
    companionId: picked.companionId,
    remark: "live-smoke-bind",
  },
});
step("bind", bind.json?.ok === true, bind.json?.message || JSON.stringify(bind.json).slice(0, 240));

const hist1 = await api(
  "/api/admin/boss-companion-relations?action=history&companionId=" + encodeURIComponent(picked.companionId),
  { token }
);
step(
  "history_after_bind",
  (hist1.json?.events || []).some((e) => e.action === "bind"),
  `events=${(hist1.json?.events || []).length}`
);

if (picked.boss2Id) {
  const rebind = await api("/api/admin/boss-companion-relations?action=rebind", {
    method: "POST",
    token,
    body: {
      action: "rebind",
      companionId: picked.companionId,
      newBossId: picked.boss2Id,
      remark: "live-smoke-rebind",
    },
  });
  step("rebind", rebind.json?.ok === true, rebind.json?.message || JSON.stringify(rebind.json).slice(0, 240));
} else {
  step("rebind", true, "SKIPPED (only one boss available)");
}

const unbind = await api("/api/admin/boss-companion-relations?action=unbind", {
  method: "POST",
  token,
  body: { action: "unbind", companionId: picked.companionId, remark: "live-smoke-unbind" },
});
step("unbind", unbind.json?.ok === true, unbind.json?.message || "");

const hist2 = await api(
  "/api/admin/boss-companion-relations?action=history&companionId=" + encodeURIComponent(picked.companionId),
  { token }
);
const actions = (hist2.json?.events || []).map((e) => e.action);
step("history_append_only", actions.includes("bind") && actions.includes("unbind"), actions.join(","));

const failed = results.some((r) => r.result === "FAIL");
console.log(JSON.stringify({ ok: !failed, base: BASE, picked, results }, null, 2));
process.exit(failed ? 1 : 0);
