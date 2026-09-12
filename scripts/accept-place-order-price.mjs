/**
 * P0: approved companion → set/ensure price → boss place_order → order created with real unit_price.
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = process.cwd();
for (const f of [".env.local", ".env"]) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m || process.env[m[1]]) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const BASE = process.argv[2] || process.env.PREVIEW_URL || "";
if (!BASE) {
  console.error("Usage: node scripts/accept-place-order-price.mjs <preview-url>");
  process.exit(1);
}
const base = BASE.replace(/\/$/, "");
const PASS = process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";

async function api(pathname, { method = "GET", token = "", body } = {}) {
  const res = await fetch(`${base}${pathname}`, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(token
        ? { Authorization: `Bearer ${token}`, "x-mcj-access-token": token }
        : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { res, json };
}

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const companion = (
  await c.query(`
  select p.id, p.email, p.display_name, cp.price, cp.application_status, cp.companion_code
  from profiles p
  join companion_profiles cp on cp.user_id = p.id
  where p.role = 'companion' and cp.application_status = 'approved' and p.status = 'active'
  order by cp.updated_at desc nulls last
  limit 1
`)
).rows[0];

if (!companion) {
  console.error("FAIL: no approved companion in DB");
  process.exit(1);
}

// Ensure price is a real positive number in DB (simulate companion set price).
const ensuredPrice = Number(companion.price) > 0 ? Number(companion.price) : 32;
await c.query(`update companion_profiles set price = $1, updated_at = now() where user_id = $2`, [
  ensuredPrice,
  companion.id,
]);
console.log("companion", {
  id: companion.id,
  email: companion.email,
  name: companion.display_name,
  code: companion.companion_code,
  price: ensuredPrice,
  application_status: companion.application_status,
});

const bossEmail = "boss.final.1785714993009@meow.test";
let login = await api("/api/auth", {
  method: "POST",
  body: { action: "login", email: bossEmail, password: PASS },
});
if (!login.json?.ok) {
  // try register+login with disposable boss
  const ts = Date.now();
  const email = `boss.price.fix.${ts}@meow.test`;
  const reg = await api("/api/auth", {
    method: "POST",
    body: {
      action: "register",
      email,
      password: PASS,
      displayName: "PriceFixBoss",
      countryCode: "MY",
      dialCode: "+60",
      phone: `12${String(ts).slice(-8)}`,
      phoneE164: `+6012${String(ts).slice(-8)}`,
    },
  });
  if (!reg.json?.ok) {
    console.error("FAIL register boss", reg.json);
    process.exit(1);
  }
  login = await api("/api/auth", {
    method: "POST",
    body: { action: "login", email, password: PASS },
  });
}
if (!login.json?.ok) {
  console.error("FAIL boss login", login.json);
  process.exit(1);
}
const token = login.json.session?.accessToken || login.json.accessToken || "";
console.log("boss login ok");

// Public detail
const pub = await api(`/api/public/companions?id=${encodeURIComponent(companion.id)}`);
const pubC = (pub.json?.companions || [])[0];
console.log("public companion", {
  id: pubC?.id,
  price: pubC?.price,
  publicId: pubC?.publicId,
});

// Catalog
const cat = await api(`/api/boss/marketplace?action=catalog&companionId=${encodeURIComponent(companion.id)}`);
console.log("catalog", {
  ok: cat.json?.ok,
  price: cat.json?.companion?.price,
  services: (cat.json?.services || []).map((s) => ({ name: s.name, price: s.price })),
});

const place = await api("/api/orders", {
  method: "POST",
  token,
  body: {
    action: "place_order",
    companionId: companion.id,
    companionName: companion.display_name,
    serviceType: "陪玩",
    service: "陪玩",
    game: "陪玩",
    unitPrice: ensuredPrice,
    hours: 1,
    quantity: 1,
    totalAmount: ensuredPrice,
    gameId: "TEST-GAME-ID-001",
    schedule: "今晚8点",
    notes: "P0 price fix accept",
    paymentMethod: "tng",
    idempotencyKey: `price-fix-${Date.now()}`,
  },
});

console.log("place_order", {
  status: place.res.status,
  ok: place.json?.ok,
  message: place.json?.message,
  orderNo: place.json?.order?.orderNo || place.json?.order?.order_no,
  unitPrice: place.json?.order?.unitPrice ?? place.json?.order?.unit_price,
  total: place.json?.order?.totalAmount ?? place.json?.order?.total_amount,
});

if (!place.json?.ok) {
  console.error("FAIL place_order");
  process.exit(1);
}

const unit = Number(place.json.order?.unitPrice ?? place.json.order?.unit_price);
if (!(unit > 0) || Math.abs(unit - ensuredPrice) > 0.05) {
  console.error("FAIL unit price mismatch", unit, ensuredPrice);
  process.exit(1);
}

// Also try PW code path
if (companion.companion_code) {
  const place2 = await api("/api/orders", {
    method: "POST",
    token,
    body: {
      action: "place_order",
      companionId: companion.companion_code,
      companionName: companion.display_name,
      serviceType: "陪玩",
      game: "陪玩",
      unitPrice: ensuredPrice,
      hours: 1,
      quantity: 1,
      totalAmount: ensuredPrice,
      gameId: "TEST-GAME-ID-002",
      schedule: "今晚9点",
      paymentMethod: "tng",
      idempotencyKey: `price-fix-pw-${Date.now()}`,
    },
  });
  console.log("place_order by PW code", {
    status: place2.res.status,
    ok: place2.json?.ok,
    message: place2.json?.message,
    unitPrice: place2.json?.order?.unitPrice ?? place2.json?.order?.unit_price,
  });
  if (!place2.json?.ok) {
    console.error("FAIL place_order by companion_code");
    process.exit(1);
  }
}

await c.end();
console.log("PASS");
