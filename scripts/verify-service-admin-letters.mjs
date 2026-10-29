import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const code = fs.readFileSync(new URL("../src/service-pinyin-order.js", import.meta.url), "utf8");
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const api = sandbox.MCJServicePinyinOrder;
assert.equal(api.initialOf("王者荣耀"), api.initialOf("王"));
assert.equal(api.initialOf("🎮王者荣耀"), api.initialOf("王者荣耀"));
assert.equal(api.initialOf("Valorant"), "V");
assert.equal(api.initialOf("123英雄联盟"), api.initialOf("英雄联盟"));
assert.equal(api.initialOf("无畏契约"), api.initialOf("无"));
assert.notEqual(api.initialOf("王者荣耀"), api.initialOf("英雄联盟"));
assert.equal(api.matchesQuery("王者荣耀", "wz"), true);
assert.equal(api.matchesQuery("Valorant", "v"), true);
assert.equal(api.matchesQuery("英雄联盟", "王"), false);

const manager = fs.readFileSync(new URL("../src/admin-service-manager.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../src/admin-service-manager.css", import.meta.url), "utf8");
assert.equal(manager.includes("svcEditDialog"), true);
assert.equal(manager.includes("有未保存的修改，确定关闭？"), true);
assert.equal(manager.includes("保存中…"), true);
assert.equal(manager.includes("data-svc-form-error"), true);
assert.equal(css.includes("flex:0 0 40px"), true);
assert.equal(css.includes("overflow-x:auto"), true);
assert.equal(css.includes("body.svc-dialog-lock"), true);
console.log("verify-service-admin-letters: PASS");
