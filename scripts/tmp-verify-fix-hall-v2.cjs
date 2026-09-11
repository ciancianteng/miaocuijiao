const fs = require("fs");

const js = fs.readFileSync("src/companion-hall.js", "utf8");
const badgeLine = js.split(/\n/).find((l) => l.includes("mcj-verified-badge"));
console.log("badgeLine:", JSON.stringify(badgeLine));
console.log("has已认证:", js.includes("已认证"));
console.log("has✓ in badge html:", /mcj-verified-badge">✓/.test(js));

const c = fs.readFileSync("src/companion-hall.css", "utf8");
const i = c.indexOf("Unified media placeholder");
console.log("placeholder block:", JSON.stringify(c.slice(i, i + 220)));
console.log(
  "counts",
  JSON.stringify({
    r45: (c.match(/aspect-ratio:\s*4\s*\/\s*5/g) || []).length,
    r1610: (c.match(/aspect-ratio:\s*16\s*\/\s*10/g) || []).length,
    r169: (c.match(/aspect-ratio:\s*16\s*\/\s*9/g) || []).length,
    r21: (c.match(/aspect-ratio:\s*2\s*\/\s*1/g) || []).length,
    clamp: (c.match(/min\(42vw,\s*168px\)/g) || []).length,
  })
);

// Force-fix remaining 4/5 and compact-v1 16/9 on companion-card-media
let next = c;
next = next.replace(
  /\.companion-card-media\{\n  background:#16131a!important;\n  aspect-ratio:4 \/ 5!important;\n\}/,
  ".companion-card-media{\n  background:#16131a!important;\n  aspect-ratio:2 / 1!important;\n  max-height:min(42vw, 168px)!important;\n}"
);
next = next.replace(
  /aspect-ratio:16 \/ 9!important;/g,
  "aspect-ratio:2 / 1!important;\n  max-height:min(42vw, 168px)!important;"
);
// Avoid double max-height lines where already present after 16/9 replace in media queries
next = next.replace(
  /max-height:min\(42vw, 168px\)!important;\n  max-height:none!important;/g,
  "max-height:min(42vw, 168px)!important;"
);
next = next.replace(
  /max-height:min\(42vw, 168px\)!important;\n    max-height:none!important;/g,
  "max-height:min(42vw, 168px)!important;"
);

if (next !== c) {
  fs.writeFileSync("src/companion-hall.css", next, "utf8");
  console.log("css leftovers patched");
} else {
  console.log("css leftovers unchanged");
}

const after = fs.readFileSync("src/companion-hall.css", "utf8");
console.log(
  "after counts",
  JSON.stringify({
    r45: (after.match(/aspect-ratio:\s*4\s*\/\s*5/g) || []).length,
    r169: (after.match(/aspect-ratio:\s*16\s*\/\s*9/g) || []).length,
    r21: (after.match(/aspect-ratio:\s*2\s*\/\s*1/g) || []).length,
  })
);

// Fix JS comment if mojibake
let js2 = js;
if (!js2.includes("已认证") || /mcj-verified-badge">✓/.test(js2)) {
  js2 = js2.replace(
    /return '<span class="mcj-verified-badge">[^<]*<\/span>';/,
    "return '<span class=\"mcj-verified-badge\">已认证</span>';"
  );
  js2 = js2.replace(
    /\/\*\* Unified[^*]*\*\//,
    "/** Unified verified badge — CSS ::before provides checkmark; text is 已认证 only */"
  );
  fs.writeFileSync("src/companion-hall.js", js2, "utf8");
  console.log("js rewritten");
  console.log("badge now:", JSON.stringify(js2.split(/\n/).find((l) => l.includes("mcj-verified-badge"))));
} else {
  console.log("js ok");
}
