#!/usr/bin/env node
/** Offline checks for custom 24h time picker on PR #271. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function read(rel) {
  return readFileSync(path.join(root, rel), "utf8");
}

const results = [];
function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
    console.log("PASS ", name);
  } catch (e) {
    results.push({ name, ok: false, error: String(e.message || e) });
    console.error("FAIL ", name, e.message || e);
  }
}

test("no native time inputs in place-order UIs", () => {
  for (const f of [
    "src/place-order-modal.js",
    "src/place-order-page.js",
    "src/multi-companion-team.js",
  ]) {
    assert.doesNotMatch(read(f), /type=["']time["']/);
  }
});

test("mcj-time-picker script is included", () => {
  for (const f of [
    "companion-center.html",
    "place-order.html",
    "profile.html",
    "index.html",
    "ranking.html",
  ]) {
    assert.match(read(f), /mcj-time-picker\.js/);
  }
});

test("picker CSS has 24h wheel + time card", () => {
  const css = read("src/place-order-modal.css");
  assert.match(css, /\.mcj-tp-item\.is-active/);
  assert.match(css, /\.mcj-po-time-card/);
  assert.doesNotMatch(css, /\bAM\b|\bPM\b/);
});

test("normalize strips AM/PM to 24h", () => {
  const code = read("src/mcj-time-picker.js");
  const context = {
    window: {},
    document: {
      querySelectorAll: () => [],
      createElement: () => ({
        className: "",
        setAttribute() {},
        addEventListener() {},
        querySelectorAll: () => [],
        querySelector: () => null,
        style: {},
      }),
      body: { appendChild() {} },
      addEventListener() {},
      removeEventListener() {},
    },
  };
  vm.runInNewContext(code, context);
  const n = context.window.MCJTimePicker.normalize;
  assert.equal(n("21:00"), "21:00");
  assert.equal(n("09:00 PM"), "21:00");
  assert.equal(n("9:00 am"), "09:00");
  assert.equal(n("12:00 PM"), "12:00");
  assert.equal(n("12:00 AM"), "00:00");
});

test("schedule labels use en-dash", () => {
  assert.match(read("src/place-order-modal.js"), /" – "/);
  assert.match(read("src/place-order-page.js"), /" – "/);
  assert.match(read("src/multi-companion-team.js"), /" – "/);
});

test("companion formats schedule 24h", () => {
  assert.match(read("src/companion-workbench.js"), /formatSchedule24h/);
});

test("open picker uses minuteStep 60 (整点)", () => {
  assert.match(read("src/place-order-modal.js"), /minuteStep:\s*60/);
  assert.match(read("src/mcj-time-picker.js"), /MINUTE_STEP_DEFAULT\s*=\s*60/);
});

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
