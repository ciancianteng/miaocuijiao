import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { packAppointmentText, unpackAppointmentText } from "../server/api/_appointment-text.js";

const packed = packAppointmentText("打排位，要开语音", "晚上安静一点");
const unpacked = unpackAppointmentText(packed);
assert.equal(unpacked.requirements, "打排位，要开语音");
assert.equal(unpacked.note, "晚上安静一点");
assert.ok(packed.length <= 500);
assert.equal(packed.includes("服务需求："), true);
assert.equal(packed.includes("\n备注："), true);

const plain = unpackAppointmentText("只要原来的订单要求");
assert.equal(plain.requirements, "只要原来的订单要求");
assert.equal(plain.note, "");

assert.equal(packAppointmentText("只有需求", "   "), "只有需求");

const companion = readFileSync(new URL("../companion-appointments.html", import.meta.url), "utf8");
const admin = readFileSync(new URL("../appointments-admin.html", import.meta.url), "utf8");
const book = readFileSync(new URL("../book.html", import.meta.url), "utf8");
for (const file of [companion, admin, book]) {
  assert.equal(file.includes("服务需求"), true);
  assert.equal(file.includes("备注"), true);
}
assert.equal(companion.includes("接受预约"), true);
assert.equal(companion.includes("拒绝预约"), true);
assert.equal(book.includes('id="req"'), true);
assert.equal(book.includes('id="note"'), true);
assert.equal(book.includes("#09070d"), true);
assert.equal(companion.includes("#ff6ea8"), true);

console.log("appointment text ok");
