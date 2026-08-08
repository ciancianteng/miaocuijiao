import fs from "fs";

function patchProductJs(path) {
  let t = fs.readFileSync(path, "utf8");
  t = t.replace(
    'var GAME_PLACEHOLDER = "/assets/meow-cuijiao-brand.jpg";',
    'var GAME_PLACEHOLDER = "/gameplay-cover-placeholder.jpg";'
  );
  t = t.replace(
    "if (!url || /default-avatar|dummy|placeholder|sample.?avatar|test.?avatar/i.test(url)) {",
    "if (!url || /default-avatar|dummy|placeholder|sample.?avatar|test.?avatar|meow-cuijiao-brand/i.test(url)) {"
  );
  t = t.replace(
    '<img class="gameplay-product-cover-img" src="\' + esc(url) + \'" alt="\' + esc(p.name || "商品封面") + \'" \' +\n      \'onerror="this.onerror=null;this.src=\\\'\' + GAME_PLACEHOLDER + \'\\\';">\' +',
    '<img class="gameplay-product-cover-img" data-mcj-product-cover="1" src="\' + esc(url) + \'" alt="\' + esc(p.name || "商品封面") + \'" \' +\n      \'onerror="this.onerror=null;this.setAttribute(\\\'data-mcj-product-cover\\\',\\\'1\\\');this.src=\\\'\' + GAME_PLACEHOLDER + \'\\\';">\' +'
  );
  fs.writeFileSync(path, t);
  console.log("patched", path, t.includes("gameplay-cover-placeholder.jpg"), t.includes("data-mcj-product-cover"));
}

function patchStore(path) {
  let t = fs.readFileSync(path, "utf8");
  t = t.replace(
    'const BRAND_COVER = "/assets/meow-cuijiao-brand.jpg";',
    'const BRAND_COVER = "/gameplay-cover-placeholder.jpg";'
  );
  const oldSan =
    "function sanitizeCover(url) {\n" +
    '  const text = String(url || "").trim();\n' +
    '  if (!text) return "";\n' +
    "  if (/default-avatar|placeholder|dummy|sample.?avatar|test.?avatar/i.test(text)) return \"\";\n" +
    "  return text;\n" +
    "}";
  const newSan =
    "function sanitizeCover(url) {\n" +
    '  const text = String(url || "").trim();\n' +
    '  if (!text) return "";\n' +
    "  if (/default-avatar|dummy|sample.?avatar|test.?avatar/i.test(text)) return \"\";\n" +
    "  if (/meow-cuijiao-brand/i.test(text)) return BRAND_COVER;\n" +
    "  if (/placeholder/i.test(text) && !/gameplay-cover-placeholder/i.test(text)) return \"\";\n" +
    "  return text;\n" +
    "}";
  if (!t.includes(oldSan)) {
    console.log("sanitizeCover pattern mismatch", path);
  } else {
    t = t.replace(oldSan, newSan);
  }
  fs.writeFileSync(path, t);
  console.log("store", path, t.includes('BRAND_COVER = "/gameplay-cover-placeholder.jpg"'));
}

patchProductJs("src/gameplay-product.js");
patchStore("server/api/_gameplay-products-store.js");
patchStore("api/_gameplay-products-store.js");
