import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const files = [
  "mine.html",
  "orders.html",
  "support.html",
  "recharge.html",
  "messages.html",
  "favorites.html",
  "profile.html",
  "payment-confirm.html",
  "order-confirm.html",
  "gifts.html",
  "companion-center.html",
  "index.html",
];
const VER = "20260804adminAuthP0";
for (const f of files) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) {
    console.log("missing", f);
    continue;
  }
  let t = fs.readFileSync(p, "utf8");
  const n = t.replace(/portal-early-gate\.js(\?v=[^"']+)?/g, `portal-early-gate.js?v=${VER}`);
  if (n !== t) {
    fs.writeFileSync(p, n, "utf8");
    console.log("bumped", f);
  } else {
    console.log("no-gate", f);
  }
}
