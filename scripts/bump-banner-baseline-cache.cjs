const fs = require("fs");
let s = fs.readFileSync("index.html", "utf8");
s = s.replace(/home-banner-promo\.css\?v=[^"']+/, "home-banner-promo.css?v=20260910baseline1");
s = s.replace(/home-banner\.css\?v=[^"']+/, "home-banner.css?v=20260910baseline1");
s = s.replace(/home-banner\.js\?v=[^"']+/, "home-banner.js?v=20260910baseline1");
fs.writeFileSync("index.html", s, "utf8");
const q = (s.match(/\?{3,}/g) || []).length;
console.log({
  qmarks: q,
  miaocui: s.includes("妙脆角"),
  hall: s.includes("进入陪玩大厅"),
  baseline: s.includes("20260910baseline1"),
});
