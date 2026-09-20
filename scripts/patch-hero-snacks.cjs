const fs = require("fs");
const path = "index.html";
let html = fs.readFileSync(path, "utf8");

const snackLayer =
  `      <div class="home-brand-hero-snacks" aria-hidden="true">\n` +
  `        <img class="mcj-snack mcj-snack--1" src="assets/mcj-snack-chip.svg" alt="" width="80" height="80" decoding="async">\n` +
  `        <img class="mcj-snack mcj-snack--2" src="assets/mcj-snack-chip-pink.svg" alt="" width="80" height="80" decoding="async">\n` +
  `        <img class="mcj-snack mcj-snack--3" src="assets/mcj-snack-chip.svg" alt="" width="80" height="80" decoding="async">\n` +
  `        <img class="mcj-snack mcj-snack--4" src="assets/mcj-snack-chip-pink.svg" alt="" width="80" height="80" decoding="async">\n` +
  `        <img class="mcj-snack mcj-snack--5" src="assets/mcj-snack-chip.svg" alt="" width="80" height="80" decoding="async">\n` +
  `        <img class="mcj-snack mcj-snack--6" src="assets/mcj-snack-chip-pink.svg" alt="" width="80" height="80" decoding="async">\n` +
  `      </div>\n`;

if (!html.includes("home-brand-hero-snacks")) {
  html = html.replace(
    /(<section class="home-brand-hero"[^>]*>)\s*<div class="home-brand-hero-inner">/,
    `$1\n${snackLayer}      <div class="home-brand-hero-inner">`
  );
}

html = html.replace(
  /\s*<span class="mcj-chip mcj-chip--a"><\/span>\s*<span class="mcj-chip mcj-chip--b"><\/span>\s*<span class="mcj-chip mcj-chip--c"><\/span>\s*<span class="mcj-chip mcj-chip--d"><\/span>\s*/,
  "\n          "
);

if (!html.includes("home-brand-hero-snacks")) {
  console.error("FAILED: snack layer not inserted");
  process.exit(1);
}
if (html.includes("mcj-chip--a")) {
  console.error("FAILED: old chips still present");
  process.exit(1);
}

html = html.replace(
  /src\/home-brand-hero\.css\?v=[^"]+/,
  "src/home-brand-hero.css?v=20260910snackFloat1"
);

fs.writeFileSync(path, html, "utf8");
console.log("ok snacks=", (html.match(/mcj-snack--/g) || []).length, "zh=", html.includes("妙脆角"));
