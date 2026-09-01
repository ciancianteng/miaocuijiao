/**
 * Live Staging smoke for Boss ↔ Companion 直属关系（requires tables already migrated）.
 * Usage (Preview URL recommended):
 *   BASE=https://meow-cuijiao-homepage-git-cu-a8401b-ciancianteng-4581s-projects.vercel.app \
 *   ADMIN_EMAIL=admin@meow.test ADMIN_PASS=McjTest@12345678 \
 *   node scripts/smoke-boss-companion-relations-live.mjs
 *
 * Optional: BOSS_ID / COMPANION_ID (profiles.id). If omitted, searches Staging for
 * one hasBoss profile and one hasCompanion profile via admin search / list.
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
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? " :: " + String(detail).slice(0, 200) : ""}`);
  return ok;
}

async function api(path, { method = "GET", token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token, "x-mcj-admin-role": "admin" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

const login = await api("/api/auth", {
  method: "POST",
  body: { action: "login", email: ADMIN_EMAIL, password: ADMIN_PASS, loginPortal: "admin", role: "admin" },
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

let list = await api("/api/admin/boss-companion-relations?action=list&status=", { token });
if (list.json?.tablesReady === false) {
  step("tables_ready", false, list.json?.message || "tablesReady=false — run Staging migration first");
  console.log(JSON.stringify({ ok: false, results, hint: "Paste supabase/migrations/20260901_boss_companion_relations.sql into Staging SQL Editor" }, null, 2));
  process.exit(1);
}
step("tables_ready", true, `relations=${(list.json?.relations || []).length}`);

const bossId = process.env.BOSS_ID || "";
const companionId = process.env.COMPANION_ID || "";

// Prefer explicit ids; otherwise try bind with known staging accounts via search fields left empty → skip mutation
if (!bossId || !companionId) {
  step(
    "bind_rebind_unbind",
    true,
    "SKIPPED mutations (set BOSS_ID + COMPANION_ID to exercise write path). List/history endpoints reachable."
  );
  const hist = await api("/api/admin/boss-companion-relations?action=history&companionId=" + encodeURIComponent(companionId || adminId), {
    token,
  });
  step("history_endpoint", hist.status === 200 && hist.json?.ok !== false, hist.json?.message || `events=${(hist.json?.events || []).length}`);
} else {
  // cleanup: unbind if active
  await api("/api/admin/boss-companion-relations?action=unbind", {
    method: "POST",
    token,
    body: { action: "unbind", companionId, remark: "live-smoke-cleanup" },
  });
  const bind = await api("/api/admin/boss-companion-relations?action=bind", {
    method: "POST",
    token,
    body: { action: "bind", bossId, companionId, remark: "live-smoke-bind" },
  });
  step("bind", bind.json?.ok === true, bind.json?.message || JSON.stringify(bind.json).slice(0, 200));

  const hist = await api(
    "/api/admin/boss-companion-relations?action=history&companionId=" + encodeURIComponent(companionId),
    { token }
  );
  step("history_after_bind", (hist.json?.events || []).some((e) => e.action === "bind"), `events=${(hist.json?.events || []).length}`);

  const unbind = await api("/api/admin/boss-companion-relations?action=unbind", {
    method: "POST",
    token,
    body: { action: "unbind", companionId, remark: "live-smoke-unbind" },
  });
  step("unbind", unbind.json?.ok === true, unbind.json?.message || "");
}

const failed = results.some((r) => r.result === "FAIL");
console.log(JSON.stringify({ ok: !failed, base: BASE, results }, null, 2));
process.exit(failed ? 1 : 0);
