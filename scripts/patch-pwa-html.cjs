const fs = require("fs");

// --- mine.html ---
const minePath = "mine.html";
let mine = fs.readFileSync(minePath, "utf8");
const entryNeedle =
  '\'<section class="entry"><a class="entry-trigger" href="my-direct-companions.html"><span class="entry-title">直属陪玩</span><span class="entry-arrow" aria-hidden="true"></span></a></section>\'+';
const entryInsert =
  entryNeedle +
  "\n          " +
  '\'<section class="entry"><button type="button" class="entry-trigger" data-pwa-install><span class="entry-title">添加妙脆角到主屏幕</span><span class="entry-arrow" aria-hidden="true"></span></button></section>\'+';

if (!mine.includes("data-pwa-install")) {
  if (!mine.includes(entryNeedle)) {
    console.error("mine entry needle missing");
    process.exit(1);
  }
  mine = mine.replace(entryNeedle, entryInsert);
} else {
  console.log("mine entry already present");
}

const logoutNeedle = "if(e.target.closest('[data-logout]'))";
const pwaHandler =
  "if(e.target.closest('[data-pwa-install]')){if(window.MCJPwaInstall&&typeof window.MCJPwaInstall.open==='function'){window.MCJPwaInstall.open({force:true})}return}\n        " +
  logoutNeedle;

if (!mine.includes("closest('[data-pwa-install]')")) {
  if (!mine.includes(logoutNeedle)) {
    console.error("logout needle missing");
    process.exit(1);
  }
  mine = mine.replace(logoutNeedle, pwaHandler);
} else {
  console.log("mine handler already present");
}

fs.writeFileSync(minePath, mine, "utf8");
console.log("mine.html patched, has Chinese:", /添加妙脆角到主屏幕/.test(mine));

// --- index.html PWA meta ---
const indexPath = "index.html";
let index = fs.readFileSync(indexPath, "utf8");
const metaBlock = [
  '  <link rel="manifest" href="/manifest.webmanifest">',
  '  <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">',
  '  <meta name="apple-mobile-web-app-capable" content="yes">',
  '  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">',
  '  <meta name="apple-mobile-web-app-title" content="妙脆角">',
  '  <meta name="theme-color" content="#0a0610">',
  '  <meta name="mobile-web-app-capable" content="yes">',
].join("\n");

if (!index.includes('rel="manifest"')) {
  const anchor = '<meta charset="UTF-8">';
  if (!index.includes(anchor)) {
    console.error("index charset missing");
    process.exit(1);
  }
  index = index.replace(anchor, anchor + "\n" + metaBlock);
  fs.writeFileSync(indexPath, index, "utf8");
  console.log("index.html meta injected");
} else {
  console.log("index.html already has manifest");
}

const indexBuf = fs.readFileSync(indexPath);
const mineBuf = fs.readFileSync(minePath);
console.log("index contains 妙脆角 utf8 bytes:", indexBuf.includes(Buffer.from("妙脆角", "utf8")));
console.log(
  "mine contains 添加妙脆角 utf8:",
  mineBuf.includes(Buffer.from("添加妙脆角到主屏幕", "utf8"))
);
