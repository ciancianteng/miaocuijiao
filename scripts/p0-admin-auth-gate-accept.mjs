/**
 * P0: Admin center must require real admin auth.
 * Usage: node scripts/p0-admin-auth-gate-accept.mjs
 */
const BASE = (process.env.MCJ_STAGING_URL || "https://meow-cuijiao-homepage-staging.vercel.app").replace(/\/$/, "");
const PASS = process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const ACCOUNTS = {
  admin: "admin@meow.test",
  boss: "boss.final.1785714993009@meow.test",
  cs: "service.final.1785714993009@meow.test",
  companion: "companion.final.1785714993009@meow.test",
};

const rows = [];
function step(name, ok, detail = "") {
  rows.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "").slice(0, 300) });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
}
function tok(j) {
  return j?.session?.accessToken || j?.session?.token || j?.accessToken || j?.token || "";
}
async function api(path, token, body, method = "POST") {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok && json.ok !== false, status: res.status, json };
}

(async () => {
  console.log("STAGING", BASE);

  // Static HTML: no ungated demo dashboard content
  const dashHtml = await (await fetch(`${BASE}/admin-dashboard.html`, { cache: "no-store" })).text();
  step(
    "legacy_dashboard_no_public_stats",
    !/今日营业额|RM\s*3,?820|老板后台数据中心/.test(dashHtml) && /admin\/login|admin\.html/.test(dashHtml),
    "redirect-only, no demo stats"
  );

  const adminHtml = await (await fetch(`${BASE}/admin.html`, { cache: "no-store" })).text();
  step(
    "admin_html_has_early_gate",
    /portal-early-gate\.js/.test(adminHtml) && /MCJRoleGate.*guard\(["']admin["']\)/.test(adminHtml),
    "early gate + guard present"
  );
  step(
    "admin_html_hides_shell_until_auth",
    /data-mcj-auth-gate|data-admin-shell|admin-shell" hidden/.test(adminHtml),
    "shell hidden until verified"
  );

  const gateJs = await (await fetch(`${BASE}/portal-early-gate.js?v=check`, { cache: "no-store" })).text();
  const roleJs = await (await fetch(`${BASE}/src/role-gates.js?v=check`, { cache: "no-store" })).text();
  const suiteJs = await (await fetch(`${BASE}/src/admin-suite.js?v=check`, { cache: "no-store" })).text();
  step(
    "gate_requires_jwt_not_soft_only",
    /Soft session alone NEVER unlocks admin|hasValidAdminAccessToken|adminOkSoft[\s\S]{0,80}hasJwtOrRefresh/.test(
      gateJs + roleJs
    ),
    "JWT required"
  );
  step(
    "suite_denies_without_server_verify",
    /denyAdminToLogin|refreshAdminIdentityFromServer/.test(suiteJs) &&
      !/ensureValidToken\(\)\.then\(start\)\.catch\(function\(\)\{boot\(\)\}\)/.test(suiteJs),
    "no boot-without-token fallback"
  );

  // API: no token
  const noTok = await api("/api/admin/dashboard", null, null, "GET");
  step("api_no_token_401", noTok.status === 401 || /请先|登录/.test(String(noTok.json?.message || "")), noTok.json?.message || noTok.status);

  // Boss token rejected
  const bossLogin = await api("/api/auth", null, {
    action: "login",
    email: ACCOUNTS.boss,
    password: PASS,
    loginPortal: "boss",
  });
  const bossT = tok(bossLogin.json);
  const bossDash = await api("/api/admin/dashboard", bossT, null, "GET");
  step(
    "boss_token_forbidden",
    bossDash.status === 403 || /没有后台|权限|管理员/.test(String(bossDash.json?.message || "")),
    `${bossDash.status} ${bossDash.json?.message || ""}`
  );

  // Companion token rejected
  const compLogin = await api("/api/companion", null, {
    action: "login",
    account: ACCOUNTS.companion,
    password: PASS,
  });
  const compT = tok(compLogin.json);
  const compDash = await api("/api/admin/dashboard", compT, null, "GET");
  step(
    "companion_token_forbidden",
    compDash.status === 403 || compDash.status === 401 || /没有后台|权限|管理员|请先/.test(String(compDash.json?.message || "")),
    `${compDash.status} ${compDash.json?.message || ""}`
  );

  // CS token rejected
  const csLogin = await api("/api/customer-service", null, {
    action: "login",
    account: ACCOUNTS.cs,
    password: PASS,
  });
  const csT = tok(csLogin.json);
  const csDash = await api("/api/admin/dashboard", csT, null, "GET");
  step(
    "cs_token_forbidden",
    csDash.status === 403 || csDash.status === 401 || /没有后台|权限|管理员|请先/.test(String(csDash.json?.message || "")),
    `${csDash.status} ${csDash.json?.message || ""}`
  );

  // Admin login portal rejects boss via /api/auth role (client also rejects)
  const adminAsBoss = await api("/api/auth", null, {
    action: "login",
    email: ACCOUNTS.boss,
    password: PASS,
    loginPortal: "admin",
  });
  const bossRole = adminAsBoss.json?.session?.user?.role || adminAsBoss.json?.user?.role || "";
  step(
    "boss_login_not_admin_role",
    !/^(admin|super_admin)$/.test(String(bossRole)),
    `role=${bossRole}`
  );

  // Admin success
  const adminLogin = await api("/api/auth", null, {
    action: "login",
    email: ACCOUNTS.admin,
    password: PASS,
    loginPortal: "admin",
  });
  const adminT = tok(adminLogin.json);
  const adminRole = adminLogin.json?.session?.user?.role || "";
  step("admin_login_ok", !!adminT && /admin|super_admin/.test(String(adminRole)), `role=${adminRole}`);
  const adminDash = await api("/api/admin/dashboard", adminT, null, "GET");
  step("admin_dashboard_ok", adminDash.ok && adminDash.json?.stats != null, JSON.stringify(adminDash.json?.stats || {}).slice(0, 120));

  const pay = await api("/api/admin/payment-settings", adminT, null, "GET");
  step("admin_payment_settings_ok", pay.ok, pay.json?.message || "");

  const failed = rows.filter((r) => r.result === "FAIL");
  console.log(`\n=== SUMMARY PASS ${rows.length - failed.length}/${rows.length} ===`);
  if (failed.length) {
    failed.forEach((f) => console.log("FAIL", f.step, f.detail));
    process.exit(1);
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
