const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "..", "src", "pwa-install-prompt.js");
const buf = fs.readFileSync(file);
const text = buf.toString("utf8");
const m = text.match(/apple-mobile-web-app-title[\s\S]{0,220}/);
console.log("snippet:\n", m && m[0]);
console.log("replacementCharCount", (text.match(/\uFFFD/g) || []).length);
const contents = [...text.matchAll(/m\.content = "([^"]*)"/g)].map((x) => x[1]);
console.log("m.content values:", contents);
const logo = text.match(/logoSrc[\s\S]{0,80}/);
console.log("logoSrc", logo && logo[0]);
