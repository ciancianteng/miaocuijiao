#!/usr/bin/env node
/**
 * Offline regression: 直属关系已下线（UI 无入口 + API/分成写入 gated）。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(path.join(root, p), "utf8");

const admin = read("admin.html");
assert.doesNotMatch(admin, /直属关系管理/);
assert.doesNotMatch(admin, /boss-companion-relations/);
assert.doesNotMatch(admin, /admin-boss-companion-relations/);

const mine = read("mine.html");
assert.doesNotMatch(mine, /my-direct-companions/);
assert.doesNotMatch(mine, /direct-companions/);
assert.doesNotMatch(mine, /直属/);

const bossActions = read("src/boss-center-actions.js");
assert.doesNotMatch(bossActions, /my-direct-companions/);
assert.doesNotMatch(bossActions, /直属/);

const suite = read("src/admin-suite.js");
assert.doesNotMatch(suite, /直属陪返点/);
assert.doesNotMatch(suite, /\['直属返点'/);
assert.doesNotMatch(suite, /boss-companion-relations/);
assert.doesNotMatch(suite, /playerFormField\('直属/);

const playerDetail = read("src/admin-player-detail.js");
assert.doesNotMatch(playerDetail, /直属陪返点/);

const workbench = read("src/companion-workbench.js");
assert.match(workbench, /直属关系已下线/);
assert.match(workbench, /mount\.remove\(\)|return;/);

const flags = read("server/api/_feature-flags.js");
assert.match(flags, /function isBossDirectRelationsEnabled/);
// default false when env unset
assert.match(flags, /return false;/);

const commission = read("server/api/_boss-commission.js");
assert.match(commission, /if \(!isBossDirectRelationsEnabled\(\)\)/);

for (const p of [
  "server/api/companion/direct-boss.js",
  "server/api/boss/direct-companions.js",
  "server/api/boss/commission-earnings.js",
  "server/api/admin/boss-companion-relations.js",
]) {
  const src = read(p);
  assert.match(src, /410|BOSS_DIRECT_RELATIONS_RETIRED|isBossDirectRelationsEnabled/);
}

console.log("PASS verify-direct-relations-retired-offline");
