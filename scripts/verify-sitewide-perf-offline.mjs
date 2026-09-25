/**
 * Offline sanity for MCJ SWR + companions cache helpers.
 * Run: node scripts/verify-sitewide-perf-offline.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadIife(rel) {
  const code = fs.readFileSync(path.join(root, rel), "utf8");
  const sandbox = { window: {}, console, Date, setTimeout, clearTimeout };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(code, sandbox, { filename: rel });
  return sandbox;
}

const swrBox = loadIife("src/mcj-swr.js");
assert.ok(swrBox.MCJSwr, "MCJSwr missing");
swrBox.MCJSwr.set("k", { a: 1 }, 50);
assert.equal(swrBox.MCJSwr.get("k").value.a, 1);
assert.equal(swrBox.MCJSwr.isFresh(swrBox.MCJSwr.get("k")), true);

const cacheBox = loadIife("src/mcj-companions-cache.js");
// MCJCompanionsCache needs MCJSwr on same global — reload both into one sandbox
const both = { window: {}, console, Date, setTimeout, clearTimeout, fetch: async () => ({ ok: true, json: async () => ({ ok: true, companions: [{ id: "1", name: "A" }] }) }) };
both.window = both;
both.globalThis = both;
vm.runInNewContext(fs.readFileSync(path.join(root, "src/mcj-swr.js"), "utf8"), both);
vm.runInNewContext(fs.readFileSync(path.join(root, "src/mcj-companions-cache.js"), "utf8"), both);
assert.ok(both.MCJCompanionsCache);
const pack = await both.MCJCompanionsCache.load({ limit: 80 });
assert.equal(pack.value.length, 1);
assert.equal(pack.fromCache, false);
const pack2 = await both.MCJCompanionsCache.load({ limit: 80 });
assert.equal(pack2.fromCache, true);

// Ensure home no longer loads full companion-application
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
assert.ok(!/companion-application\.js/.test(indexHtml), "home must not load companion-application.js");
assert.ok(/mcj-home-companion-entry\.js/.test(indexHtml), "home must load light companion entry");
assert.ok(/mcj-companions-cache\.js/.test(indexHtml));
assert.ok(/mcj-ui-feedback\.js/.test(indexHtml));

const hall = fs.readFileSync(path.join(root, "src/companion-hall.js"), "utf8");
assert.ok(/MCJCompanionsCache/.test(hall));
assert.ok(/Promise\.all\(\[hydrate/.test(hall) || /Promise\.all\(\[hydrate, readItems/.test(hall));

const api = fs.readFileSync(path.join(root, "server/api/public/companions.js"), "utf8");
assert.ok(/opts\.limit/.test(api));
assert.ok(/LIST_SELECT/.test(api));

console.log("PASS sitewide-perf offline checks");
