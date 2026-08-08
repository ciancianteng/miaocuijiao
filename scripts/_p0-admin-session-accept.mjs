/**
 * P0: Admin login once → all admin modules return 200 (not "请先登录").
 * Usage: node scripts/_p0-admin-session-accept.mjs
 */
const BASE = process.env.MCJ_STAGING_URL || "https://meow-cuijiao-homepage-staging.vercel.app";
const EMAIL = process.env.MCJ_ADMIN_EMAIL || "admin@meow.test";
const PASSWORD = process.env.MCJ_ADMIN_PASSWORD || "McjTest@12345678";

const MODULES = [
  { name: "Dashboard", path: "/api/admin/dashboard" },
  { name: "Banner", path: "/api/admin/banners" },
  { name: "公告", path: "/api/admin/content" },
  { name: "制度", path: "/api/admin/rules-hub" },
  { name: "更多玩法", path: "/api/admin/gameplay-products" },
  { name: "等级", path: "/api/admin/companion-levels" },
  { name: "支付设置", path: "/api/admin/payment-settings" },
  { name: "服务管理", path: "/api/admin/services" },
  { name: "订单管理", path: "/api/admin/orders" },
  { name: "财务中心", path: "/api/admin/finance" },
];

async function login() {
  const res = await fetch(`${BASE}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ action: "login", email: EMAIL, password: PASSWORD }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.ok || !body.session?.accessToken) {
    throw new Error(`login failed: ${body.message || res.status}`);
  }
  const role = body.session.user?.role || body.user?.role;
  if (!/admin|super_admin/i.test(String(role || ""))) {
    throw new Error(`not an admin role: ${role}`);
  }
  return body.session;
}

async function probe(session, mod) {
  const res = await fetch(`${BASE}${mod.path}`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${session.accessToken}`,
      "x-mcj-access-token": session.accessToken,
    },
  });
  const text = await res.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text.slice(0, 200) };
  }
  const msg = String(body.message || "");
  const unauth = /请先使用管理员账号登录|登录已失效|unauthorized|无权/i.test(msg);
  return {
    name: mod.name,
    status: res.status,
    ok: res.ok && body.ok !== false && !unauth,
    message: msg || (res.ok ? "ok" : `HTTP ${res.status}`),
  };
}

async function main() {
  console.log("BASE", BASE);
  const session = await login();
  console.log("login OK role=", session.user?.role, "tokenLen=", String(session.accessToken || "").length);

  const results = [];
  for (const mod of MODULES) {
    results.push(await probe(session, mod));
  }

  let fail = 0;
  for (const r of results) {
    const mark = r.ok ? "PASS" : "FAIL";
    if (!r.ok) fail += 1;
    console.log(`${mark}  ${r.name.padEnd(8)}  HTTP ${r.status}  ${r.message}`);
  }
  console.log(fail ? `\nFAIL ${fail}/${results.length}` : `\nPASS all ${results.length} modules`);
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error("ERROR", err.message || err);
  process.exit(1);
});
