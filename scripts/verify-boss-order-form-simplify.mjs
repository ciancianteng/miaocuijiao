/**
 * Offline checks for Boss order form simplify:
 * - no region/contact fields in place-order UI sources
 * - start/end time helpers + duration = hours * quantity
 * - companion confirm surfaces 老板游戏ID + 服务时段
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function pad2(n) {
  return (n < 10 ? "0" : "") + n;
}
function normalizeTimeValue(v) {
  const m = String(v || "")
    .trim()
    .match(/^(\d{1,2}):(\d{2})/);
  if (!m) return "";
  const h = Math.min(23, Math.max(0, Number(m[1]) || 0));
  const min = Math.min(59, Math.max(0, Number(m[2]) || 0));
  return pad2(h) + ":" + pad2(min);
}
function addHoursToTime(hhmm, hours) {
  const t = normalizeTimeValue(hhmm);
  if (!t) return "--:--";
  const parts = t.split(":");
  let totalMin = Number(parts[0]) * 60 + Number(parts[1]) + Math.round(Number(hours) * 60);
  totalMin = ((totalMin % (24 * 60)) + 24 * 60) % (24 * 60);
  return pad2(Math.floor(totalMin / 60)) + ":" + pad2(totalMin % 60);
}

const modal = read("src/place-order-modal.js");
const page = read("src/place-order-page.js");
const team = read("src/multi-companion-team.js");
const wb = read("src/companion-workbench.js");
const companionApi = read("server/api/companion.js");

for (const [name, src] of [
  ["place-order-modal.js", modal],
  ["place-order-page.js", page],
  ["multi-companion-team.js", team],
]) {
  assert(!/data-po-region|data-mcj-team-region/.test(src), `${name} still has region field`);
  assert(!/data-po-contact|data-mcj-team-contact/.test(src), `${name} still has contact field`);
  assert(
    /MCJTimePicker|data-po-start-time|data-mcj-team-start-time|type="time"/.test(src),
    `${name} missing time picker`
  );
  assert(/服务时段|预计结束|开始时间/.test(src), `${name} missing schedule label`);
  assert(/游戏ID/.test(src), `${name} missing 游戏ID`);
}

assert(/老板游戏ID/.test(wb), "companion-workbench missing 老板游戏ID");
assert(/serviceSchedule|服务时段/.test(wb), "companion-workbench missing schedule display");
assert(/serviceSchedule/.test(companionApi), "companion viewOrder missing serviceSchedule");
assert(/服务时段\[：:\]/.test(companionApi), "companion viewOrder missing schedule parse");

assert(addHoursToTime("21:00", 1) === "22:00", "1h end wrong");
assert(addHoursToTime("21:00", 2) === "23:00", "2h end wrong");
assert(addHoursToTime("23:30", 1) === "00:30", "midnight wrap wrong");
assert(addHoursToTime("21:00", 1 * 2) === "23:00", "hours*qty duration wrong");

console.log("PASS verify-boss-order-form-simplify");
