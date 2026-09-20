/**
 * Guard: portal share metadata must use the Production HTTPS brand OG image.
 * Also proves PWA start_url / scope were not rewritten to homepage.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  FOUR_ENTRY_HTML,
  OG_IMAGE,
  isForbiddenShareImageUrl,
  portalOf,
} from "./lib/og-share-meta.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function read(rel) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) {
    failures.push("missing " + rel);
    return "";
  }
  return fs.readFileSync(abs, "utf8");
}

function attr(html, re) {
  const m = html.match(re);
  return m ? m[1].trim() : "";
}

function allAttrs(html, re) {
  return [...html.matchAll(re)].map((m) => m[1].trim());
}

for (const entry of FOUR_ENTRY_HTML) {
  const html = read(entry.rel);
  if (!html) continue;
  const title = attr(html, /<title>([^<]*)<\/title>/i);
  if (entry.expectTitle && title !== entry.expectTitle) {
    failures.push(`${entry.rel} title expected ${JSON.stringify(entry.expectTitle)} got ${JSON.stringify(title)}`);
  }
  const ogTitle = attr(html, /property="og:title"[^>]*content="([^"]*)"/i) ||
    attr(html, /content="([^"]*)"[^>]*property="og:title"/i);
  const ogImage = attr(html, /property="og:image"[^>]*content="([^"]*)"/i) ||
    attr(html, /content="([^"]*)"[^>]*property="og:image"/i);
  const twImage = attr(html, /name="twitter:image"[^>]*content="([^"]*)"/i) ||
    attr(html, /content="([^"]*)"[^>]*name="twitter:image"/i);
  if (entry.rel !== "index.html" && ogTitle !== title) {
    failures.push(`${entry.rel} og:title must match <title>`);
  }
  if (ogImage !== OG_IMAGE) {
    failures.push(`${entry.rel} og:image expected ${OG_IMAGE} got ${ogImage || "(missing)"}`);
  }
  if (twImage !== OG_IMAGE) {
    failures.push(`${entry.rel} twitter:image expected ${OG_IMAGE} got ${twImage || "(missing)"}`);
  }
  if (isForbiddenShareImageUrl(ogImage)) {
    failures.push(`${entry.rel} og:image forbidden: ${ogImage}`);
  }
  if (isForbiddenShareImageUrl(twImage)) {
    failures.push(`${entry.rel} twitter:image forbidden: ${twImage}`);
  }
  for (const url of [...allAttrs(html, /property="og:image"[^>]*content="([^"]*)"/gi), ...allAttrs(html, /name="twitter:image"[^>]*content="([^"]*)"/gi)]) {
    if (/localhost|127\.0\.0\.1|vercel\.app|supabase\.co\/storage/i.test(url)) {
      failures.push(`${entry.rel} share image must not use ${url}`);
    }
    if (!/^https:\/\/www\.meowcuijiao\.com\//i.test(url)) {
      failures.push(`${entry.rel} share image must be Production HTTPS: ${url}`);
    }
  }
}

if (!isForbiddenShareImageUrl("http://localhost/og/x.jpg")) failures.push("localhost image must fail");
if (!isForbiddenShareImageUrl("/og/share-card-square-v2.jpg")) failures.push("relative og:image must fail");
if (!isForbiddenShareImageUrl("https://meow-cuijiao-homepage-staging.vercel.app/og/x.jpg")) {
  failures.push("preview URL must fail");
}
if (isForbiddenShareImageUrl(OG_IMAGE)) failures.push("production OG image must pass");

const extraPortal = [
  "companion/index.html",
  "customer-service/index.html",
  "admin.html",
  "admin/index.html",
];
for (const rel of extraPortal) {
  const html = read(rel);
  if (!html) continue;
  const ogImage = attr(html, /property="og:image"[^>]*content="([^"]*)"/i);
  if (ogImage !== OG_IMAGE) failures.push(`${rel} missing production og:image`);
}

const ogFile = path.join(root, "public/og/share-card-square-v2.jpg");
if (!fs.existsSync(ogFile)) failures.push("missing public/og/share-card-square-v2.jpg");

const manifests = [
  ["manifest-companion.webmanifest", "/companion/", "/companion/"],
  ["manifest-cs.webmanifest", "/customer-service/", "/customer-service/"],
  ["manifest-admin.webmanifest", "/admin/", "/admin/"],
  ["manifest.webmanifest", "/", "/"],
];
for (const [rel, start, scope] of manifests) {
  const raw = read(rel);
  if (!raw) continue;
  const json = JSON.parse(raw);
  if (json.start_url !== start) failures.push(`${rel} start_url changed: ${json.start_url}`);
  if (json.scope !== scope) failures.push(`${rel} scope changed: ${json.scope}`);
}

const out = {
  ok: failures.length === 0,
  failures,
  ogImage: OG_IMAGE,
  entries: FOUR_ENTRY_HTML.map((e) => ({ ...e, portal: portalOf(e.rel) })),
};

console.log(JSON.stringify(out, null, 2));
if (!out.ok) process.exit(1);
