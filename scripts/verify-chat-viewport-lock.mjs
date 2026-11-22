import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fails = [];
function check(cond, msg) {
  if (!cond) fails.push(msg);
}

const css = fs.readFileSync(path.join(root, "src/customer-service-v2.css"), "utf8");
check(/html\.cs-chat-lock\s+\.cs-shell/.test(css), "CS CSS missing fixed shell lock");
check(/--cs-vv-top/.test(css), "CS CSS missing --cs-vv-top");
check(!/html\.cs-kb-open\s+\.cs-main\{\s*height:var\(--cs-vv-height/.test(css), "legacy vv-height-on-main kb path should be replaced");

const skin = fs.readFileSync(path.join(root, "src/mcj-chat-skin.css"), "utf8");
check(!/html\.cs-kb-open\s+\.cs-main\{height:100dvh/.test(skin), "mcj-chat-skin must not force 100dvh on kb-open");

const supportCss = fs.readFileSync(path.join(root, "src/support-chat.css"), "utf8");
check(/support-chat-lock/.test(supportCss), "boss support CSS missing chat lock");
check(/--support-vv-top/.test(supportCss), "boss support CSS missing vv top");

const js = fs.readFileSync(path.join(root, "src/customer-service-v2.js"), "utf8");
check(/applyVisualViewportCss/.test(js), "CS JS missing applyVisualViewportCss");
check(/cs-chat-lock/.test(js), "CS JS missing cs-chat-lock toggle");

const supportJs = fs.readFileSync(path.join(root, "src/support-chat.js"), "utf8");
check(/applyVisualViewportCss/.test(supportJs), "support JS missing applyVisualViewportCss");
check(/support-chat-lock/.test(supportJs), "support JS missing lock class");

const mod = await import(pathToFileURL(path.join(root, "src/scroll-keep.js")).href);
assert.equal(typeof mod.readVisualViewportBox, "function");
assert.equal(typeof mod.applyVisualViewportCss, "function");
assert.equal(typeof mod.isChatKeyboardOpen, "function");
assert.equal(mod.keyboardInsetPx({ innerHeight: 800, visualViewport: { height: 800, offsetTop: 0 } }), 0);
assert.equal(mod.keyboardInsetPx({ innerHeight: 800, visualViewport: { height: 420, offsetTop: 0 } }), 380);
assert.equal(mod.isChatKeyboardOpen({ lock: true, focused: true, inset: 0 }), true);
assert.equal(mod.isChatKeyboardOpen({ lock: true, focused: false, inset: 0 }), false);
assert.equal(mod.isChatKeyboardOpen({ lock: true, focused: false, inset: 300 }), true);

if (fails.length) {
  console.error("FAIL");
  fails.forEach((f) => console.error(" -", f));
  process.exit(1);
}
console.log("PASS verify-chat-viewport-lock");
