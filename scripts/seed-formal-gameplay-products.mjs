/**
 * Disable [TEST] gameplay announcements and seed formal [MCJ_GP] catalog.
 * node scripts/seed-formal-gameplay-products.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { DEFAULT_PRODUCTS, toPublicProduct } from "../server/api/_gameplay-products-store.js";

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
const U = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const K = env.SUPABASE_SERVICE_ROLE_KEY;
const h = {
  apikey: K,
  Authorization: `Bearer ${K}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

async function main() {
  const listRes = await fetch(`${U}/rest/v1/announcements?select=id,title,is_active,content&order=updated_at.desc&limit=100`, {
    headers: h,
  });
  const rows = await listRes.json();
  if (!Array.isArray(rows)) throw new Error("announcements read failed: " + JSON.stringify(rows));

  const junk = rows.filter((r) => {
    const t = String(r.title || "");
    const c = String(r.content || "");
    return (
      t.includes("[MCJ_GP]") &&
      (/\[?\s*TEST\s*\]?|preview|demo|mock|验收|p03-test|default-avatar/i.test(t + " " + c) ||
        c.includes("p03-test-gameplay"))
    );
  });

  for (const row of junk) {
    const r = await fetch(`${U}/rest/v1/announcements?id=eq.${encodeURIComponent(row.id)}`, {
      method: "PATCH",
      headers: h,
      body: JSON.stringify({ is_active: false, updated_at: new Date().toISOString() }),
    });
    console.log("disable", row.title, r.status);
  }

  for (const raw of DEFAULT_PRODUCTS) {
    const product = toPublicProduct(raw);
    const title = `[MCJ_GP]${product.name}`;
    const existing = rows.find((r) => String(r.title || "") === title);
    const payload = {
      title,
      content: JSON.stringify(product),
      is_active: true,
      updated_at: new Date().toISOString(),
    };
    if (existing) {
      const r = await fetch(`${U}/rest/v1/announcements?id=eq.${encodeURIComponent(existing.id)}`, {
        method: "PATCH",
        headers: h,
        body: JSON.stringify(payload),
      });
      console.log("update", title, r.status);
    } else {
      const r = await fetch(`${U}/rest/v1/announcements`, {
        method: "POST",
        headers: h,
        body: JSON.stringify({
          ...payload,
          created_at: new Date().toISOString(),
        }),
      });
      console.log("insert", title, r.status, (await r.text()).slice(0, 160));
    }
  }
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
