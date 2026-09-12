#!/usr/bin/env node
/**
 * Static + optional live checks that all portal HTML shells ship PWA meta
 * and that manifest scope covers the whole site.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const skip = new Set(["node_modules", "dist", ".git", "tmp", "scripts", "assets", "checkpoints"]);
const need = [
  "apple-mobile-web-app-capable",
  "manifest",
  "pwa-boot.js",
  "theme-color",
  "mobile-web-app-capable",
];

const critical = [
  "index.html",
  "mine.html",
  "orders.html",
  "login.html",
  "admin.html",
  "admin/login/index.html",
  "companion/login/index.html",
  "companion/dashboard/index.html",
  "companion/earnings/index.html",
  "companion/order-hall/index.html",
  "companion/orders/index.html",
  "customer-service/login/index.html",
  "customer-service/dashboard/index.html",
  "customer-service/conversations/index.html",
  "customer-service/orders/index.html",
  "pwa-standalone-check.html",
];

const portalManifestByHtml = {
  "index.html": "/manifest.webmanifest",
  "mine.html": "/manifest.webmanifest",
  "orders.html": "/manifest.webmanifest",
  "login.html": "/manifest.webmanifest",
  "admin.html": "/manifest-admin.webmanifest",
  "admin/login/index.html": "/manifest-admin.webmanifest",
  "companion/login/index.html": "/manifest-companion.webmanifest",
  "companion/dashboard/index.html": "/manifest-companion.webmanifest",
  "companion/earnings/index.html": "/manifest-companion.webmanifest",
  "companion/order-hall/index.html": "/manifest-companion.webmanifest",
  "companion/orders/index.html": "/manifest-companion.webmanifest",
  "customer-service/login/index.html": "/manifest-cs.webmanifest",
  "customer-service/dashboard/index.html": "/manifest-cs.webmanifest",
  "customer-service/conversations/index.html": "/manifest-cs.webmanifest",
  "customer-service/orders/index.html": "/manifest-cs.webmanifest",
  "pwa-standalone-check.html": "/manifest.webmanifest",
};

function walkHtml(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(ent.name)) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkHtml(p, out);
    else if (ent.isFile() && ent.name.endsWith(".html")) out.push(p);
  }
  return out;
}

const failures = [];
for (const rel of critical) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) {
    failures.push(`${rel}: missing file`);
    continue;
  }
  const text = fs.readFileSync(abs, "utf8");
  for (const n of need) {
    if (!text.includes(n)) failures.push(`${rel}: missing ${n}`);
  }
  const expectedManifest = portalManifestByHtml[rel];
  if (expectedManifest && !text.includes(expectedManifest)) {
    failures.push(`${rel}: missing portal manifest ${expectedManifest}`);
  }
}

const allHtml = walkHtml(root).filter((p) => {
  const rel = path.relative(root, p);
  return !rel.split(path.sep).some((x) => skip.has(x));
});
let covered = 0;
for (const abs of allHtml) {
  const text = fs.readFileSync(abs, "utf8");
  if (need.every((n) => text.includes(n))) covered += 1;
}

const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.webmanifest"), "utf8"));
if (manifest.scope !== "/") failures.push("boss manifest.scope != /");
if (manifest.display !== "standalone") failures.push("manifest.display != standalone");
if (manifest.start_url !== "/" && !String(manifest.start_url).startsWith("/?")) {
  failures.push("boss manifest.start_url must be / (or /?…)");
}
if (!(manifest.id === "/" || String(manifest.id || "").includes("meowcuijiao.com"))) {
  failures.push("boss manifest.id should be / or https://www.meowcuijiao.com/");
}

const portalManifests = [
  ["manifest-companion.webmanifest", "/companion/"],
  ["manifest-cs.webmanifest", "/customer-service/"],
  ["manifest-admin.webmanifest", "/admin/"],
];
for (const [file, prefix] of portalManifests) {
  const abs = path.join(root, file);
  if (!fs.existsSync(abs)) {
    failures.push(`${file}: missing`);
    continue;
  }
  const m = JSON.parse(fs.readFileSync(abs, "utf8"));
  if (m.display !== "standalone") failures.push(`${file}: display != standalone`);
  if (!String(m.start_url || "").startsWith(prefix)) {
    failures.push(`${file}: start_url must start with ${prefix}`);
  }
  if (m.start_url === "/" || m.start_url === "/index.html") {
    failures.push(`${file}: start_url must not be boss home`);
  }
}
if (!fs.existsSync(path.join(root, "public/pwa-boot.js")) && !fs.existsSync(path.join(root, "pwa-boot.js"))) {
  failures.push("pwa-boot.js missing");
}
if (!fs.existsSync(path.join(root, "public/sw-mcj.js"))) failures.push("sw-mcj.js missing");

const report = {
  criticalChecked: critical.length,
  htmlCoveredWithFullMeta: covered,
  htmlTotalScanned: allHtml.length,
  manifest: {
    id: manifest.id,
    scope: manifest.scope,
    start_url: manifest.start_url,
    display: manifest.display,
    display_override: manifest.display_override || [],
  },
  failures,
  ok: failures.length === 0,
};
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exit(1);
console.log("PASS pwa standalone static verify");
