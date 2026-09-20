const fs = require("fs");
let h = fs.readFileSync("index.html", "utf8");
h = h.replace(/site-data\.js\?v=[^"]+/, "site-data.js?v=20260910appProto1");
h = h.replace(/home-popularity\.js\?v=[^"]+/, "home-popularity.js?v=20260910appProto1");
fs.writeFileSync("index.html", h);
const v = fs.readFileSync("index.html", "utf8");
console.log(
  JSON.stringify(
    {
      siteData: /site-data\.js\?v=([^"']+)/.exec(v)[1],
      pop: /home-popularity\.js\?v=([^"']+)/.exec(v)[1],
      zh: /妙脆角|底部导航|快速入口/.test(v),
      brand: v.includes("data-home-brand-hero"),
      promo: v.includes("mcj-home-hero--promo"),
      tab: v.includes("mcj-app-tabbar"),
      body: v.includes("mcj-app-shell"),
    },
    null,
    2
  )
);
