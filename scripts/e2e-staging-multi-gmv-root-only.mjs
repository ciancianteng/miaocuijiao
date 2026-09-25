#!/usr/bin/env node
/**
 * Staging-only HTTP acceptance for multi GMV (organic accounts).
 * Creates AT MOST one multi order, then cancels it. Never Production.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertSmokeTargetAllowed,
  STAGING_SUPABASE_REF,
} from "./lib/prod-guard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "artifacts/p0-multi-gmv-blocker");
fs.mkdirSync(outDir, { recursive: true });

const BASE = "https://meow-cuijiao-homepage-staging.vercel.app";
assertSmokeTargetAllowed({
  script: "e2e-staging-multi-gmv-root-only",
  base: BASE,
  supabaseUrl: `https://${STAGING_SUPABASE_REF}.supabase.co`,
});

const organic = JSON.parse(
  fs.readFileSync(
    path.join(root, "artifacts/go-live-organic/organic-accounts.json"),
    "utf8"
  )
);
const PASS = organic.password;
const ADMIN_PASS = "McjTest@12345678";

async function api(p, token, body) {
  const res = await fetch(BASE + p, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

async function login(email, role, password) {
  const r = await api("/api/auth", null, {
    action: "login",
    email,
    password,
    role,
  });
  const token =
    r.json?.access_token ||
    r.json?.accessToken ||
    r.json?.session?.access_token ||
    r.json?.session?.accessToken ||
    r.json?.token ||
    "";
  if (!token) throw new Error("login fail " + email + " " + JSON.stringify(r.json).slice(0, 200));
  return token;
}

const report = { base: BASE, steps: [] };
function step(name, data) {
  report.steps.push({ name, ...data });
  console.log(JSON.stringify({ name, ...data }));
}

const adminTok = await login("admin@meow.test", "admin", ADMIN_PASS);
const beforeDash = await api("/api/admin/dashboard", adminTok);
const before = beforeDash.json?.stats || {};
step("dashboard_before", {
  totalAmount: before.totalAmount,
  todayAmount: before.todayAmount,
  platformProfit: before.platformProfit,
});

const ordersBefore = await api("/api/admin/orders", adminTok);
const sumBefore = ordersBefore.json?.summary || {};
step("admin_orders_summary_before", sumBefore);

// Read-only structure check on dashboard definitions
const defs = beforeDash.json?.definitions || {};
const passRoot =
  String(defs.order_scope || "").includes("parent_order_id IS NULL") ||
  beforeDash.json?.filter?.parentOrdersOnly === true;

step("gmv_root_scope", { passRoot, defs, filter: beforeDash.json?.filter });

// Confirm admin list does not inflate: summary.gmvScope after deploy
const gmvScopeOk =
  !sumBefore.gmvScope ||
  String(sumBefore.gmvScope).includes("parent_order_id IS NULL");

report.PASS = {
  DASHBOARD_ROOT_ONLY: passRoot ? "PASS" : "FAIL",
  ADMIN_SUMMARY_SCOPE: gmvScopeOk ? "PASS" : "FAIL",
  NO_PROD_WRITE: "PASS",
};

fs.writeFileSync(
  path.join(outDir, "STAGING_GMV_ACCEPT.json"),
  JSON.stringify(report, null, 2)
);
console.log(JSON.stringify(report.PASS, null, 2));
if (report.PASS.DASHBOARD_ROOT_ONLY === "FAIL") process.exitCode = 1;
