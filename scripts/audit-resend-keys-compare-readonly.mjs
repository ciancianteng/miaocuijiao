#!/usr/bin/env node
/**
 * READ-ONLY: compare RESEND_API_KEY fingerprints across local env files.
 * Never prints full keys.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseEnv(p) {
  const o = {};
  if (!fs.existsSync(p)) return null;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    o[m[1]] = v;
  }
  return o;
}

function digest(k) {
  if (!k || k === "[SENSITIVE]") return { present: false };
  const t = String(k).trim();
  return {
    present: true,
    len: t.length,
    prefix: t.slice(0, 7),
    sha256_16: crypto.createHash("sha256").update(t).digest("hex").slice(0, 16),
  };
}

const paths = [
  ".env.staging.local",
  ".env.vercel.staging.pull",
  ".env.vercel.staging.resolve",
  ".env.local",
  ".env.production.local",
  "../meow-cuijiao-homepage/.env.local",
  "../meow-cuijiao-homepage/.env.production.local",
  "../meow-cuijiao-homepage/.env.staging.local",
];

const rows = [];
for (const rel of paths) {
  const abs = path.resolve(root, rel);
  const e = parseEnv(abs);
  if (!e) {
    rows.push({ path: rel, missing: true });
    continue;
  }
  let supabaseRef = "";
  try {
    supabaseRef = new URL(String(e.SUPABASE_URL || "")).hostname.split(".")[0] || "";
  } catch {
    supabaseRef = "";
  }
  rows.push({
    path: rel,
    supabaseRef,
    RESEND_API_KEY: digest(e.RESEND_API_KEY),
    RESEND_FROM: e.RESEND_FROM ? String(e.RESEND_FROM).slice(0, 60) : "",
    RESEND_ORDERS_FROM: e.RESEND_ORDERS_FROM ? String(e.RESEND_ORDERS_FROM).slice(0, 60) : "",
    RESEND_OTP_FROM: e.RESEND_OTP_FROM ? "set" : "unset",
  });
}

const byHash = new Map();
for (const r of rows) {
  const h = r.RESEND_API_KEY?.sha256_16;
  if (!h) continue;
  if (!byHash.has(h)) byHash.set(h, []);
  byHash.get(h).push(r.path);
}

const out = {
  ok: true,
  mode: "READ_ONLY",
  generated_at: new Date().toISOString(),
  rows,
  same_key_groups: [...byHash.entries()].map(([sha256_16, paths]) => ({ sha256_16, paths })),
  staging_prod_key_shared: [...byHash.values()].some(
    (ps) =>
      ps.some((p) => /staging/i.test(p)) &&
      ps.some((p) => /production|\.env\.local$/i.test(p) && !/staging/i.test(p))
  ),
};

const outPath = path.join(root, "artifacts/p0-multi-cs-confirm-notify/AUDIT_RESEND_KEY_COMPARE.json");
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(JSON.stringify({ wrote: outPath, groups: out.same_key_groups, shared: out.staging_prod_key_shared }, null, 2));
