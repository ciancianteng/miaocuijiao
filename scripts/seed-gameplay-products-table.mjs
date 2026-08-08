/**
 * Migrate formal more-gameplays catalog into public.gameplay_products.
 * Sources (in order): existing announcements [MCJ_GP]*, then DEFAULT_PRODUCTS.
 * Disables junk [TEST] announcement products. Never touches production.
 *
 * Usage: node scripts/seed-gameplay-products-table.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_PRODUCTS,
  toPublicProduct,
  toDbRow,
  isJunkGameplayProduct,
} from "../server/api/_gameplay-products-store.js";
import { assertSafeDbTarget, loadEnvFiles } from "./lib/prod-guard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnvFiles(root);
assertSafeDbTarget({ script: "seed-gameplay-products-table.mjs" });

const U = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const K = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!U || !K) {
  console.error("FAIL: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
  process.exit(1);
}

const h = {
  apikey: K,
  Authorization: `Bearer ${K}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

async function rest(pathAndQuery, init = {}) {
  const res = await fetch(`${U}/rest/v1/${pathAndQuery}`, { ...init, headers: { ...h, ...(init.headers || {}) } });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    throw new Error(`${pathAndQuery} → HTTP ${res.status}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
  }
  return body;
}

function fromAnnouncementContent(row) {
  try {
    const parsed = JSON.parse(row.content || "{}");
    if (!parsed || !parsed.name) return null;
    return toPublicProduct({
      ...parsed,
      id: parsed.id || undefined,
      status: parsed.status || "published",
    });
  } catch {
    return null;
  }
}

async function main() {
  const existing = await rest("gameplay_products?select=id,name,status,deleted_at&order=sort_order.asc");
  const byId = new Map((Array.isArray(existing) ? existing : []).map((r) => [String(r.id), r]));
  console.log("existing_rows", byId.size);

  const announcements = await rest(
    "announcements?select=id,title,content,is_active&title=like.*MCJ_GP*&order=updated_at.desc&limit=100"
  );
  const annRows = Array.isArray(announcements) ? announcements : [];

  const fromAnn = [];
  for (const row of annRows) {
    const title = String(row.title || "");
    const product = fromAnnouncementContent(row);
    const junk =
      isJunkGameplayProduct(product || { name: title, description: row.content }) ||
      /\[?\s*TEST\s*\]?|preview|demo|mock|验收|p03-test/i.test(title + " " + String(row.content || ""));
    if (junk) {
      if (row.is_active !== false) {
        await rest(`announcements?id=eq.${encodeURIComponent(row.id)}`, {
          method: "PATCH",
          body: JSON.stringify({ is_active: false, updated_at: new Date().toISOString() }),
        });
        console.log("disable_junk_ann", title);
      }
      continue;
    }
    if (product && !isJunkGameplayProduct(product)) fromAnn.push(product);
  }

  const catalog = [];
  const seen = new Set();
  for (const item of [...fromAnn, ...DEFAULT_PRODUCTS.map((p) => toPublicProduct(p))]) {
    const id = String(item.id || "").trim();
    if (!id || seen.has(id)) continue;
    if (isJunkGameplayProduct(item)) continue;
    seen.add(id);
    catalog.push(item);
  }

  let upserted = 0;
  for (const product of catalog) {
    const payload = toDbRow({
      ...product,
      status: product.status === "unpublished" || product.status === "draft" ? product.status : "published",
      deletedAt: null,
    });
    payload.deleted_at = null;
    const prior = byId.get(String(product.id));
    if (prior && prior.status === "deleted") {
      // Re-publish formal seed ids that were soft-deleted during tests.
      payload.status = "published";
    }
    if (prior) {
      await rest(`gameplay_products?id=eq.${encodeURIComponent(product.id)}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      console.log("update", product.id, product.name);
    } else {
      await rest("gameplay_products", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      console.log("insert", product.id, product.name);
    }
    upserted += 1;
  }

  // Soft-hide leftover active [MCJ_GP] announcements so platform never prefers them again.
  for (const row of annRows) {
    if (row.is_active === false) continue;
    if (!String(row.title || "").includes("[MCJ_GP]")) continue;
    await rest(`announcements?id=eq.${encodeURIComponent(row.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ is_active: false, updated_at: new Date().toISOString() }),
    });
    console.log("retire_ann", row.title);
  }

  const after = await rest(
    "gameplay_products?select=id,name,status&or=(deleted_at.is.null,status.neq.deleted)&order=sort_order.asc"
  );
  const published = (Array.isArray(after) ? after : []).filter((r) => r.status === "published");
  const result = {
    ok: true,
    upserted,
    published: published.map((r) => ({ id: r.id, name: r.name })),
    host: new URL(U).hostname,
  };
  fs.writeFileSync(path.join(root, "scripts/seed-gameplay-products-table-results.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
