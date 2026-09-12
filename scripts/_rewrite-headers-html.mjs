import fs from "fs";

const newHeader = `<header class="site-header mcj-boss-header" data-mcj-boss-header="1" aria-label="顶部导航">
    <div class="mcj-boss-header-inner header-inner">
      <nav class="header-nav mcj-boss-nav mcj-boss-nav-primary" aria-label="主导航">
        <a href="index.html" class="active">首页</a>
        <a href="companion-center.html">大厅</a>
        <a href="orders.html">订单</a>
        <a href="support.html?start=1">客服</a>
      </nav>
    </div>
  </header>`;

const killBlock = `
/* ===== P0 tab-nav-only override (20260802) — defeats legacy header CSS ===== */
header.mcj-boss-header .brand,
header.mcj-boss-header .mcj-boss-brand,
header.mcj-boss-header .top-actions,
header.mcj-boss-header .mcj-boss-more,
header.mcj-boss-header .live2d-avatar{display:none!important}
@media(max-width:980px){
  .header-nav{display:grid!important;grid-template-columns:repeat(4,minmax(0,1fr))!important;width:100%!important;max-width:100%!important;overflow:hidden!important;overflow-x:hidden!important;flex-wrap:nowrap!important;justify-content:stretch!important;gap:6px!important;order:0!important}
  .header-nav a,.header-nav button{width:100%!important;min-width:0!important;height:48px!important;padding:0 4px!important;margin:0!important;border-radius:12px!important;font-size:14px!important;display:flex!important;align-items:center!important;justify-content:center!important;white-space:nowrap!important;flex:none!important}
  .header-inner{display:block!important;width:100%!important;max-width:100%!important;padding:8px 12px!important;overflow:hidden!important}
}
@media(max-width:720px){
  .header-nav{display:grid!important}
  header.mcj-boss-header .header-nav,
  header.mcj-boss-header .mcj-boss-nav{display:grid!important;grid-template-columns:repeat(4,minmax(0,1fr))!important;overflow-x:hidden!important}
}
html,body{width:100%!important;max-width:100%!important;overflow-x:hidden!important}
`;

let html = fs.readFileSync("index.html", "utf8");
const alt = /<header[^>]*class="[^"]*site-header[^"]*"[^>]*>[\s\S]*?<\/header>/;
if (!alt.test(html)) throw new Error("index header not found");
html = html.replace(alt, newHeader);
html = html.replace(/src\/boss-header\.js(\?v=[^"]+)?/g, "src/boss-header.js?v=20260802tabNav4");
if (!html.includes("P0 tab-nav-only override")) {
  html = html.replace("</style>", killBlock + "\n</style>");
}
fs.writeFileSync("index.html", html);
console.log("index.html ok");

const navHtml = `<header class="topbar mcj-boss-header" data-mcj-boss-header="1" aria-label="顶部导航">
  <div class="mcj-boss-header-inner header-inner">
    <nav class="header-nav mcj-boss-nav mcj-boss-nav-primary" aria-label="主导航">
      <a href="index.html">首页</a>
      <a href="companion-center.html">大厅</a>
      <a href="orders.html">订单</a>
      <a href="support.html?start=1">客服</a>
    </nav>
  </div>
</header>`;

const pages = [
  "orders.html",
  "support.html",
  "mine.html",
  "recharge.html",
  "more-gameplays.html",
  "gameplay-product.html",
  "companion-center.html",
  "messages.html",
  "companion-apply.html",
  "profile.html",
  "payment-confirm.html",
  "place-order.html",
  "order-confirm.html",
  "ranking.html",
];

for (const p of pages) {
  if (!fs.existsSync(p)) continue;
  let h = fs.readFileSync(p, "utf8");
  const hdr = /<header[^>]*>[\s\S]*?<\/header>/;
  const m = h.match(hdr);
  if (m && /boss-header|topbar|site-header|mcj-boss-header/.test(m[0])) {
    h = h.replace(hdr, navHtml);
  }
  h = h.replace(/boss-header\.js(\?v=[^"]+)?/g, "boss-header.js?v=20260802tabNav4");
  if (!h.includes("boss-header.css") && h.includes("boss-header.js") && h.includes("</head>")) {
    h = h.replace("</head>", '  <link rel="stylesheet" href="src/boss-header.css?v=20260802tabNav4">\n</head>');
  } else {
    h = h.replace(/boss-header\.css(\?v=[^"]+)?/g, "boss-header.css?v=20260802tabNav4");
  }
  fs.writeFileSync(p, h);
  console.log("patched", p);
}
