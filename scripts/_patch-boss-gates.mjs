import fs from "node:fs";

const files = ["gifts.html", "order-confirm.html", "favorites.html"];
for (const f of files) {
  if (!fs.existsSync(f)) {
    console.log("missing", f);
    continue;
  }
  let t = fs.readFileSync(f, "utf8");
  if (!/portal-early-gate/.test(t)) {
    t = t.replace(
      /<head>/i,
      '<head>\n  <script src="/portal-early-gate.js?v=20260804authP0boss2"></script>'
    );
    fs.writeFileSync(f, t);
    console.log("added gate", f);
  } else {
    t = t.replace(
      /portal-early-gate\.js\?v=[^"']+/g,
      "portal-early-gate.js?v=20260804authP0boss2"
    );
    fs.writeFileSync(f, t);
    console.log("bumped", f);
  }
}
