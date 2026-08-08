import { execSync } from "node:child_process";
import fs from "node:fs";

const corrupted = [
  "orders.html",
  "messages.html",
  "recharge.html",
  "profile.html",
  "companion-center.html",
];

for (const f of corrupted) {
  try {
    const buf = execSync(`git show HEAD:${f}`, {
      encoding: "buffer",
      maxBuffer: 20 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    fs.writeFileSync(f, buf);
    console.log("restored", f, buf.length);
  } catch (e) {
    console.log("restore-fail", f, e.message);
  }
}

const files = [
  "orders.html",
  "messages.html",
  "recharge.html",
  "profile.html",
  "companion-center.html",
  "favorites.html",
  "gifts.html",
  "order-confirm.html",
  "mine.html",
  "payment-confirm.html",
  "support.html",
  "index.html",
];

for (const f of files) {
  if (!fs.existsSync(f)) continue;
  let t = fs.readFileSync(f, "utf8");
  const before = t;
  t = t.replace(
    /portal-early-gate\.js\?v=[^"']+/g,
    "portal-early-gate.js?v=20260804authP0boss2"
  );
  t = t.replace(
    /boss-header\.js\?v=[^"']+/g,
    "boss-header.js?v=20260804authP0boss2"
  );
  if (
    ["gifts.html", "order-confirm.html", "favorites.html", "mine.html", "payment-confirm.html"].includes(
      f
    ) &&
    !/portal-early-gate/.test(t)
  ) {
    t = t.replace(
      /<head>/i,
      '<head>\n  <script src="/portal-early-gate.js?v=20260804authP0boss2"></script>'
    );
  }
  // support.html was rewritten intentionally — keep our empty shell version if present
  if (f === "support.html" && !/id="supportApp"/.test(t)) {
    console.log("WARN support.html unexpected");
  }
  if (t !== before) {
    fs.writeFileSync(f, t, "utf8");
    console.log("patched", f);
  } else {
    console.log("unchanged", f);
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(fs.readFileSync(f));
    console.log("utf8-ok", f);
  } catch (e) {
    console.log("utf8-BAD", f, e.message);
  }
}

// Re-apply support.html empty shell (may have been overwritten by restore? support not in corrupted list)
if (!fs.readFileSync("support.html", "utf8").includes('aria-busy="true"')) {
  console.log("support needs rewrite");
}
