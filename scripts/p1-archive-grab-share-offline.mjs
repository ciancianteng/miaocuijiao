/**
 * Offline + Staging read-only checks for:
 * - CS soft-archive (no hard delete)
 * - Grab share OG honesty (H5/OG preview, not claiming native WeChat JS-SDK)
 */
import fs from "node:fs";
import assert from "node:assert/strict";
import { assertSmokeTargetAllowed } from "./lib/prod-guard.mjs";

const BASE = (process.env.MCJ_STAGING_URL || "https://meow-cuijiao-homepage-staging.vercel.app").replace(/\/$/, "");
assertSmokeTargetAllowed({ script: "p1-archive-grab-share-offline", base: BASE });

const archive = fs.readFileSync("server/api/_cs-order-archive.js", "utf8");
const csApi = fs.readFileSync("server/api/customer-service.js", "utf8");
const csUi = fs.readFileSync("src/customer-service-v2.js", "utf8");
const grabMeta = fs.readFileSync("server/api/_grab-share-meta.js", "utf8");
const grabPreview = fs.readFileSync("server/api/grab-share-preview.js", "utf8");
const mw = fs.readFileSync("middleware.js", "utf8");

assert.match(archive, /CS_LIST_ARCHIVED/);
assert.match(archive, /Does NOT delete order rows/i);
assert.match(archive, /archiveCancelledOrder/);
assert.doesNotMatch(archive, /\.delete\(|from\(['\"]orders['\"]\)\.delete/i);
assert.match(csApi, /archive_cancelled_order/);
assert.match(csApi, /_cs-order-archive/);
assert.match(csUi, /archive_cancelled/);
assert.match(csUi, /不会删除数据库订单/);

assert.match(grabMeta, /抢单中/);
assert.match(grabMeta, /进入抢单/);
assert.match(grabMeta, /og:title|og:description|og:image/);
assert.match(grabPreview, /grabShareMetaBlock|buildGrabShareMeta/);
assert.match(mw, /\/g\/:id|grab-share-preview/);
// Must NOT claim WeChat JS-SDK native share without wx.config
assert.doesNotMatch(grabPreview, /wx\.config|jweixin|WeixinJSBridge\.invoke\(['\"]shareTimeline/);
assert.doesNotMatch(grabMeta, /wx\.config|jweixin/);

const live = await fetch(`${BASE}/api/grab-share-preview?id=00000000-0000-4000-8000-000000000001`).then((r) =>
  r.text()
);
assert.match(live, /og:title|property=\"og:title\"/i);
assert.match(live, /og:description|property=\"og:description\"/i);
assert.ok(!/wx\.config/.test(live), "live preview must not pretend wx.config native share");

const csLive = await fetch(`${BASE}/src/customer-service-v2.js?v=p1check`).then((r) => r.text());
assert.match(csLive, /archive_cancelled/);
assert.match(csLive, /\/g\//);

console.log("p1-archive-grab-share-offline: ALL PASS @", BASE);
console.log("NOTE: WeChat native card = OG/H5 preview only until official JS-SDK + verified domain are wired.");
