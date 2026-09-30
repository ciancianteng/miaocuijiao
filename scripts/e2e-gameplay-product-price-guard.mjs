/**
 * Staging-only: gameplay product order create must use server-side package price.
 * node scripts/e2e-gameplay-product-price-guard.mjs --base=https://meow-cuijiao-homepage-staging.vercel.app
 *
 * Creates [E2E-PRICE-GUARD] orders as boss@meow.test and cancels every created order at the end.
 */
import { assertSmokeTargetAllowed } from "./lib/prod-guard.mjs";

const BASE = (
  process.argv.find((a) => a.startsWith("--base="))?.slice(7) || "https://meow-cuijiao-homepage-staging.vercel.app"
).replace(/\/$/, "");
assertSmokeTargetAllowed({ script: "e2e-gameplay-product-price-guard", base: BASE });

// Supabase URL + anon key come from the target deployment's public config, never from .env.local.
const publicCfg = await (await fetch(`${BASE}/api/public/realtime-config`, { cache: "no-store" })).json();
const SUPABASE_URL = String(publicCfg.url || "").replace(/\/$/, "");
const ANON = publicCfg.anonKey;
assertSmokeTargetAllowed({
  script: "e2e-gameplay-product-price-guard",
  base: BASE,
  supabaseUrl: SUPABASE_URL,
  requireStagingSupabase: true,
});
const PASS = process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const BOSS_EMAIL = process.env.MCJ_BOSS_EMAIL || "boss@meow.test";
const ADMIN_EMAIL = process.env.MCJ_ADMIN_EMAIL || "admin@meow.test";
const TAG = "[E2E-PRICE-GUARD]";

const results = [];
const createdIds = [];
function record(id, pass, note = "") {
  results.push({ id, status: pass === null ? "SKIP" : pass ? "PASS" : "FAIL", note: String(note).slice(0, 300) });
  console.log(`${(pass === null ? "SKIP" : pass ? "PASS" : "FAIL").padEnd(5)} ${id} ${note}`);
}

async function auth(email) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASS }),
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error(`auth ${email}: ${JSON.stringify(j).slice(0, 200)}`);
  return j.access_token;
}

