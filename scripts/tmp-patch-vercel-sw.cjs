"use strict";
const fs = require("fs");

const file = "vercel.json";
let s = fs.readFileSync(file, "utf8");
if (s.includes('"/sw-mcj.js"')) {
  console.log("already has sw-mcj headers");
} else {
  const blockLf =
    '    {\n      "source": "/sw-mcj.js",\n      "headers": [\n        { "key": "Cache-Control", "value": "public, max-age=0, must-revalidate" },\n        { "key": "Service-Worker-Allowed", "value": "/" },\n        { "key": "X-Content-Type-Options", "value": "nosniff" }\n      ]\n    },\n';
  const blockCrlf = blockLf.replace(/\n/g, "\r\n");
  const needleCrlf = '    {\r\n      "source": "/manifest.webmanifest",';
  const needleLf = '    {\n      "source": "/manifest.webmanifest",';
  if (s.includes(needleCrlf)) {
    s = s.replace(needleCrlf, blockCrlf + needleCrlf);
  } else if (s.includes(needleLf)) {
    s = s.replace(needleLf, blockLf + needleLf);
  } else {
    console.error("manifest needle missing");
    process.exit(1);
  }
  fs.writeFileSync(file, s);
  console.log("inserted sw-mcj headers");
}

JSON.parse(fs.readFileSync(file, "utf8"));
console.log("vercel json ok");

const html = fs.readFileSync("index.html", "utf8");
const title = html.match(/apple-mobile-web-app-title" content="([^"]+)"/);
console.log("title", title && title[1]);
console.log("earlySW", /data-mcj-pwa-sw-early/.test(html));
