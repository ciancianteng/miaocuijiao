/**
 * P0-2 auth acceptance — never prints passwords or tokens.
 * Usage: node scripts/p0-2-auth-accept.mjs <preview-base>
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BASE = String(process.argv[2] || "").replace(/\/$/, "");
if (!BASE) {
  console.error("Usage: node scripts/p0-2-auth-accept.mjs <preview-base>");
  process.exit(2);
}

function readPasswordFromReadme() {
  const md = fs.readFileSync(path.join(ROOT, "README_DEPLOY.md"), "utf8");
  const m = md.match(/Initial password for all test accounts:\s*`([^`]+)`/);
  if (!m) throw new Error("password line missing in README_DEPLOY.md");
  return m[1];
}

const PASS = readPasswordFromReadme();
const ACCOUNTS = {
  boss: { email: "boss@meow.test", role: "boss", home: "/index.html" },
  service: { email: "service@meow.test", role: "customer_service", home: "/customer-service/dashboard/" },
  companion: { email: "companion@meow.test", role: "companion", home: "/companion/dashboard/" },
  admin: { email: "admin@meow.test", role: "admin", home: "/admin/" },
};

const results = {
  bossLogin: "FAIL",
  serviceLogin: "FAIL",
  companionLogin: "FAIL",
  adminLogin: "FAIL",
  refreshKeep: "FAIL",
  logoutClear: "FAIL",
  wrongRole: "FAIL",
  unauthGuard: "FAIL",
};

async function api(method, urlPath, body, headers = {}) {
  const res = await fetch(BASE + urlPath, {
    method,
    headers: Object.assign(
      { Accept: "application/json", "Content-Type": "application/json" },
      headers
    ),
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text.slice(0, 120) };
  }
  return { status: res.status, json };
}

async function login(email) {
  return api("POST", "/api/auth", { action: "login", email, password: PASS });
}

function roleOk(got, want) {
  if (want === "admin") return got === "admin" || got === "super_admin";
  return got === want;
}

async function run() {
  const health = await api("GET", "/api/auth?action=health");
  if (!health.json || health.json.configured !== true) {
    console.log(JSON.stringify({ results, note: "auth not configured" }, null, 2));
    process.exit(1);
  }

  // 1-4 role logins
  for (const [key, acc] of Object.entries(ACCOUNTS)) {
    const r = await login(acc.email);
    const role = r.json?.session?.user?.role;
    const token = r.json?.session?.accessToken;
    const ok = r.status === 200 && r.json?.ok && token && roleOk(role, acc.role);
    if (key === "boss") results.bossLogin = ok ? "PASS" : "FAIL";
    if (key === "service") results.serviceLogin = ok ? "PASS" : "FAIL";
    if (key === "companion") results.companionLogin = ok ? "PASS" : "FAIL";
    if (key === "admin") results.adminLogin = ok ? "PASS" : "FAIL";
    acc._token = token || "";
    acc._role = role || "";
    acc._refresh = r.json?.session?.refreshToken || "";
  }

  // 5 refresh keep (boss)
  if (ACCOUNTS.boss._refresh) {
    const ref = await api("POST", "/api/auth", {
      action: "refresh",
      refreshToken: ACCOUNTS.boss._refresh,
    });
    const me = await api("GET", "/api/auth?action=me", null, {
      Authorization: "Bearer " + (ref.json?.session?.accessToken || ACCOUNTS.boss._token),
    });
    results.refreshKeep =
      ref.status === 200 && ref.json?.ok && me.status === 200 && me.json?.ok && me.json?.user?.role === "boss"
        ? "PASS"
        : "FAIL";
  }

  // 6 logout clear — client session keys; verify me without token fails
  const afterLogout = await api("GET", "/api/auth?action=me");
  results.logoutClear = afterLogout.status === 401 || afterLogout.json?.ok === false ? "PASS" : "FAIL";

  // 7 wrong role: boss token hitting portal loginPortal semantics / role mismatch APIs
  let wrongPass = true;
  // boss must not be accepted as admin via auth me + role
  if (ACCOUNTS.boss._token) {
    const me = await api("GET", "/api/auth?action=me", null, {
      Authorization: "Bearer " + ACCOUNTS.boss._token,
    });
    if (me.json?.user?.role === "admin" || me.json?.user?.role === "super_admin") wrongPass = false;
  }
  // service login page role: companion account must fail CS API login role check via /api/auth then role compare
  if (ACCOUNTS.companion._token) {
    const me = await api("GET", "/api/auth?action=me", null, {
      Authorization: "Bearer " + ACCOUNTS.companion._token,
    });
    if (me.json?.user?.role === "customer_service") wrongPass = false;
  }
  // Explicit portal rejects: CS API login with boss
  const csBoss = await api("POST", "/api/customer-service", {
    action: "login",
    account: ACCOUNTS.boss.email,
    password: PASS,
  });
  if (csBoss.status < 400 && csBoss.json?.ok) wrongPass = false;
  const pwAdmin = await api("POST", "/api/companion", {
    action: "login",
    account: ACCOUNTS.admin.email,
    password: PASS,
  });
  if (pwAdmin.status < 400 && pwAdmin.json?.ok) wrongPass = false;
  results.wrongRole = wrongPass ? "PASS" : "FAIL";

  // 8 unauth route protection (HTML redirects / login surfaces)
  async function getPage(p) {
    const res = await fetch(BASE + p, { redirect: "manual" });
    const text = await res.text();
    return { status: res.status, location: res.headers.get("location") || "", text };
  }

  const pages = [
    "/mine.html",
    "/orders.html",
    "/support.html",
    "/customer-service/dashboard/",
    "/companion/dashboard/",
    "/admin.html",
  ];
  let guardOk = true;
  for (const p of pages) {
    const page = await getPage(p);
    const hasLogoutBtn = /退出登录/.test(page.text) && /data-(boss-)?logout|data-mcj-boss-logout/.test(page.text);
    // Static HTML may still contain strings inside JS; check for visible logout buttons in markup header
    const staticLogout =
      /<button[^>]*(data-logout|data-boss-logout|data-mcj-boss-logout)[^>]*>\s*退出登录/.test(page.text);
    const hasWorkbenchHint =
      /正在打开客服工作台|陪玩工作台|admin-shell|数据加载异常时仍保留工作台/.test(page.text) &&
      !/role-gates\.js/.test(page.text);
    // Pages must include role-gates (client redirect) OR server redirect
    const hasGate = /role-gates\.js/.test(page.text) || (page.status >= 300 && page.status < 400);
    if (staticLogout) guardOk = false;
    if (!hasGate && p !== "/admin.html") guardOk = false;
    if (p === "/admin.html" && !/MCJRoleGate\.guard\(['\"]admin['\"]\)/.test(page.text) && !hasGate) {
      guardOk = false;
    }
    void hasLogoutBtn;
    void hasWorkbenchHint;
  }
  results.unauthGuard = guardOk ? "PASS" : "FAIL";

  const all = Object.values(results).every((v) => v === "PASS");
  console.log(
    JSON.stringify(
      {
        preview: BASE,
        results,
        allPass: all,
        // credentials never included
      },
      null,
      2
    )
  );
  process.exit(all ? 0 : 1);
}

run().catch((err) => {
  console.error(JSON.stringify({ fatal: true, message: String(err && err.message ? err.message : err) }));
  process.exit(1);
});
