/**
 * Verify zh-CN / en locale key parity + required core keys.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function readJson(rel) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) {
    failures.push("missing " + rel);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    failures.push("invalid JSON " + rel + ": " + (e && e.message));
    return null;
  }
}

const zh = readJson("locales/zh-CN.json");
const en = readJson("locales/en.json");
if (!zh || !en) {
  console.log(JSON.stringify({ ok: false, failures }, null, 2));
  process.exit(1);
}

const zhKeys = Object.keys(zh).sort();
const enKeys = Object.keys(en).sort();
const onlyZh = zhKeys.filter((k) => !Object.prototype.hasOwnProperty.call(en, k));
const onlyEn = enKeys.filter((k) => !Object.prototype.hasOwnProperty.call(zh, k));
if (onlyZh.length) failures.push("keys only in zh-CN: " + onlyZh.join(", "));
if (onlyEn.length) failures.push("keys only in en: " + onlyEn.join(", "));

const REQUIRED = [
  "nav.home",
  "nav.hall",
  "nav.orders",
  "nav.support",
  "nav.mine",
  "nav.language",
  "nav.language_zh",
  "nav.language_en",
  "home.hero.tagline",
  "home.hero.enter_hall",
  "auth.login",
  "auth.register",
  "hall.book_now",
  "order.book_now",
  "order.status.awaiting_payment",
  "order.status.in_progress",
  "order.status.completed",
  "order.status.cancelled",
  "pwa.install_title",
  "pwa.install_btn",
  "common.brand",
];

REQUIRED.forEach((k) => {
  if (!zh[k]) failures.push("missing required zh-CN key: " + k);
  if (!en[k]) failures.push("missing required en key: " + k);
});

// Brand must stay 妙脆角 / MEOW CUI JIAO — never machine-translated brand.
if (zh["common.brand"] !== "妙脆角") failures.push("common.brand zh must remain 妙脆角");
if (en["common.brand"] !== "妙脆角") failures.push("common.brand en must remain 妙脆角 (do not translate brand)");
if (!/MEOW CUI JIAO/i.test(String(zh["common.brand_en"] || ""))) {
  failures.push("common.brand_en must include MEOW CUI JIAO");
}

const catalogPath = path.join(root, "src/i18n-catalog.js");
if (!fs.existsSync(catalogPath)) failures.push("missing src/i18n-catalog.js — run sync-i18n-catalog.mjs");
else {
  const cat = fs.readFileSync(catalogPath, "utf8");
  if (!cat.includes("__MCJ_I18N_CATALOG__")) failures.push("i18n-catalog.js missing catalog global");
  // Ensure catalog was synced (spot-check a few keys).
  if (!cat.includes('"nav.home"')) failures.push("i18n-catalog.js appears stale vs locales");
}

const runtimePath = path.join(root, "src/i18n.js");
if (!fs.existsSync(runtimePath)) failures.push("missing src/i18n.js");
else {
  const rt = fs.readFileSync(runtimePath, "utf8");
  if (!rt.includes("mcj_locale")) failures.push("i18n.js must persist mcj_locale");
  if (!rt.includes("mcj:localechange")) failures.push("i18n.js must emit mcj:localechange");
}

const publicZh = readJson("public/locales/zh-CN.json");
const publicEn = readJson("public/locales/en.json");
if (publicZh && JSON.stringify(publicZh) !== JSON.stringify(zh)) {
  failures.push("public/locales/zh-CN.json out of sync — run sync-i18n-catalog.mjs");
}
if (publicEn && JSON.stringify(publicEn) !== JSON.stringify(en)) {
  failures.push("public/locales/en.json out of sync — run sync-i18n-catalog.mjs");
}

const emptyZh = zhKeys.filter((k) => String(zh[k] || "").trim() === "");
const emptyEn = enKeys.filter((k) => String(en[k] || "").trim() === "");
if (emptyZh.length) failures.push("empty zh-CN values: " + emptyZh.join(", "));
if (emptyEn.length) failures.push("empty en values: " + emptyEn.join(", "));

const ok = failures.length === 0;
console.log(
  JSON.stringify(
    {
      ok,
      failures,
      counts: { zh: zhKeys.length, en: enKeys.length },
      requiredChecked: REQUIRED.length,
    },
    null,
    2
  )
);
if (!ok) process.exit(1);
console.log("PASS locale parity");
