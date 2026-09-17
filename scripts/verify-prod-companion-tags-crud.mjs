/**
 * Production companion_tags CRUD accept (service-role, mirrors admin store).
 * Requires human gates. Cleans up TEST tag at end.
 *
 *   ALLOW_PROD_SUPABASE_WRITE=1 CONFIRM_PROD_WRITE=I_UNDERSTAND_PROD_RISK \
 *   node scripts/verify-prod-companion-tags-crud.mjs
 */
import { loadEnvFiles, PRODUCTION_SUPABASE_REF, supabaseProjectRef } from "./lib/prod-guard.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnvFiles(root);
loadEnvFiles(process.cwd());
loadEnvFiles(path.resolve(root, "..", "meow-cuijiao-homepage"));

if (process.env.ALLOW_PROD_SUPABASE_WRITE !== "1") throw new Error("need ALLOW_PROD_SUPABASE_WRITE=1");
if (process.env.CONFIRM_PROD_WRITE !== "I_UNDERSTAND_PROD_RISK") throw new Error("need CONFIRM_PROD_WRITE");

const URL = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ref = supabaseProjectRef(URL);
if (ref !== PRODUCTION_SUPABASE_REF) throw new Error(`not prod ${ref}`);

const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

const TEST_ID = "tag-p0-test-20260915";
const TEST_NAME = "P0TEST标签20260915";
const TEST_NAME_EDIT = "P0TEST标签已编辑20260915";

async function rest(method, qs, body) {
  const r = await fetch(`${URL}/rest/v1/companion_tags${qs || ""}`, {
    method,
    headers: method === "GET" ? { apikey: KEY, Authorization: `Bearer ${KEY}` } : headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  let data = null;
  try {
    data = t ? JSON.parse(t) : null;
  } catch {
    data = t;
  }
  return { ok: r.ok, status: r.status, data };
}

const evidence = { at: new Date().toISOString(), ref, steps: {} };

const list1 = await rest("GET", "?select=id,name,tag_group,sort_order,is_enabled&order=sort_order.asc");
evidence.steps.read_after_migration = {
  ok: list1.ok,
  status: list1.status,
  count: Array.isArray(list1.data) ? list1.data.length : null,
  names: Array.isArray(list1.data) ? list1.data.map((r) => r.name) : list1.data,
};

// cleanup leftover
await rest("DELETE", `?id=eq.${encodeURIComponent(TEST_ID)}`);

const created = await rest("POST", "", {
  id: TEST_ID,
  name: TEST_NAME,
  tag_group: "其它",
  self_selectable: true,
  requires_audit: false,
  show_in_hall: true,
  supports_filter: true,
  sort_order: 999,
  is_enabled: true,
});
evidence.steps.create = { ok: created.ok, status: created.status, row: created.data };

const list2 = await rest("GET", `?id=eq.${encodeURIComponent(TEST_ID)}&select=*`);
evidence.steps.read_after_create = {
  ok: list2.ok && Array.isArray(list2.data) && list2.data[0]?.name === TEST_NAME,
  row: list2.data?.[0] || null,
};

const patched = await rest(
  "PATCH",
  `?id=eq.${encodeURIComponent(TEST_ID)}`,
  { name: TEST_NAME_EDIT, tag_group: "风格", sort_order: 998, updated_at: new Date().toISOString() }
);
evidence.steps.edit = { ok: patched.ok, status: patched.status, row: patched.data };

const list3 = await rest("GET", `?id=eq.${encodeURIComponent(TEST_ID)}&select=id,name,tag_group,sort_order`);
evidence.steps.read_after_edit = {
  ok: list3.ok && list3.data?.[0]?.name === TEST_NAME_EDIT,
  row: list3.data?.[0] || null,
};

const deleted = await rest("DELETE", `?id=eq.${encodeURIComponent(TEST_ID)}`);
evidence.steps.delete = { ok: deleted.ok, status: deleted.status };

const list4 = await rest("GET", `?id=eq.${encodeURIComponent(TEST_ID)}&select=id,name`);
evidence.steps.read_after_delete = {
  ok: list4.ok && Array.isArray(list4.data) && list4.data.length === 0,
  rows: list4.data,
};

const finalList = await rest("GET", "?select=id,name&order=sort_order.asc");
evidence.steps.final_seed_intact = {
  ok: finalList.ok && Array.isArray(finalList.data) && finalList.data.length === 10,
  count: Array.isArray(finalList.data) ? finalList.data.length : null,
  hasTestResidue: Array.isArray(finalList.data)
    ? finalList.data.some((r) => r.id === TEST_ID || String(r.name).includes("P0TEST"))
    : null,
  names: Array.isArray(finalList.data) ? finalList.data.map((r) => r.name) : null,
};

const pub = await fetch("https://www.meowcuijiao.com/api/platform/content?types=companion_tags", {
  headers: { Accept: "application/json" },
});
const pubBody = await pub.json();
const pubTags = pubBody?.byType?.companion_tags || [];
evidence.steps.public_api = {
  ok: pub.ok && pubTags.length >= 10,
  count: pubTags.length,
  sample: pubTags.slice(0, 3).map((t) => t.name),
};

evidence.pass = Boolean(
  evidence.steps.read_after_migration.ok &&
    evidence.steps.create.ok &&
    evidence.steps.read_after_create.ok &&
    evidence.steps.edit.ok &&
    evidence.steps.read_after_edit.ok &&
    evidence.steps.delete.ok &&
    evidence.steps.read_after_delete.ok &&
    evidence.steps.final_seed_intact.ok &&
    !evidence.steps.final_seed_intact.hasTestResidue
);

console.log(JSON.stringify(evidence, null, 2));
process.exit(evidence.pass ? 0 : 1);
