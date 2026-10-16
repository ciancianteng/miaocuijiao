import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { packAppointmentText, unpackAppointmentText } from "../server/api/_appointment-text.js";

const api = readFileSync(new URL("../server/api/appointments.js", import.meta.url), "utf8");
assert.equal(api.includes("boss_id: profile.id"), true);
assert.equal(api.includes("companion_id: companionId"), true);
assert.equal(api.includes("start_at: start.toISOString()"), true);
assert.equal(api.includes("end_at: end.toISOString()"), true);
assert.equal(api.includes("requirements: packAppointmentText"), true);
assert.equal(api.includes('status: "pending"'), true);
assert.equal(api.includes('charge_state: "none"'), true);
assert.equal(api.includes("order_id"), false);
assert.equal(api.includes("payment_status"), false);
assert.equal(api.includes("if (!isStaff(profile))"), true);
assert.equal(api.includes("String(row.companion_id) !== String(profile.id)"), true);
assert.equal(api.includes("charged: false"), true);
assert.equal(api.includes('STAFF_ROLES = new Set(["admin", "super_admin", "customer_service"])'), true);

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
assert.equal(companion.includes("预约设置"), false);
assert.equal(companion.includes("save_settings"), false);
assert.equal(companion.includes("repeat(4,minmax(0,1fr))"), true);
assert.equal(companion.includes("repeat(2,minmax(0,1fr))"), false);
assert.equal(companion.includes("grid-template-columns:1fr"), false);
assert.equal(companion.includes("查看详情"), true);
assert.equal(companion.includes("收起详情"), true);
assert.equal(companion.includes("正式订单"), true);
assert.equal(companion.includes("未扣款"), true);
assert.equal(companion.includes("老板"), true);
assert.equal(admin.includes("老板"), true);
assert.equal(admin.includes("陪玩"), true);
assert.equal(admin.includes("正式订单"), true);
assert.equal(admin.includes("未扣款"), true);
assert.equal(companion.includes("#F4A6C8"), true);
assert.equal(companion.includes("#ff6ea8"), false);
assert.equal(book.includes("#F4A6C8"), true);
assert.equal(book.includes("#ff6ea8"), false);
assert.equal(book.includes("#c46bff"), false);
assert.equal(admin.includes("#F4A6C8"), true);
for (const name of ["待确认预约","已确认预约","待老板确认支付","已拒绝预约","已取消预约","已完成预约","已过期","进行中"]) {
  assert.equal(companion.includes(name), true);
}

console.log("appointment text ok");
