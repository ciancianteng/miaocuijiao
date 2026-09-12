/**
 * Verify per-portal PWA manifests + HTML wiring (PR #234).
 * Fails if any portal still points start_url at boss home incorrectly.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function readJson(rel) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) {
    failures.push("missing " + rel);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch (e) {
    failures.push("invalid JSON " + rel + ": " + e.message);
    return null;
  }
}

function assertManifest(rel, expect) {
  const m = readJson(rel);
  if (!m) return;
  const pub = readJson("public/" + path.basename(rel));
  if (pub) {
    if (pub.start_url !== m.start_url) failures.push(rel + " != public twin start_url");
    if (pub.id !== m.id) failures.push(rel + " != public twin id");
  } else {
    failures.push("missing public twin for " + rel);
  }
  if (m.display !== "standalone") failures.push(rel + " display != standalone");
  if (!m.start_url || !String(m.start_url).startsWith(expect.startPrefix)) {
    failures.push(rel + " start_url expected prefix " + expect.startPrefix + " got " + m.start_url);
  }
  if (expect.forbidRootStart && (m.start_url === "/" || m.start_url === "/index.html")) {
    failures.push(rel + " must not use boss start_url /");
  }
  if (!Array.isArray(m.icons) || m.icons.length < 2) failures.push(rel + " needs icons");
  const has192 = m.icons.some((i) => String(i.sizes || "").includes("192"));
  const has512 = m.icons.some((i) => String(i.sizes || "").includes("512"));
  if (!has192 || !has512) failures.push(rel + " needs 192 + 512 icons");
}

assertManifest("manifest.webmanifest", { startPrefix: "/", forbidRootStart: false });
assertManifest("manifest-companion.webmanifest", { startPrefix: "/companion/", forbidRootStart: true });
assertManifest("manifest-cs.webmanifest", { startPrefix: "/customer-service/", forbidRootStart: true });
assertManifest("manifest-admin.webmanifest", { startPrefix: "/admin/", forbidRootStart: true });

const boss = readJson("manifest.webmanifest");
const companion = readJson("manifest-companion.webmanifest");
const cs = readJson("manifest-cs.webmanifest");
const admin = readJson("manifest-admin.webmanifest");
if (boss && companion && cs && admin) {
  const starts = [boss.start_url, companion.start_url, cs.start_url, admin.start_url];
  if (new Set(starts).size !== 4) failures.push("start_url values must be unique across 4 portals");
  const ids = [boss.id, companion.id, cs.id, admin.id];
  if (new Set(ids).size !== 4) failures.push("manifest id values must be unique across 4 portals");
}

function htmlHasManifest(rel, needle) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) {
    failures.push("missing html " + rel);
    return;
  }
  const html = fs.readFileSync(abs, "utf8");
  if (!html.includes(needle)) failures.push(rel + " missing " + needle);
  // Must not also hard-pin boss manifest on non-boss portals (static).
  if (needle !== "/manifest.webmanifest" && /href=["']\/manifest\.webmanifest["']/.test(html)) {
    failures.push(rel + " still hardcodes boss /manifest.webmanifest");
  }
}

htmlHasManifest("index.html", "/manifest.webmanifest");
htmlHasManifest("companion/index.html", "/manifest-companion.webmanifest");
htmlHasManifest("companion/login/index.html", "/manifest-companion.webmanifest");
htmlHasManifest("customer-service/index.html", "/manifest-cs.webmanifest");
htmlHasManifest("customer-service/login/index.html", "/manifest-cs.webmanifest");
htmlHasManifest("admin.html", "/manifest-admin.webmanifest");
htmlHasManifest("admin/login/index.html", "/manifest-admin.webmanifest");

const boot = fs.readFileSync(path.join(root, "pwa-boot.js"), "utf8");
if (!boot.includes("detectPortal") && !boot.includes("manifest-companion")) {
  failures.push("pwa-boot.js missing portal manifest detection");
}
const sw = fs.readFileSync(path.join(root, "public/sw-mcj.js"), "utf8");
if (/location\s*=\s*["']\/["']|Response\.redirect\(\s*["']\/["']/.test(sw)) {
  failures.push("sw-mcj.js appears to redirect navigations to /");
}

const out = {
  ok: failures.length === 0,
  failures,
  manifests: {
    boss: boss && { id: boss.id, start_url: boss.start_url, scope: boss.scope, display: boss.display },
    companion: companion && { id: companion.id, start_url: companion.start_url, scope: companion.scope, display: companion.display },
    cs: cs && { id: cs.id, start_url: cs.start_url, scope: cs.scope, display: cs.display },
    admin: admin && { id: admin.id, start_url: admin.start_url, scope: admin.scope, display: admin.display },
  },
};

fs.mkdirSync(path.join(root, "artifacts/pwa-portal-start-urls"), { recursive: true });
fs.writeFileSync(
  path.join(root, "artifacts/pwa-portal-start-urls/verify.json"),
  JSON.stringify(out, null, 2)
);
console.log(JSON.stringify(out, null, 2));
if (!out.ok) process.exit(1);
