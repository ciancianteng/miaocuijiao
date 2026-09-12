import fs from "fs";

const p = "src/gameplay-product.js";
let t = fs.readFileSync(p, "utf8");
const start = t.indexOf("  function safeCoverUrl");
const end = t.indexOf("  function parseSections");
if (start < 0 || end < 0) throw new Error("bounds " + start + " " + end);

const next = [
  "  function safeCoverUrl(p) {",
  '    var url = String((p && p.coverUrl) || "").trim();',
  "    if (!url) return GAME_PLACEHOLDER;",
  "    if (/default-avatar|dummy|sample.?avatar|test.?avatar|meow-cuijiao-brand/i.test(url)) return GAME_PLACEHOLDER;",
  "    if (/placeholder/i.test(url) && !/gameplay-cover-placeholder/i.test(url)) return GAME_PLACEHOLDER;",
  "    return url;",
  "  }",
  "",
  "  function coverHtml(p) {",
  "    var url = safeCoverUrl(p);",
  "    return (",
  "      '<div class=\"gameplay-product-cover\">' +",
  "      '<img class=\"gameplay-product-cover-img\" data-mcj-product-cover=\"1\" src=\"' + esc(url) + '\" alt=\"' + esc(p.name || \"商品封面\") + '\" ' +",
  "      'onerror=\"this.onerror=null;this.setAttribute(\\'data-mcj-product-cover\\',\\'1\\');this.src=\\'' + GAME_PLACEHOLDER + '\\';\">' +",
  "      \"</div>\"",
  "    );",
  "  }",
  "",
  "",
].join("\n");

t = t.slice(0, start) + next + t.slice(end);
fs.writeFileSync(p, t);

let h = fs.readFileSync("gameplay-product.html", "utf8");
h = h.replace(/\?v=[^"]+/g, "?v=20260801gpCover2");
fs.writeFileSync("gameplay-product.html", h);
console.log("ok", t.includes('data-mcj-product-cover="1"'));
console.log(t.slice(start, start + 780));
