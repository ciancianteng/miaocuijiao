import fs from "fs";
import path from "path";

const roots = [
  "companion",
  "customer-service",
  "admin",
];

const extraFiles = [
  "admin.html",
  "customer-service.html",
  "gameplay-product.html",
  "more-gameplays.html",
  "orders.html",
  "companion-center.html",
  "support.html",
  "messages.html",
  "mine.html",
  "recharge.html",
  "companion-apply.html",
  "login.html",
];

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (ent.name.endsWith(".html")) out.push(p);
  }
  return out;
}

let files = [...extraFiles];
for (const r of roots) {
  if (fs.existsSync(r)) files = files.concat(walk(r));
}
files = [...new Set(files)].filter((f) => fs.existsSync(f));

const VP_OLD = 'content="width=device-width, initial-scale=1.0"';
const VP_NEW = 'content="width=device-width, initial-scale=1.0, viewport-fit=cover"';
const LINK = '<link rel="stylesheet" href="/src/mcj-safe-area.css?v=20260801safeArea">';

let vp = 0;
let link = 0;
for (const file of files) {
  let html = fs.readFileSync(file, "utf8");
  let changed = false;

  if (html.includes("viewport") && !html.includes("viewport-fit=cover")) {
    if (html.includes(VP_OLD)) {
      html = html.replace(VP_OLD, VP_NEW);
      changed = true;
      vp++;
    } else if (/name="viewport"[^>]*>/.test(html)) {
      html = html.replace(
        /(<meta\s+name="viewport"\s+content=")([^"]*)(")/i,
        (m, a, content, c) => {
          if (content.includes("viewport-fit")) return m;
          return `${a}${content.replace(/\s*$/, "")}, viewport-fit=cover${c}`;
        }
      );
      changed = true;
      vp++;
    }
  }

  const needsShell =
    /admin\.html$|customer-service|companion\\|companion\/|auth-shell|admin-layout|customer-service-v2|companion-workbench/.test(
      file.replace(/\\/g, "/")
    ) ||
    /admin\.html$|\/admin\/|customer-service|companion\//.test(file.replace(/\\/g, "/"));

  if (
    needsShell &&
    !html.includes("mcj-safe-area.css") &&
    html.includes("</head>")
  ) {
    html = html.replace("</head>", `  ${LINK}\n</head>`);
    changed = true;
    link++;
  }

  // Also inject on public pages that use boss header
  if (
    !html.includes("mcj-safe-area.css") &&
    (html.includes("boss-header") || html.includes("mcj-boss-header")) &&
    html.includes("</head>")
  ) {
    html = html.replace("</head>", `  ${LINK}\n</head>`);
    changed = true;
    link++;
  }

  if (changed) fs.writeFileSync(file, html);
}

// index already has viewport-fit; add link if missing
if (fs.existsSync("index.html")) {
  let html = fs.readFileSync("index.html", "utf8");
  if (!html.includes("mcj-safe-area.css") && html.includes("</head>")) {
    html = html.replace("</head>", `  ${LINK}\n</head>`);
    fs.writeFileSync("index.html", html);
    link++;
  }
}

console.log({ files: files.length, viewportUpdated: vp, linksAdded: link });
