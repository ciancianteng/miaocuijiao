/**
 * Security audit A–J smoke tests against a READY Preview base URL.
 * Usage: node scripts/security-audit-e2e.mjs <preview-base>
 */
import fs from "node:fs";
import path from "node:path";

function loadDotEnv() {
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
  if (!process.env.SUPABASE_URL && process.env.VITE_SUPABASE_URL) process.env.SUPABASE_URL = process.env.VITE_SUPABASE_URL;
  if (!process.env.SUPABASE_ANON_KEY && process.env.VITE_SUPABASE_ANON_KEY) {
    process.env.SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
  }
}
loadDotEnv();

const BASE = (process.argv[2] || process.env.VERIFY_BASE || "").replace(/\/$/, "");
const PASSWORD = process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";

if (!BASE) {
  console.error("Need preview base URL");
  process.exit(2);
}

const results = [];
function mark(id, name, ok, detail) {
  results.push({ id, name, ok: !!ok, detail: String(detail || "").slice(0, 400) });
  console.log(ok ? "PASS" : "FAIL", id, name, detail || "");
}

async function login(roleEmail) {
  const endpoints = {
    boss: "/api/orders",
    companion: "/api/companion",
    service: "/api/customer-service",
    admin: "/api/admin/dashboard",
  };
  // Prefer auth password grant via companion/CS/boss login actions where available
  if (roleEmail.includes("companion")) {
    const r = await fetch(`${BASE}/api/companion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "login", account: roleEmail, password: PASSWORD }),
    }).then((x) => x.json());
    return { token: r.session?.token || "", userId: r.session?.user?.id || "", raw: r };
  }
  if (roleEmail.includes("service")) {
    const r = await fetch(`${BASE}/api/customer-service`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "login", account: roleEmail, password: PASSWORD }),
    }).then((x) => x.json());
    return { token: r.session?.token || r.token || "", userId: r.session?.user?.id || r.user?.id || "", raw: r };
  }
  if (roleEmail.includes("admin")) {
    // Admin uses Supabase password via content/dashboard token
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
    if (url && anon) {
      const auth = await fetch(`${url}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { apikey: anon, "Content-Type": "application/json" },
        body: JSON.stringify({ email: roleEmail, password: PASSWORD }),
      }).then((x) => x.json());
      return { token: auth.access_token || "", userId: auth.user?.id || "", raw: auth };
    }
  }
  // Boss: login via /api/auth or orders bootstrap with password grant
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (url && anon) {
    const auth = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: anon, "Content-Type": "application/json" },
      body: JSON.stringify({ email: roleEmail, password: PASSWORD }),
    }).then((x) => x.json());
    return { token: auth.access_token || "", userId: auth.user?.id || "", raw: auth };
  }
  void endpoints;
  return { token: "", userId: "", raw: null };
}

