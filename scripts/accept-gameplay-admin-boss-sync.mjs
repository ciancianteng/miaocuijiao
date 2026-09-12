/**
 * E2E: Admin gameplay_products CRUD must sync to public boss mall.
 * node scripts/accept-gameplay-admin-boss-sync.mjs [--base=URL]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertSafeDbTarget, loadEnvFiles } from "./lib/prod-guard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnvFiles(root);
assertSafeDbTarget({ script: "accept-gameplay-admin-boss-sync.mjs" });

const BASE = (
  process.argv.find((a) => a.startsWith("--base="))?.slice(7) ||
  process.env.STAGING_URL ||
  "https://meow-cuijiao-homepage-staging.vercel.app"
).replace(/\/$/, "");

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@meow.test";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "McjTest@12345678";
const U = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const ANON = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";

const results = {
  base: BASE,
  adminUrl: `${BASE}/admin.html`,
  bossUrl: `${BASE}/more-gameplays.html`,
  table: "gameplay_products",
  checks: {},
  ok: false,
};

function set(key, pass, detail) {
  results.checks[key] = { pass: !!pass, detail: detail || "" };
  console.log(pass ? "PASS" : "FAIL", key, detail || "");
}

async function jsonFetch(url, init = {}) {
  const res = await fetch(url, init);
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  return { res, body, text };
}

async function adminLogin() {
  const { res, body } = await jsonFetch(`${U}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${ANON}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  if (!res.ok || !body?.access_token) {
    throw new Error(`admin login failed: ${res.status} ${JSON.stringify(body)}`);
  }
  return body.access_token;
}

async function adminApi(token, method, body) {
  const init = {
    method,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  };
  if (body) init.body = JSON.stringify(body);
  return jsonFetch(`${BASE}/api/admin/gameplay-products`, init);
}

async function publicList() {
  return jsonFetch(`${BASE}/api/platform/gameplay-products`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
}

async function waitForPublic(predicate, label, attempts = 8, delayMs = 400) {
  let last = null;
  for (let i = 0; i < attempts; i += 1) {
    const { body } = await publicList();
    last = body;
    if (predicate(body)) return body;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return last;
}

async function main() {
  const stamp = Date.now();
  const name = `AdminBoss Sync ${stamp}`;
  const edited = `${name} Edited`;
  let token = "";
  let productId = "";

  try {
    token = await adminLogin();
    set("admin_login", true, ADMIN_EMAIL);
  } catch (err) {
    set("admin_login", false, String(err.message || err));
    finish();
    return;
  }

  {
    const { res, body } = await publicList();
    const source = body?.source;
    const names = (body?.products || []).map((p) => p.name);
    const hasFormal = ["三角洲跑刀", "APEX 上分护航", "LOL 陪练", "语音陪聊"].every((n) => names.includes(n));
    set(
      "boss_source_supabase",
      res.ok && source === "supabase",
      `source=${source} count=${names.length}`
    );
    set("boss_shows_migrated_catalog", hasFormal, names.join(", "));
  }

  {
    const { res, body } = await adminApi(token, "GET");
    const names = (body?.products || []).map((p) => p.name);
    const hasFormal = ["三角洲跑刀", "APEX 上分护航", "LOL 陪练", "语音陪聊"].every((n) => names.includes(n));
    set(
      "admin_list_supabase",
      res.ok && body?.source === "supabase" && hasFormal,
      `source=${body?.source} count=${names.length}`
    );
  }

  {
    const { res, body } = await adminApi(token, "POST", {
      action: "save",
      product: {
        name,
        category: "娱乐",
        gameIds: ["无特定游戏"],
        gamesText: "无特定游戏",
        shortDescription: "admin boss sync create",
        description: "服务内容：后台同步创建\n服务流程：创建后老板端可见\n注意事项：脚本自动清理",
        rules: "请保持联系畅通",
        price: 88,
        pricingUnit: "每单",
        fixedPrice: true,
        status: "published",
        featured: false,
        sortOrder: 5,
        dispatchToCs: true,
        packages: [{ id: "std", name: "标准", price: 88, unit: "每单" }],
      },
    });
    productId = body?.product?.id || "";
    set("admin_create", res.ok && !!productId, productId || body?.message || "");
  }

  {
    const body = await waitForPublic(
      (b) => (b?.products || []).some((p) => p.id === productId || p.name === name)
    );
    const hit = (body?.products || []).find((p) => p.id === productId || p.name === name);
    set("boss_shows_created", !!hit && hit.name === name, hit ? hit.name : "missing");
  }

  {
    const { res, body } = await adminApi(token, "POST", {
      action: "save",
      product: {
        id: productId,
        name: edited,
        category: "娱乐",
        gameIds: ["无特定游戏"],
        gamesText: "无特定游戏",
        shortDescription: "admin boss sync edit",
        description: "服务内容：已改名改价",
        rules: "请保持联系畅通",
        price: 99,
        pricingUnit: "每小时",
        fixedPrice: true,
        status: "published",
        featured: true,
        sortOrder: 3,
        dispatchToCs: true,
        packages: [{ id: "std", name: "标准", price: 99, unit: "每小时" }],
      },
    });
    set("admin_edit", res.ok && body?.product?.name === edited, body?.product?.name || body?.message || "");
  }

  {
    const body = await waitForPublic(
      (b) => (b?.products || []).some((p) => p.id === productId && p.name === edited && Number(p.price) === 99)
    );
    const hit = (body?.products || []).find((p) => p.id === productId);
    set(
      "boss_shows_edited",
      !!hit && hit.name === edited && Number(hit.price) === 99,
      hit ? `${hit.name}/${hit.price}` : "missing"
    );
  }

  {
    const { res } = await adminApi(token, "POST", { action: "unpublish", id: productId });
    set("admin_unpublish", res.ok, "");
    const body = await waitForPublic((b) => !(b?.products || []).some((p) => p.id === productId));
    const hit = (body?.products || []).find((p) => p.id === productId);
    set("boss_hides_unpublished", !hit, hit ? hit.name : "hidden");
  }

  {
    const { res } = await adminApi(token, "POST", { action: "publish", id: productId });
    set("admin_republish", res.ok, "");
    const body = await waitForPublic((b) => (b?.products || []).some((p) => p.id === productId));
    const hit = (body?.products || []).find((p) => p.id === productId);
    set("boss_shows_republished", !!hit, hit ? hit.name : "missing");
  }

  {
    const { res } = await adminApi(token, "POST", { action: "delete", id: productId });
    set("admin_delete", res.ok, "");
    const body = await waitForPublic((b) => !(b?.products || []).some((p) => p.id === productId));
    const hit = (body?.products || []).find((p) => p.id === productId);
    set("boss_hides_deleted", !hit, hit ? hit.name : "gone");
  }

  finish();
}

function finish() {
  const values = Object.values(results.checks);
  results.ok = values.length > 0 && values.every((c) => c.pass);
  const out = path.join(root, "scripts/accept-gameplay-admin-boss-sync-results.json");
  fs.writeFileSync(out, JSON.stringify(results, null, 2));
  console.log(results.ok ? "OVERALL PASS" : "OVERALL FAIL");
  console.log("wrote", out);
  process.exit(results.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  set("fatal", false, String(err.message || err));
  finish();
});
