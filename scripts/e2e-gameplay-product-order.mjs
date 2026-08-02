/**
 * Gameplay product detail → real order → visible to boss & CS
 * node scripts/e2e-gameplay-product-order.mjs --base=https://....vercel.app
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(root, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).replace(/^['"]|['"]$/g, "")];
    })
);
const SUPABASE_URL = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const ANON = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
const PASS = "McjTest@12345678";
const BASE = (process.argv.find((a) => a.startsWith("--base="))?.slice(7) || "").replace(/\/$/, "");
if (!BASE) throw new Error("need --base=");
if (/localhost|127\.0\.0\.1/i.test(BASE)) throw new Error("Preview only");

const results = {};
function set(id, status, note = "") {
  results[id] = { status, note: String(note || "").slice(0, 400) };
  console.log(`${String(status).padEnd(7)} ${id} ${note || ""}`);
}

async function auth(email) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASS }),
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error(`auth ${email}: ${JSON.stringify(j).slice(0, 200)}`);
  return j;
}

async function main() {
  // 1 home more-gameplays entry
  {
    const html = await (await fetch(`${BASE}/`)).text();
    set("T01_home_more_gameplays", /更多玩法/.test(html) && /more-gameplays\.html/.test(html) ? "PASS" : "FAIL");
  }
  // 2 list
  let product = null;
  {
    const list = await (await fetch(`${BASE}/api/platform/gameplay-products`)).json();
    const products = list.products || [];
    const junk = products.filter((p) => /test|preview|demo|mock|验收/i.test(String(p.name || "") + String(p.id || "")));
    product = products.find((p) => Number(p.price) > 0) || products[0] || null;
    set("T02_list_formal", products.length && !junk.length && product ? "PASS" : "FAIL", `count=${products.length} junk=${junk.length} id=${product && product.id}`);
  }
  // 3 detail page HTML
  {
    const page = await (await fetch(`${BASE}/gameplay-product.html?id=${encodeURIComponent(product.id)}`)).text();
    const ok =
      /gameplay-product-container|gameplay-product\.js|gameplay-product\.css/.test(page) &&
      !/\[TEST\]|P0-3 Preview|验收商品|测试玩法/.test(page);
    set("T03_detail_page", ok ? "PASS" : "FAIL");
  }
  // 4 API product detail
  {
    const detail = await (await fetch(`${BASE}/api/platform/gameplay-products?id=${encodeURIComponent(product.id)}`)).json();
    const p = detail.product;
    const pkgs = (p && p.packages) || [];
    set(
      "T04_detail_data",
      p && p.name && !/test|preview|demo|验收/i.test(p.name) && pkgs.length ? "PASS" : "FAIL",
      p ? `${p.name} pkgs=${pkgs.length}` : detail.message
    );
  }
  // 5-8 create order as boss
  const boss = await auth("boss@meow.test");
  const pkg = (product.packages && product.packages[0]) || { id: "default", name: "标准套餐", price: product.price, unit: product.pricingUnit };
  const qty = 2;
  const unitPrice = Number(pkg.price || product.price || 0);
  const total = Math.round(unitPrice * qty * 100) / 100;
  let orderId = "";
  let orderNo = "";
  {
    const start = new Date(Date.now() + 3600 * 1000).toISOString().slice(0, 16);
    const r = await fetch(`${BASE}/api/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${boss.access_token}`,
        "x-mcj-access-token": boss.access_token,
      },
      body: JSON.stringify({
        action: "create",
        order: {
          order_type: "gameplay_product",
          title: product.name,
          game: product.gamesText || product.category,
          serviceType: pkg.name || product.name,
          description: [
            "更多玩法商品：" + product.name,
            "商品ID：" + product.id,
            "套餐：" + (pkg.name || ""),
            "游戏ID：E2E-GAME-001",
            "区服：亚服",
            "数量：" + qty,
            "开始时间：" + start,
          ].join("\n"),
          notes: "e2e gameplay product",
          gameId: "E2E-GAME-001",
          server: "亚服",
          hours: qty,
          quantity: qty,
          unit_price: unitPrice,
          total_amount: total,
          gameplay_product_id: product.id,
          productId: product.id,
          packageId: pkg.id,
          paymentMethod: "tng",
          startTime: start,
        },
      }),
    });
    const body = await r.json();
    orderId = body.order?.id || "";
    orderNo = body.order?.orderNo || body.order?.order_no || body.order?.id || "";
    set("T05_create_order", r.ok && body.ok !== false && orderId ? "PASS" : "FAIL", body.message || orderNo);
  }
  // 9 boss orders list
  {
    const r = await fetch(`${BASE}/api/orders?action=list`, {
      headers: { Authorization: `Bearer ${boss.access_token}`, Accept: "application/json" },
    });
    const body = await r.json().catch(() => ({}));
    const orders = body.orders || body.data || [];
    const hit = orders.find((o) => String(o.id) === String(orderId) || String(o.orderNo || o.order_no) === String(orderNo));
    set("T06_boss_sees", hit ? "PASS" : "FAIL", `list=${orders.length}`);
  }
  // 10 CS sees
  {
    const cs = await auth("service@meow.test");
    const r = await fetch(`${BASE}/api/customer-service?action=bootstrap`, {
      headers: { Authorization: `Bearer ${cs.access_token}`, "x-mcj-service-token": cs.access_token, Accept: "application/json" },
    });
    const body = await r.json().catch(() => ({}));
    const orders = body.data?.orders || body.orders || [];
    const hit = orders.find((o) => String(o.id) === String(orderId) || String(o.orderNo || o.order_no || o.order_id) === String(orderNo));
    set("T07_cs_sees", hit || orders.length >= 0 ? (hit ? "PASS" : "FAIL") : "FAIL", hit ? "found" : `list=${orders.length}`);
  }

  console.log("\nORDER_NO", orderNo || orderId);
  console.log("PRODUCT", product.id, product.name);
  const failed = Object.entries(results).filter(([, v]) => v.status !== "PASS");
  console.log(`SUMMARY PASS ${Object.keys(results).length - failed.length}/${Object.keys(results).length}`);
  if (failed.length) {
    failed.forEach(([k, v]) => console.log("FAIL", k, v.note));
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
