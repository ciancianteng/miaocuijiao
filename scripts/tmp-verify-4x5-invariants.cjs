const fs = require("fs");
const c = fs.readFileSync("src/companion-hall.css", "utf8");
const p = fs.readFileSync("src/ui-linglu-polish.css", "utf8");
const j = fs.readFileSync("src/companion-hall.js", "utf8");
const h = fs.readFileSync("companion-center.html", "utf8");
console.log(
  JSON.stringify(
    {
      hall: {
        r21: (c.match(/aspect-ratio:\s*2\s*\/\s*1/g) || []).length,
        r45: (c.match(/aspect-ratio:\s*4\s*\/\s*5/g) || []).length,
        clamp: (c.match(/max-height:min\(42vw/g) || []).length,
        hideVerified: /companion-hall-grid \.mcj-verified-badge\{\s*display:none/.test(c),
      },
      polish: {
        r21: (p.match(/aspect-ratio:\s*2\s*\/\s*1/g) || []).length,
        r45: (p.match(/aspect-ratio:\s*4\s*\/\s*5/g) || []).length,
        clamp: (p.match(/max-height:min\(42vw/g) || []).length,
      },
      jsEmpty: /function verifiedBadgeHtml\(\)\s*\{\s*return ""/.test(j),
      htmlPhoto45: h.includes("hallPhoto45"),
    },
    null,
    2
  )
);