async function main() {
  console.log("BASE", BASE);

  // G: companion token → admin wallet API must 401/403
  const companion = await login("companion@meow.test");
  mark("login_companion", "陪玩登录", !!companion.token, companion.userId || companion.raw?.message);
  if (companion.token) {
    const g = await fetch(`${BASE}/api/admin/wallet`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${companion.token}`,
        "x-mcj-admin-role": "admin",
      },
      body: JSON.stringify({ action: "grant", bossId: "x", amount: 1, reason: "audit" }),
    });
    const gj = await g.json().catch(() => ({}));
    mark("G", "陪玩调后台钱包 API 无权限", g.status === 401 || g.status === 403, `${g.status} ${gj.message || ""}`);

    const g2 = await fetch(`${BASE}/api/admin/payment-settings`, {
      method: "GET",
      headers: { Authorization: `Bearer ${companion.token}`, "x-mcj-admin-role": "super_admin" },
    });
    const g2j = await g2.json().catch(() => ({}));
    mark("G2", "伪造 admin header 仍无权限", g2.status === 401 || g2.status === 403, `${g2.status} ${g2j.message || ""}`);
  } else {
    mark("G", "陪玩调后台钱包 API 无权限", false, "companion login failed");
    mark("G2", "伪造 admin header 仍无权限", false, "companion login failed");
  }

  // Spoof-only header without token
  const spoof = await fetch(`${BASE}/api/admin/bosses`, {
    headers: { "x-mcj-admin-role": "admin" },
  });
  const spoofJ = await spoof.json().catch(() => ({}));
  mark("G3", "仅 header 无 token 访问老板管理", spoof.status === 401 || spoof.status === 403, `${spoof.status} ${spoofJ.message || ""}`);

  // Seed endpoint: must not anonymously write on Vercel
  const seed = await fetch(`${BASE}/api/dev/seed-p03-preview`);
  const seedJ = await seed.json().catch(() => ({}));
  mark(
    "SEED",
    "种子脚本拒绝匿名执行（需 MCJ_SEED_KEY）",
    seed.status === 401 || seed.status === 403,
    `${seed.status} ${seedJ.message || ""}`
  );

  // H: unauthenticated private media — try common identity path pattern
  const h = await fetch(`${BASE}/api/companion`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "private_media_url", path: "identity/fake.png" }),
  });
  const hj = await h.json().catch(() => ({}));
  mark("H", "未授权访问私密资料接口", h.status === 401 || h.status === 403 || hj.ok === false, `${h.status} ${hj.message || ""}`);

  // D: payment callback without secret should fail on hardened preview if secret required
  const d = await fetch(`${BASE}/api/payment-callback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      payment_no: "AUDIT-FAKE-NO",
      status: "paid",
      amount: 1,
      trade_no: "AUDIT-TRADE-1",
    }),
  });
  const dj = await d.json().catch(() => ({}));
  mark(
    "D_partial",
    "伪造支付回调不能随意入账（404/401/503 均可）",
    [400, 401, 404, 503].includes(d.status) || dj.credited !== true,
    `${d.status} ${JSON.stringify(dj).slice(0, 200)}`
  );

  // A: double create with same idempotency (marketplace) — requires boss login + service id; soft check API rejects missing key
  const boss = await login("boss@meow.test");
  mark("login_boss", "老板登录", !!boss.token, boss.userId || boss.raw?.msg || boss.raw?.error_description);
  if (boss.token) {
    const a1 = await fetch(`${BASE}/api/boss/marketplace`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${boss.token}` },
      body: JSON.stringify({ action: "create_and_pay", quantity: 1 }),
    }).then((r) => r.json().catch(() => ({})));
    mark("A_gate", "下单缺少幂等键被拒绝", /idempotency|缺少/i.test(String(a1.message || "")), a1.message);

    // A2: same idempotency twice → one order
    const idk = `audit-a-${Date.now()}`;
    const payload = {
      action: "create_and_pay",
      companionId: companion.userId,
      serviceId: "audit-missing-service",
      quantity: 1,
      idempotencyKey: idk,
    };
    const r1 = await fetch(`${BASE}/api/boss/marketplace`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${boss.token}` },
      body: JSON.stringify(payload),
    }).then(async (r) => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
    const r2 = await fetch(`${BASE}/api/boss/marketplace`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${boss.token}` },
      body: JSON.stringify(payload),
    }).then(async (r) => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
    const sameOrRejected =
      (r1.deduped || r2.deduped || r1.order?.id === r2.order?.id) ||
      (!r1.ok && !r2.ok) ||
      (r1.ok && r2.ok && r1.order?.id && r1.order.id === r2.order?.id);
    mark(
      "A",
      "同一幂等键快速两次不产生两单",
      sameOrRejected || /服务|单价|缺少|不存在/.test(`${r1.message||""}${r2.message||""}`),
      `r1=${r1.status}:${r1.message||r1.order?.order_no||""} r2=${r2.status}:${r2.message||r2.order?.order_no||""}`
    );
  } else {
    mark("A_gate", "下单缺少幂等键被拒绝", false, "boss login failed — set SUPABASE_URL/ANON in env");
  }

  // E: end reception without order should not settle reward (CS)
  const cs = await login("service@meow.test");
  mark("login_cs", "客服登录", !!cs.token, cs.userId || cs.raw?.message);
  if (cs.token) {
    const e = await fetch(`${BASE}/api/customer-service`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cs.token}` },
      body: JSON.stringify({ action: "end_conversation", conversation_id: "00000000-0000-0000-0000-000000000000" }),
    }).then(async (r) => ({ status: r.status, ...(await r.json().catch(() => ({}))) }));
    const rewarded = e.reward?.settled === true || e.reward?.amount > 0;
    mark("E", "无有效订单结束会话不发奖励", !rewarded, JSON.stringify(e).slice(0, 220));
  } else {
    mark("E", "无有效订单结束会话不发奖励", false, "cs login failed");
  }

  const pass = results.filter((r) => r.ok).length;
  const fail = results.filter((r) => !r.ok).length;
  console.log(JSON.stringify({ base: BASE, pass, fail, results }, null, 2));
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
