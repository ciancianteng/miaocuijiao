const fs = require("fs");
const path = require("path");

const cssPath = path.join(__dirname, "..", "src", "companion-hall.css");
let s = fs.readFileSync(cssPath, "utf8");
const before = s;

s = s.replace(
  /\.companion-card-media\{aspect-ratio:16\/10!important\}/g,
  ".companion-card-media{aspect-ratio:2/1!important;max-height:min(42vw,168px)!important}"
);

s = s.replace(
  /(\/\* Unified media placeholder[^\n]*\n\.companion-card-media\{\n  background:#16131a!important;\n  )aspect-ratio:4 \/ 5!important;/,
  "$1aspect-ratio:2 / 1!important;\n  max-height:min(42vw, 168px)!important;"
);

s = s.replace(
  /\.companion-card-media\{position:relative!important;aspect-ratio:4\/5!important;/g,
  ".companion-card-media{position:relative!important;aspect-ratio:2/1!important;max-height:min(42vw,168px)!important;"
);

// Compact v1 16/9 → 2/1 + clamp (all occurrences in compact section + globals we care about)
s = s.replace(
  /(\.companion-hall-grid \.companion-card-media,\n\.companion-card-media\{\n  aspect-ratio:)16 \/ 9(!important;\n  width:100%!important;\n  max-height:)none(!important;)/g,
  "$12 / 1$2min(42vw, 168px)$3"
);

s = s.replace(
  /(\.companion-hall-grid \.companion-card-media,\n  \.companion-card-media\{\n    aspect-ratio:)16 \/ 9(!important;\n    max-height:)none(!important;\n  \})/g,
  "$12 / 1$2min(42vw, 168px)$3"
);

if (!s.includes("Banner+Hall compact v2")) {
  s += `

/* ===== Banner+Hall compact v2 (2026-09-11) — force shorter media on Prod/Vite ===== */
.companion-hall-grid .companion-card-media,
.companion-card-media{
  aspect-ratio:2 / 1!important;
  width:100%!important;
  max-height:min(42vw, 168px)!important;
  min-height:0!important;
  height:auto!important;
}
.companion-hall-grid .companion-card-media img,
.companion-card-media img{
  width:100%!important;
  height:100%!important;
  max-height:none!important;
  object-fit:cover!important;
}
@media(max-width:820px){
  .companion-hall-grid .companion-card-media,
  .companion-card-media{
    aspect-ratio:2 / 1!important;
    max-height:min(42vw, 168px)!important;
  }
}
@media(max-width:560px){
  .companion-hall-page{
    padding-bottom:calc(64px + env(safe-area-inset-bottom, 0px) + 12px)!important;
  }
  .companion-hall-grid .companion-card-media,
  .companion-card-media{
    aspect-ratio:2 / 1!important;
    max-height:min(42vw, 168px)!important;
    min-height:0!important;
  }
  .companion-hall-grid .companion-card-body{
    padding:6px 10px 8px!important;
    gap:3px!important;
  }
  .companion-hall-grid .companion-identity-row,
  .companion-hall-grid .companion-capsule-row,
  .companion-hall-grid .companion-tags{
    max-height:46px!important;
  }
  .companion-hall-grid .companion-card-action,
  .companion-hall-grid a.companion-card-action,
  .companion-hall-grid button.companion-card-action{
    height:40px!important;
    min-height:40px!important;
    max-height:40px!important;
  }
}
`;
}

fs.writeFileSync(cssPath, s, "utf8");
console.log(
  JSON.stringify(
    {
      changed: s !== before,
      hasV2: s.includes("Banner+Hall compact v2"),
      has45: /aspect-ratio:\s*4\s*\/\s*5/.test(s),
      has1610: /aspect-ratio:\s*16\s*\/\s*10/.test(s),
      has21: /aspect-ratio:\s*2\s*\/\s*1/.test(s),
      hasClamp: s.includes("min(42vw, 168px)") || s.includes("min(42vw,168px)"),
      bytes: Buffer.byteLength(s, "utf8"),
    },
    null,
    2
  )
);
