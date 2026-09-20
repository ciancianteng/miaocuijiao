#!/usr/bin/env node
/**
 * Offline P0 checks for anti-blank auth gate (#204).
 * Fails if deny paths clear body or hide the whole document.
 */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const files = [
  "public/portal-early-gate.js",
  "src/role-gates.js",
  "src/customer-service-auth.js",
];

const forbidden = [
  { re: /document\.body\.innerHTML\s*=\s*[\"'][\"']/, label: "body.innerHTML clear" },
  { re: /document\.documentElement\.style\.visibility\s*=\s*[\"']hidden[\"']/, label: "html visibility:hidden" },
];

const required = [
  { file: "public/portal-early-gate.js", re: /mcjAuthBootOverlay/, label: "early-gate overlay id" },
  { file: "public/portal-early-gate.js", re: /点击前往登录/, label: "early-gate login CTA" },
  { file: "src/role-gates.js", re: /function denyUnauthed/, label: "denyUnauthed present" },
  { file: "src/role-gates.js", re: /mcjAuthBootOverlay/, label: "role-gates overlay id" },
  { file: "src/role-gates.js", re: /点击前往登录/, label: "role-gates login CTA" },
  { file: "src/customer-service-auth.js", re: /showCsPendingGate/, label: "CS pending overlay" },
];

let failed = 0;
for (const rel of files) {
  const abs = path.join(root, rel);
  const src = fs.readFileSync(abs, "utf8");
  for (const f of forbidden) {
    if (f.re.test(src)) {
      console.error(`FAIL ${rel}: still contains ${f.label}`);
      failed++;
    }
  }
}
for (const r of required) {
  const src = fs.readFileSync(path.join(root, r.file), "utf8");
  if (!r.re.test(src)) {
    console.error(`FAIL ${r.file}: missing ${r.label}`);
    failed++;
  }
}

// Permission rules must still deny private pages (string anchors).
const early = fs.readFileSync(path.join(root, "public/portal-early-gate.js"), "utf8");
for (const needle of ["/login.html", "/companion/login/", "/admin/login/", "/customer-service/login/"]) {
  if (!early.includes(needle)) {
    console.error(`FAIL early-gate: missing deny target ${needle}`);
    failed++;
  }
}

if (failed) {
  console.error(`anti-blank P0 verify FAILED (${failed})`);
  process.exit(1);
}
console.log("anti-blank P0 verify PASS");
