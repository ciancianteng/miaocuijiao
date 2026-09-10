const fs = require("fs");
let html = fs.readFileSync("index.html", "utf8");
html = html.replace(/class="mcj-snack ([^"]+)"/g, 'class="mcj-snack $1" data-mcj-decor="1"');
html = html.split("20260910snackFloat2").join("20260910snackFloat3");
html = html.replace(/src\/avatar-fallback\.js(\?v=[^"]*)?/, "src/avatar-fallback.js?v=20260910snackFloat3");
fs.writeFileSync("index.html", html, "utf8");
console.log({
  decor: (html.match(/data-mcj-decor="1"/g) || []).length,
  zh: html.includes("妙脆角"),
  avatarFb: /avatar-fallback\.js\?v=20260910snackFloat3/.test(html),
});
