/**
 * Production gift release bootstrap (DDL-safe + catalog seed).
 * Requires explicit env gates. No smoke orders / no fake wallets.
 *
 * ALLOW_PROD_SUPABASE_WRITE=1 CONFIRM_PROD_WRITE=I_UNDERSTAND_PROD_RISK \
 *   node scripts/apply-prod-gift-release-bootstrap.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { PRODUCTION_SUPABASE_REF, supabaseProjectRef } from "./lib/prod-guard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseEnv(p) {
  const o = {};
  if (!fs.existsSync(p)) return o;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    o[m[1]] = v;
  }
  return o;
}

const allow =
  process.env.ALLOW_PROD_SUPABASE_WRITE === "1" && process.env.CONFIRM_PROD_WRITE === "I_UNDERSTAND_PROD_RISK";
if (!allow) {
  console.error("REFUSE: set ALLOW_PROD_SUPABASE_WRITE=1 and CONFIRM_PROD_WRITE=I_UNDERSTAND_PROD_RISK");
  process.exit(2);
}

const fileEnv = {
  ...parseEnv(path.join(root, "../meow-cuijiao-homepage/.env.local")),
  ...parseEnv(path.join(root, ".env.local")),
};
const url = String(process.env.SUPABASE_URL || fileEnv.SUPABASE_URL || "").replace(/\/$/, "");
const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || fileEnv.SUPABASE_SERVICE_ROLE_KEY || "");
const dbUrl = String(process.env.DATABASE_URL || fileEnv.DATABASE_URL || process.env.PROD_DATABASE_URL || "").trim();
const ref = supabaseProjectRef(url);
if (ref !== PRODUCTION_SUPABASE_REF) {
  console.error("REFUSE: not Production supabase ref", ref);
  process.exit(3);
}

async function rest(table, qs, init = {}) {
  const r = await fetch(`${url}/rest/v1/${table}${qs || ""}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: init.method === "POST" ? "return=representation" : "return=minimal",
      ...(init.headers || {}),
    },
  });
  const text = await r.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: r.status, ok: r.ok, body };
}

// 1) Seed catalog if empty (product catalog, not smoke orders)
const gifts = await rest("gifts", "?select=id&enabled=eq.true&limit=5");
console.log("gifts_probe", gifts.status, Array.isArray(gifts.body) ? gifts.body.length : gifts.body);
if (gifts.ok && Array.isArray(gifts.body) && gifts.body.length === 0) {
  const seed = await rest("gifts", "", {
    method: "POST",
    body: JSON.stringify([
      { name: "小鱼干", cat_food_price: 20, enabled: true, featured: true, sort_order: 10, icon_url: "", animation_level: "normal" },
      { name: "猫罐头", cat_food_price: 50, enabled: true, featured: true, sort_order: 20, icon_url: "", animation_level: "normal" },
      { name: "皇冠", cat_food_price: 100, enabled: true, featured: false, sort_order: 30, icon_url: "", animation_level: "rare" },
    ]),
  });
  console.log("seed_gifts", seed.status, JSON.stringify(seed.body).slice(0, 300));
} else {
  console.log("seed_gifts skipped — catalog already has rows or probe failed");
}

// ensure gift_settings
const settings = await rest("gift_settings", "?id=eq.1&select=id,commission_rate");
console.log("gift_settings", settings.status, settings.body);
if (settings.ok && Array.isArray(settings.body) && !settings.body.length) {
  const ins = await rest("gift_settings", "", {
    method: "POST",
    body: JSON.stringify({ id: 1, commission_rate: 20 }),
  });
  console.log("seed_settings", ins.status, ins.body);
}

// 2) Optional DDL via DATABASE_URL (idempotent migrations)
if (dbUrl && !/SENSITIVE/i.test(dbUrl) && /jqfaknpmcnqwqvatrwgo|postgres\.jqfak/i.test(dbUrl)) {
  const sqlFiles = [
    path.join(root, "supabase/migrations/20260912_gift_orders_payment_review.sql"),
    path.join(root, "supabase/migrations/20260922_gift_withdraw_channels_sot.sql"),
  ];
  const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 20000 });
  await client.connect();
  try {
    for (const f of sqlFiles) {
      if (!fs.existsSync(f)) continue;
      const sql = fs.readFileSync(f, "utf8");
      console.log("apply", path.basename(f));
      await client.query(sql);
      console.log("ok", path.basename(f));
    }
  } finally {
    await client.end();
  }
} else {
  console.log("DDL_SKIP: no Production DATABASE_URL (catalog seed may still succeed)");
}

// 3) Re-probe catalog public API path via REST
const after = await rest("gifts", "?select=id,name,cat_food_price&enabled=eq.true&order=sort_order.asc&limit=10");
console.log("catalog_after", after.status, Array.isArray(after.body) ? after.body.map((g) => g.name) : after.body);

const wall = await rest("companion_gift_wall", "?select=companion_id,gift_name,total_quantity&limit=1");
console.log("wall_probe", wall.status, String(JSON.stringify(wall.body)).slice(0, 200));
