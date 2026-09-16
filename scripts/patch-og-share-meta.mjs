/**
 * Inject static Open Graph / Twitter share metadata into portal HTML.
 * Crawlers do not run JS — tags must be in the HTML file.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BEGIN,
  END,
  OG_IMAGE,
  FOUR_ENTRY_HTML,
  homepageTwitterAddon,
  upsertOgBlock,
} from "./lib/og-share-meta.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function walkHtml(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    const st = fs.statSync(abs);
    if (st.isDirectory()) walkHtml(abs, acc);
    else if (name.endsWith(".html")) acc.push(abs);
  }
  return acc;
}

function relOf(abs) {
  return path.relative(root, abs).replace(/\\/g, "/");
}

const extra = ["admin.html", "admin-center.html", "admin-dashboard.html", "admin-audit.html", "login.html"].map(
  (rel) => path.join(root, rel)
);

const files = [
  ...walkHtml(path.join(root, "companion")),
  ...walkHtml(path.join(root, "customer-service")),
  ...walkHtml(path.join(root, "admin")),
  ...extra.filter((abs) => fs.existsSync(abs)),
];

const seen = new Set();
const changed = [];

for (const abs of files) {
  const rel = relOf(abs);
  if (seen.has(rel)) continue;
  seen.add(rel);
  const before = fs.readFileSync(abs, "utf8");
  const after = upsertOgBlock(before, rel);
  if (after !== before) {
    fs.writeFileSync(abs, after);
    changed.push(rel);
  }
}

const indexAbs = path.join(root, "index.html");
let indexHtml = fs.readFileSync(indexAbs, "utf8");
if (!/twitter:image/i.test(indexHtml)) {
  const addon = homepageTwitterAddon();
  if (/og:image:alt[^>]*>/.test(indexHtml)) {
    indexHtml = indexHtml.replace(
      /(<meta property="og:image:alt"[^>]*>\s*)+$/m,
      (m) => `${m}\n${addon}\n`
    );
    // Last og:image:alt may not be at EOL-only; append after the second duplicate block.
  }
  if (!/twitter:image/i.test(indexHtml)) {
    indexHtml = indexHtml.replace(
      '<meta property="og:image:alt" content="妙脆角 MEOW CUI JIAO｜专业游戏陪玩">',
      '<meta property="og:image:alt" content="妙脆角 MEOW CUI JIAO｜专业游戏陪玩">\n' + addon
    );
  }
  fs.writeFileSync(indexAbs, indexHtml);
  changed.push("index.html");
}

if (!indexHtml.includes(OG_IMAGE) && !fs.readFileSync(indexAbs, "utf8").includes(OG_IMAGE)) {
  throw new Error("index.html missing production OG image");
}

console.log(
  JSON.stringify(
    {
      ogImage: OG_IMAGE,
      changed,
      fourEntries: FOUR_ENTRY_HTML.map((e) => e.rel),
      begin: BEGIN,
      end: END,
    },
    null,
    2
  )
);
