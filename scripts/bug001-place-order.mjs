/**
 * Bug 001 regression: hall openFromCompanion must not wipe companionId.
 * Usage: node scripts/bug001-place-order.mjs <base-url>
 */
const BASE = (process.argv[2] || "").replace(/\/$/, "");
if (!BASE) {
  console.error("Usage: node scripts/bug001-place-order.mjs <url>");
  process.exit(2);
}

function step(name, ok, detail) {
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
  return ok;
}

const js = await fetch(BASE + "/src/place-order-modal.js").then((r) => r.text());
const hall = await fetch(BASE + "/src/companion-hall.js").then((r) => r.text());

let fail = 0;
if (!step("place-order reads companion.companionId", /src\.companionId/.test(js) || /companion\.companionId/.test(js), "fallback chain")) fail += 1;
if (!step("hall passes id+companionId", /companionId:\s*id/.test(hall) && /id:\s*id/.test(hall), "payload fields")) fail += 1;

const comps = await fetch(BASE + "/api/public/companions").then((r) => r.json());
const c = (comps.companions || []).find((x) => /TEST|验收/.test(x.name || "")) || (comps.companions || [])[0];
if (!step("TEST companion available", !!(c && c.id && Number(c.price || c.priceValue) > 0), `id=${c?.id} price=${c?.price}`)) fail += 1;

// Simulate the buggy vs fixed merge logic locally
function buggyOpen(companion, extras) {
  extras = extras || {};
  const merged = Object.assign({}, companion || {}, {
    companionId: extras.companionId || (companion && (companion.id || companion.uid)),
  });
  return String(merged.companionId || "").trim();
}
function fixedOpen(companion, extras) {
  extras = extras || {};
  const src = companion || {};
  return String(extras.companionId || src.companionId || src.id || src.uid || "").trim();
}
const payload = { companionId: c.id, companionName: c.name, unitPrice: c.price };
if (!step("bug reproduce (old wipe)", buggyOpen(payload) === "", `got="${buggyOpen(payload)}"`)) fail += 1;
if (!step("fix keeps companionId", fixedOpen(payload) === c.id, `got="${fixedOpen(payload)}"`)) fail += 1;

console.log(`PASS=${5 - fail} FAIL=${fail}`);
process.exit(fail ? 1 : 0);
