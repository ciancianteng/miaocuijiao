/**
 * Sync locales/*.json → public/locales + src/i18n-catalog.js
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const zh = JSON.parse(fs.readFileSync(path.join(root, "locales/zh-CN.json"), "utf8"));
const en = JSON.parse(fs.readFileSync(path.join(root, "locales/en.json"), "utf8"));

fs.mkdirSync(path.join(root, "public/locales"), { recursive: true });
fs.writeFileSync(path.join(root, "public/locales/zh-CN.json"), JSON.stringify(zh, null, 2) + "\n");
fs.writeFileSync(path.join(root, "public/locales/en.json"), JSON.stringify(en, null, 2) + "\n");

const out =
  "/* Auto-synced from locales/*.json — run: node scripts/sync-i18n-catalog.mjs */\n" +
  "(function (root) {\n" +
  '  "use strict";\n' +
  "  root.__MCJ_I18N_CATALOG__ = " +
  JSON.stringify({ "zh-CN": zh, en: en }, null, 2) +
  ";\n" +
  "})(typeof window !== \"undefined\" ? window : globalThis);\n";
fs.writeFileSync(path.join(root, "src/i18n-catalog.js"), out);
console.log(JSON.stringify({ ok: true, keys: Object.keys(zh).length }));