async function ordersApi(token, body) {
  const r = await fetch(`${BASE}/api/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "x-mcj-access-token": token,
    },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (j?.order?.id && r.ok && j.ok !== false) createdIds.push(j.order.id);
  return { status: r.status, body: j };
}

/** Same payload shape as src/gameplay-product.js placeOrder(). */
function productOrder(product, pkg, qty, overrides = {}, descOverrides = {}) {
  const unit = pkg.unit || product.pricingUnit || "每单";
  const unitPrice = Number(pkg.price);
  const total = Math.round(unitPrice * qty * 100) / 100;
  const start = new Date(Date.now() + 3600 * 1000).toISOString().slice(0, 16);
  const desc = {
    title: `更多玩法商品：${product.name}`,
    productId: `商品ID：${product.id}`,
    pkg: `套餐：${pkg.name}`,
    qty: `数量：${qty} × ${unit}`,
    ...descOverrides,
  };
  return {
    action: "create",
    order: {
      order_type: "gameplay_product",
      title: product.name,
      game: product.gamesText || product.category || "更多玩法",
      serviceType: pkg.name,
      service_type: pkg.name,
      description: [desc.title, desc.productId, desc.pkg, `游戏ID：E2E-PRICE-GUARD`, desc.qty, `开始时间：${start}`, `备注：${TAG}`].join("\n"),
      notes: TAG,
      gameId: "E2E-PRICE-GUARD",
      game_id: "E2E-PRICE-GUARD",
      hours: qty,
      quantity: qty,
      unit_price: unitPrice,
      unitPrice,
      total_amount: total,
      totalAmount: total,
      pricingUnit: unit,
      gameplay_product_id: product.id,
      productId: product.id,
      packageId: pkg.id,
      packageName: pkg.name,
      discountAmount: 0,
      paymentMethod: "catfood",
      startTime: start,
      ...overrides,
    },
  };
}

async function adminProducts(token, body) {
  const r = await fetch(`${BASE}/api/admin/gameplay-products`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(`admin ${body.action}: ${r.status} ${j.message || ""}`);
  return j;
}

async function listOrderable() {
  const list = await (await fetch(`${BASE}/api/platform/gameplay-products`, { cache: "no-store" })).json();
  return (list.products || []).filter((p) => Array.isArray(p.packages) && p.packages.some((k) => Number(k.price) > 0));
}

let seededProductId = "";
let adminToken = "";
let bossToken = "";

async function main() {
  console.log(`BASE ${BASE}`);
  let products = await listOrderable();
  if (!products.length) {
    adminToken = await auth(ADMIN_EMAIL);
    const saved = await adminProducts(adminToken, {
      action: "save",
      product: {
        name: "跑刀一千万（E2E价格校验）",
        shortDescription: `${TAG} 临时商品，校验后删除`,
        description: `${TAG} Staging 价格校验临时商品`,
        category: "其他",
        price: 88,
        pricingUnit: "每单",
        packages: [
          { id: "e2e-1kw", name: "一千万", price: 88, unit: "每单" },
          { id: "e2e-3kw", name: "三千万", price: 230, unit: "每单" },
        ],
        commissionRate: 20,
        status: "published",
      },
    });
    seededProductId = saved.product?.id || "";
    console.log(`SEEDED product ${seededProductId}`);
    products = (await listOrderable()).filter((p) => String(p.id) === String(seededProductId));
  }
  if (!products.length) throw new Error("no orderable gameplay product on Staging");
  const multi = products.find((p) => new Set(p.packages.map((k) => Number(k.price))).size > 1);
  const product = multi || products[0];
  const pkgs = product.packages.filter((k) => Number(k.price) > 0).sort((a, b) => Number(a.price) - Number(b.price));
  const cheap = pkgs[0];
  const pricey = pkgs[pkgs.length - 1];
  const qty = 2;
  const expected = Math.round(Number(pricey.price) * qty * 100) / 100;
  console.log(`PRODUCT ${product.id} ${product.name} packages=${pkgs.map((k) => `${k.id}:${k.price}`).join(",")}`);

  const token = await auth(BOSS_EMAIL);
  bossToken = token;

  // T01 normal order → server price persisted
  {
    const r = await ordersApi(token, productOrder(product, pricey, qty));
    const o = r.body.order || {};
    record(
      "T01_normal_order_correct_price",
      r.status === 200 && Number(o.totalAmount) === expected && Number(o.unitPrice) === Number(pricey.price),
      `http=${r.status} total=${o.totalAmount} expected=${expected} unit=${o.unitPrice} ${r.body.message || ""}`
    );
    if (o.id) {
      const lr = await fetch(`${BASE}/api/orders?action=list`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      const lb = await lr.json().catch(() => ({}));
      const hit = (lb.orders || lb.data || []).find((x) => String(x.id) === String(o.id));
      record("T02_persisted_total_in_boss_list", !!hit && Number(hit.totalAmount) === expected, `list total=${hit && hit.totalAmount}`);
    }
  }

  // T03 manipulated total_amount → rejected, nothing created
  {
    const before = createdIds.length;
    const r = await ordersApi(token, productOrder(product, pricey, qty, { total_amount: 1, totalAmount: 1 }));
    record(
      "T03_tampered_total_rejected",
      r.status === 400 && r.body.code === "GAMEPLAY_PRICE_MISMATCH" && createdIds.length === before,
      `http=${r.status} code=${r.body.code} expected=${JSON.stringify(r.body.expected || {})}`
    );
  }

  // T04 manipulated unit price, no total → rejected
  {
    const r = await ordersApi(
      token,
      productOrder(product, pricey, qty, { unit_price: 0.01, unitPrice: 0.01, total_amount: undefined, totalAmount: undefined })
    );
    record("T04_tampered_unit_rejected", r.status === 400 && r.body.code === "GAMEPLAY_PRICE_MISMATCH", `http=${r.status} code=${r.body.code}`);
  }

  // T05 no client price at all → server fills correct amount
  {
    const r = await ordersApi(
      token,
      productOrder(product, pricey, qty, { unit_price: undefined, unitPrice: undefined, total_amount: undefined, totalAmount: undefined })
    );
    const o = r.body.order || {};
    record("T05_missing_price_replaced_by_server", r.status === 200 && Number(o.totalAmount) === expected, `http=${r.status} total=${o.totalAmount}`);
  }

  // T06 cheap package id but expensive package name/price claims → rejected
  if (cheap.id !== pricey.id && Number(cheap.price) !== Number(pricey.price)) {
    const r = await ordersApi(
      token,
      productOrder(product, cheap, qty, { packageName: pricey.name }, { pkg: `套餐：${pricey.name}` })
    );
    record("T06_package_label_spoof_rejected", r.status === 400 && r.body.code === "GAMEPLAY_PRICE_MISMATCH", `http=${r.status} code=${r.body.code}`);
  } else {
    record("T06_package_label_spoof_rejected", null, "product has a single price tier");
  }

  // T07 quantity line in description disagrees with quantity → rejected
  {
    const r = await ordersApi(token, productOrder(product, pricey, qty, {}, { qty: `数量：${qty + 8} × 每单` }));
    record("T07_quantity_spoof_rejected", r.status === 400 && r.body.code === "GAMEPLAY_PRICE_MISMATCH", `http=${r.status} code=${r.body.code}`);
  }

  // T08 unknown package id → rejected
  {
    const r = await ordersApi(token, productOrder(product, { ...pricey, id: "no-such-package" }, qty));
    record("T08_unknown_package_rejected", r.status === 409 && r.body.code === "GAMEPLAY_PACKAGE_CHANGED", `http=${r.status} code=${r.body.code}`);
  }

  // T09 unknown product id → rejected
  {
    const fake = { ...product, id: "no-such-product-e2e" };
    const r = await ordersApi(token, productOrder(fake, pricey, qty));
    record("T09_unknown_product_rejected", r.status === 404 && r.body.code === "GAMEPLAY_PRODUCT_UNAVAILABLE", `http=${r.status} code=${r.body.code}`);
  }

  // T10 gameplay order_type without product id → rejected
  {
    const r = await ordersApi(
      token,
      productOrder(product, pricey, qty, { gameplay_product_id: undefined, productId: undefined }, { productId: "" })
    );
    record("T10_missing_product_id_rejected", r.status === 400 && r.body.code === "GAMEPLAY_PRODUCT_REQUIRED", `http=${r.status} code=${r.body.code}`);
  }

  const failed = results.filter((r) => r.status === "FAIL");
  console.log(`\nSUMMARY PASS ${results.filter((r) => r.status === "PASS").length}/${results.length} (skip ${results.filter((r) => r.status === "SKIP").length})`);
  if (failed.length) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    for (const id of createdIds.splice(0)) {
      const r = await ordersApi(bossToken, { action: "cancel_order", id, reason: TAG });
      console.log(`cleanup cancel ${id} http=${r.status} ${r.body.code || r.body.message || ""}`);
    }
    if (!seededProductId) return;
    try {
      await adminProducts(adminToken, { action: "delete", id: seededProductId });
      console.log(`cleanup deleted seeded product ${seededProductId}`);
    } catch (e) {
      console.error(`cleanup FAILED for seeded product ${seededProductId}: ${e.message}`);
      process.exitCode = 1;
    }
  });
