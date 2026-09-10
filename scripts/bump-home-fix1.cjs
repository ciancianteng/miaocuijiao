const fs = require("fs");
const path = "index.html";
let html = fs.readFileSync(path, "utf8");
const pairs = [
  ["home-banner-promo.css?v=", "20260910homeFix1"],
  ["home-brand-hero.css?v=", "20260910homeFix1"],
  ["home-app-mobile.css?v=", "20260910homeFix1"],
  ["ui-linglu-polish.css?v=", "20260910homeFix1"],
  ["site-data.js?v=", "20260910homeFix1"],
];
for (const [prefix, ver] of pairs) {
  const re = new RegExp(prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[^\"]*");
  if (re.test(html)) html = html.replace(re, prefix + ver);
  else {
    // try without existing query
    const bare = prefix.replace("?v=", "");
    html = html.replace(
      new RegExp(`(href|src)="([^"]*${bare.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})"`),
      `$1="$2?v=${ver}"`
    );
  }
}
fs.writeFileSync(path, html, "utf8");
console.log("zh", html.includes("妙脆角"), "site-data", /site-data\.js\?v=20260910homeFix1/.test(html));
