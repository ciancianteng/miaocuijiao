/**
 * Staging-only security smoke (read-mostly + auth denials).
 * Never targets Production. Never mutates balances.
 */
import assert from "node:assert/strict";
import { assertSmokeTargetAllowed, STAGING_SUPABASE_REF } from "./lib/prod-guard.mjs";

const BASE = (process.env.MCJ_STAGING_URL || "https://meow-cuijiao-homepage-staging.vercel.app").replace(/\/$/, "");
assertSmokeTargetAllowed({
  script: "p0-security-staging-read",
  base: BASE,
  supabaseUrl: `https://${STAGING_SUPABASE_REF}.supabase.co`,
});

const results = [];
function step(name, pass, detail = "") {
  results.push({ name, pass: !!pass, detail: String(detail || "") });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

async function jfetch(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { res, json, text };
}

const bi = await jfetch("/api/build-info");
step("build-info reachable", bi.res.ok && bi.json.ok !== false, bi.json.sha || bi.json.short || "");
step("staging supabase isolation", bi.json.supabaseIsStaging === true || bi.json.isolationOk === true, bi.json.supabaseRef || "");

const adminLevels = await jfetch("/api/admin/companion-levels");
step("admin companion-levels rejects anon", adminLevels.res.status === 401 || adminLevels.json.ok === false, String(adminLevels.res.status));

const adminMatrix = await jfetch("/api/admin/service-level-prices");
step("admin service-level-prices rejects anon", adminMatrix.res.status === 401 || adminMatrix.json.ok === false, String(adminMatrix.res.status));

const adminDelete = await jfetch("/api/admin/companion-levels", {
  method: "POST",
  body: JSON.stringify({ action: "delete", id: "lv1" }),
});
step("anon cannot delete lv1", adminDelete.res.status === 401 || adminDelete.json.ok === false, String(adminDelete.res.status));

const guestOrder = await jfetch("/api/orders?id=00000000-0000-4000-8000-000000000001");
step(
  "guest private order blocked or empty",
  guestOrder.res.status === 401 ||
    guestOrder.res.status === 403 ||
    guestOrder.res.status === 404 ||
    guestOrder.json.ok === false ||
    !guestOrder.json.order,
  String(guestOrder.res.status)
);

const grabPreview = await jfetch("/api/grab-share-preview?id=00000000-0000-4000-8000-000000000001");
const html = grabPreview.text || "";
step("grab OG endpoint returns HTML", /og:title|property=\"og:title\"/i.test(html), String(grabPreview.res.status));
step("grab OG has 抢单/进入", /抢单/.test(html) && /进入抢单|抢单中/.test(html), "");
step("grab OG no phone leak pattern", !/(1[3-9]\d{9}|bossPhone|game_id|payment_proof)/i.test(html), "");
step("grab OG no wx.config claim", !/wx\.config/.test(html), "");

const csJs = await (await fetch(`${BASE}/src/customer-service-v2.js?v=sec`)).text();
step("CS FE has grab hall route", /grab-hall|grabHall/.test(csJs), "");
step("CS FE keeps archive/complete", /archive_cancelled/.test(csJs) && /cs_confirm_complete/.test(csJs), "");

const matrixJs = await (await fetch(`${BASE}/src/admin-service-level-prices.js?v=sec`)).text();
step("admin matrix FE deployed", /service-level-prices|CLEAR_SERVICE_MATRIX/.test(matrixJs), "");

const failed = results.filter((r) => !r.pass);
console.log(`\nRESULT ${results.length - failed.length}/${results.length} PASS`);
if (failed.length) {
  console.error(failed);
  process.exit(1);
}
