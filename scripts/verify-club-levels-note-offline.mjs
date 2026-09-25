import fs from "node:fs";
import assert from "node:assert/strict";

const js = fs.readFileSync("src/club-levels-page.js", "utf8");
const css = fs.readFileSync("src/club-levels.css", "utf8");
const html = fs.readFileSync("club-levels.html", "utf8");

assert.match(js, /本俱乐部说明/);
assert.match(js, /为什么妙脆角没有传统的陪玩考核/);
assert.match(js, /展开全文/);
assert.match(js, /收起/);
assert.match(js, /clubNoteModule/);
assert.match(js, /bindClubNote/);
assert.match(js, /clubNoteModule\(\)/);
assert.match(js, /data-club-note-toggle/);
assert.ok(js.indexOf("clubNoteModule()") < js.indexOf('club-levels-grid'), "note before grid");
assert.match(css, /\.club-levels-note-card/);
assert.match(css, /\.club-levels-note-toggle/);
assert.match(html, /20260926clubNote1/);
assert.doesNotMatch(js, /等级价格|commission_rate|withdraw/);
console.log("PASS club-levels note offline checks");
