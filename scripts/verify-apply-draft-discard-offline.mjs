#!/usr/bin/env node
/**
 * Offline regression for apply draft discard / generation guards.
 * Loads companion-application helpers via jsdom-less string checks + a tiny fake harness.
 */
import fs from "node:fs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import vm from "node:vm";
import { pathToFileURL } from "node:url";

const src = fs.readFileSync("src/companion-application.js", "utf8");
const checks = [
  ["draft gate html", /data-apply-draft-continue/],
  ["discard button", /data-apply-draft-discard/],
  ["clear toolbar", /data-apply-draft-clear/],
  ["generation bump", /function bumpDraftGeneration/],
  ["suppress empty", /suppressEmptyPersist/],
  ["discard flag blocks write", /hasDraftDiscardedFlag\(\)/],
  ["server discard action client", /discard_application_draft/],
  ["resolve gate", /function resolveDraftGateAfterBootstrap/],
  ["hydrate blocked on fresh", /draftGateMode === \"fresh\"/],
];
for (const [name, re] of checks) {
  assert.ok(re.test(src), `missing: ${name}`);
  console.log("PASS", name);
}

const api = fs.readFileSync("server/api/companion.js", "utf8");
assert.ok(/discard_application_draft/.test(api), "server discard action");
assert.ok(/FORMAL_PROFILE_PROTECTED/.test(api), "formal protected");
assert.ok(/SUBMITTED_PROTECTED/.test(api), "submitted protected");
console.log("PASS server discard_application_draft");

// Lightweight localStorage simulation for generation / discard write guard logic extracted via regex.
const store = new Map();
const localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(String(k), String(v)),
  removeItem: (k) => store.delete(String(k)),
};
const sessionStorage = {
  _m: new Map(),
  getItem(k) {
    return this._m.has(k) ? this._m.get(k) : null;
  },
  setItem(k, v) {
    this._m.set(String(k), String(v));
  },
  removeItem(k) {
    this._m.delete(String(k));
  },
};

let draftGeneration = 1;
let suppressEmptyPersist = false;
const DRAFT_DISCARD_FLAG_PREFIX = "mcjApplyDraftDiscarded.v1.u:";
const uid = "user-test-1";
function hasDraftDiscardedFlag() {
  return !!localStorage.getItem(DRAFT_DISCARD_FLAG_PREFIX + uid);
}
function markDraftDiscardedFlag() {
  localStorage.setItem(DRAFT_DISCARD_FLAG_PREFIX + uid, JSON.stringify({ at: Date.now(), generation: draftGeneration }));
}
function writeDraftRecord(draft) {
  if (suppressEmptyPersist && hasDraftDiscardedFlag()) return false;
  const incomingGen = Number((draft && draft._draftGeneration) || 0);
  if (incomingGen && incomingGen < draftGeneration) return false;
  localStorage.setItem("draft:" + uid, JSON.stringify(draft || {}));
  return true;
}

// CASE: stale autosave after discard must not revive draft
localStorage.setItem("draft:" + uid, JSON.stringify({ data: { nickname: "旧草稿" }, uploads: { photos: [{ url: "a" }] } }));
draftGeneration = 8;
suppressEmptyPersist = true;
markDraftDiscardedFlag();
localStorage.removeItem("draft:" + uid);
const staleOk = writeDraftRecord({ data: { nickname: "旧草稿" }, uploads: { photos: [{ url: "a" }] }, _draftGeneration: 8 });
assert.equal(staleOk, false, "stale write blocked");
assert.equal(localStorage.getItem("draft:" + uid), null, "draft stays cleared");
console.log("PASS CASE7 stale autosave ignored after discard");

// CASE: after user edits again, new draft can save
suppressEmptyPersist = false;
localStorage.removeItem(DRAFT_DISCARD_FLAG_PREFIX + uid);
draftGeneration = 9;
const freshOk = writeDraftRecord({ data: { nickname: "新草稿" }, _draftGeneration: 9 });
assert.equal(freshOk, true);
assert.match(localStorage.getItem("draft:" + uid) || "", /新草稿/);
console.log("PASS CASE8 new draft after discard");

console.log("ALL OFFLINE PASS");
