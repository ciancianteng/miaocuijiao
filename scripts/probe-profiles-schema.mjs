/**
 * Probe profiles schema (no secrets printed).
 * Usage: node scripts/probe-profiles-schema.mjs
 */
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function loadEnvFile(name) {
  const path = resolve(root, name);
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnvFile(".env.vercel.tmp");
loadEnvFile(".env.local");

const url = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
if (!url || !key) {
  console.log("FAIL missing env");
  process.exit(1);
}

const r = await fetch(`${url}/rest/v1/profiles?select=*&limit=1`, {
  headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
});
const text = await r.text();
if (!r.ok) {
  console.log("status", r.status);
  console.log("missing_boss_uid_hint", /boss_uid|Could not find|column/i.test(text));
  process.exit(0);
}
const row = JSON.parse(text)[0] || {};
const cols = Object.keys(row).sort();
console.log("columns", cols.join(","));
console.log("has_boss_uid", cols.includes("boss_uid"));
console.log("sample_boss_uid_empty", cols.includes("boss_uid") ? !row.boss_uid : "n/a");

const r2 = await fetch(`${url}/rest/v1/profiles?select=id,boss_uid&role=eq.boss&limit=3`, {
  headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
});
const t2 = await r2.text();
console.log("select_boss_uid_ok", r2.ok);
if (!r2.ok) console.log("select_boss_uid_err_kind", /boss_uid|Could not find/i.test(t2) ? "no_column" : "other");
else {
  const rows = JSON.parse(t2);
  console.log("boss_rows", rows.length);
  console.log("any_uid_set", rows.some((x) => !!x.boss_uid));
}
