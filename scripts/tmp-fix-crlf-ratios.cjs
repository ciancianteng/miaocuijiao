const fs = require("fs");
let c = fs.readFileSync("src/companion-hall.css", "utf8");

c = c.replace(
  /\.companion-card-media\{\r?\n  background:#16131a!important;\r?\n  aspect-ratio:4 \/ 5!important;\r?\n\}/,
  ".companion-card-media{\r\n  background:#16131a!important;\r\n  aspect-ratio:2 / 1!important;\r\n  max-height:min(42vw, 168px)!important;\r\n}"
);

// Any remaining companion-card-media 16/9 (with or without spaces)
c = c.replace(
  /(\.companion-card-media[^{]*\{[^}]*?)aspect-ratio:\s*16\s*\/\s*9\s*!important;/g,
  "$1aspect-ratio:2 / 1!important; max-height:min(42vw, 168px)!important;"
);

fs.writeFileSync("src/companion-hall.css", c, "utf8");
console.log(
  JSON.stringify({
    r45: (c.match(/aspect-ratio:\s*4\s*\/\s*5/g) || []).length,
    r169: (c.match(/aspect-ratio:\s*16\s*\/\s*9/g) || []).length,
    r21: (c.match(/aspect-ratio:\s*2\s*\/\s*1/g) || []).length,
    // remaining 16/9 should only be hall-gp-cover without !important ideally
    remaining169Samples: [...c.matchAll(/.{0,40}aspect-ratio:\s*16\s*\/\s*9.{0,40}/g)].map((m) =>
      m[0].replace(/\s+/g, " ")
    ),
  })
);
