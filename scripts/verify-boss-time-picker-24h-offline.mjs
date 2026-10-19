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

test("every page loading the picker JS also loads its CSS (else the wheel hides behind the order modal)", () => {
  for (const f of ["companion-center.html", "place-order.html", "profile.html", "index.html", "ranking.html", "companion-apply.html"]) {
    assert.match(read(f), /mcj-time-picker\.css/, f);
  }
});

test("picker self-injects CSS and pins its mask above order modals", () => {
  const js = read("src/mcj-time-picker.js");
  assert.match(js, /function ensureCss\(\)/);
  assert.match(js, /mask\.style\.zIndex\s*=\s*"100050"/);
  assert.match(js, /mask\.style\.position\s*=\s*"fixed"/);
});

test("offline / paused designated companion gets a visible reason before submit", () => {
  const js = read("src/place-order-modal.js");
  assert.match(js, /function companionUnavailableText\(\)/);
  assert.match(js, /data-po-avail-note/);
});

test("native datetime-local boss pages only offer future Malaysia times", () => {
  assert.match(read("src/mcj-datetime-min.js"), /Asia\/Kuala_Lumpur/);
  for (const f of ["custom-order.html", "fixed-order.html"]) assert.match(read(f), /mcj-datetime-min\.js/, f);
  assert.match(read("src/gameplay-product.js"), /min="' \+ esc\(minStartTime\(\)\)/);
});

test("picker CSS has 24h wheel + time card", () => {
  const wheel = read("src/mcj-time-picker.css");
  assert.match(wheel, /\.mcj-tp-item\.is-active/);
  assert.doesNotMatch(wheel, /\bAM\b|\bPM\b/);
  const po = read("src/place-order-modal.css");
  assert.match(po, /\.mcj-po-time-card/);
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

test("open picker uses every minute 00-59", () => {
  for (const f of ["src/place-order-modal.js", "src/place-order-page.js", "src/multi-companion-team.js"]) {
    assert.match(read(f), /minuteStep:\s*1/, f);
    assert.doesNotMatch(read(f), /minuteStep:\s*60/, f);
  }
  assert.match(read("src/mcj-time-picker.js"), /MINUTE_STEP_DEFAULT\s*=\s*1/);
  assert.match(read("src/mcj-time-picker.js"), /小时/);
  assert.match(read("src/mcj-time-picker.js"), /分钟/);
});

test("duration keeps minutes and labels the next day after midnight", () => {
  function addHoursToTime(hhmm, hours) {
    const [h, m] = hhmm.split(":").map(Number);
    let total = h * 60 + m + Math.round(Number(hours) * 60);
    total = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
    const hh = String(Math.floor(total / 60)).padStart(2, "0");
    const mm = String(total % 60).padStart(2, "0");
    return `${hh}:${mm}`;
  }
  function label(start, end) {
    const nextDay = end < start;
    return `${start} – ${nextDay ? "次日 " : ""}${end}`;
  }
  assert.equal(addHoursToTime("20:17", 1), "21:17");
  assert.equal(label("20:17", "21:17"), "20:17 – 21:17");
  assert.equal(addHoursToTime("22:35", 2), "00:35");
  assert.equal(label("22:35", "00:35"), "22:35 – 次日 00:35");
  assert.equal(addHoursToTime("23:58", 3), "02:58");
  assert.equal(label("23:58", "02:58"), "23:58 – 次日 02:58");
  assert.equal(addHoursToTime("23:59", 1), "00:59");
  assert.equal(addHoursToTime("00:01", 1), "01:01");
  for (const f of ["src/place-order-modal.js", "src/place-order-page.js", "src/multi-companion-team.js"]) {
    assert.match(read(f), /次日 /, f);
  }
  assert.match(read("src/companion-workbench.js"), /次日/);
  assert.match(read("server/api/admin/orders.js"), /服务时段/);
  assert.match(read("server/api/orders.js"), /serviceSchedule/);
});

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
