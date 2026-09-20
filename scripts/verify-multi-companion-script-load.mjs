#!/usr/bin/env node
/**
 * Ensure every page that loads place-order-modal also loads multi-companion-team,
 * so「再加一位陪玩」can call window.MCJMultiCompanionTeam.add.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const htmlFiles = readdirSync(root).filter((f) => f.endsWith(".html"));

const offenders = [];
const covered = [];
for (const f of htmlFiles) {
  const html = readFileSync(path.join(root, f), "utf8");
  if (!/place-order-modal\.js/.test(html)) continue;
  if (!/multi-companion-team\.js/.test(html)) offenders.push(f);
  else covered.push(f);
}

assert.ok(
  covered.length > 0,
  "expected at least one page with both scripts"
);
assert.deepEqual(
  offenders,
  [],
  "pages with place-order-modal but missing multi-companion-team: " +
    offenders.join(", ")
);

const modal = readFileSync(path.join(root, "src/place-order-modal.js"), "utf8");
assert.match(modal, /MCJMultiCompanionTeam\.add/);
assert.match(modal, /再加一位陪玩/);

const team = readFileSync(path.join(root, "src/multi-companion-team.js"), "utf8");
assert.match(team, /window\.MCJMultiCompanionTeam\s*=/);
assert.match(team, /place_multi_order/);

console.log("PASS multi-companion script load coverage");
console.log("covered:", covered.join(", "));
