#!/usr/bin/env node
/** Offline checks: companion apply custom time wheel (no native type=time). */
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

test("apply page does not render native type=time for online fields", () => {
  const js = read("src/companion-application.js");
  assert.match(js, /onlineTimeFieldsHtml/);
  assert.match(js, /MCJTimePicker\.applyFieldHtml|TP\.applyFieldHtml/);
  assert.doesNotMatch(js, /field\(\s*"onlineStart"\s*,\s*"[^"]*"\s*,\s*"time"/);
  assert.doesNotMatch(js, /field\(\s*"onlineEnd"\s*,\s*"[^"]*"\s*,\s*"time"/);
});

test("apply + place-order pages include shared picker assets", () => {
  for (const f of ["companion-apply.html", "place-order.html", "index.html", "companion-center.html"]) {
    const html = read(f);
    assert.match(html, /mcj-time-picker\.js/);
    assert.match(html, /mcj-time-picker\.css/);
  }
});

test("shared CSS has wheel + apply cards + no AM/PM", () => {
  const css = read("src/mcj-time-picker.css");
  assert.match(css, /\.mcj-tp-item\.is-active/);
  assert.match(css, /\.mcj-apply-time-card/);
  assert.match(css, /\.mcj-tp-sheet/);
  assert.doesNotMatch(css, /\bAM\b|\bPM\b/);
});

test("applyFieldHtml + normalize + minuteStep=1 supports 23:00 and 04:00", () => {
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
      body: { appendChild() {}, style: {} },
      documentElement: { style: {} },
      addEventListener() {},
      removeEventListener() {},
    },
  };
  vm.runInNewContext(code, context);
  const TP = context.window.MCJTimePicker;
  assert.equal(TP.normalize("23:00"), "23:00");
  assert.equal(TP.normalize("04:00"), "04:00");
  assert.equal(TP.normalize("4:00"), "04:00");
  const start = TP.applyFieldHtml({
    name: "onlineStart",
    label: "开始时间",
    icon: "🕐",
    value: "23:00",
    pickerTitle: "选择开始时间",
  });
  assert.match(start, /data-apply-time-open="onlineStart"/);
  assert.match(start, /type="hidden"/);
  assert.match(start, /value="23:00"/);
  assert.doesNotMatch(start, /type="time"/);
  assert.match(start, />23:00</);
  const empty = TP.applyFieldHtml({ name: "onlineEnd", label: "结束时间", value: "" });
  assert.match(empty, /选择时间/);
  assert.match(empty, /is-empty/);
});

test("no cross-midnight comparison validation in apply collect path", () => {
  const js = read("src/companion-application.js");
  assert.doesNotMatch(js, /onlineEnd\s*[<>=].*onlineStart|结束时间.*早于|must be after|end.*before.*start/i);
});

const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `\nFAILED ${failed.length}/${results.length}` : `\nALL PASS ${results.length}`);
process.exit(failed.length ? 1 : 0);
