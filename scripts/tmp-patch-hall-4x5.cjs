const fs = require("fs");
const path = require("path");

const cssPath = path.join(__dirname, "..", "src", "companion-hall.css");
let s = fs.readFileSync(cssPath, "utf8");

// 1) Base / early rules: restore portrait 4:5, drop banner clamps
s = s.replace(
  /\.companion-card-media\{position:relative!important;aspect-ratio:2\/1!important;max-height:min\(42vw,168px\)!important;/g,
  ".companion-card-media{position:relative!important;aspect-ratio:4/5!important;"
);
s = s.replace(
  /\.companion-card-media\{aspect-ratio:2\/1!important;max-height:min\(42vw,168px\)!important\}/g,
  ".companion-card-media{aspect-ratio:4/5!important}"
);
s = s.replace(
  /\.companion-card-media\{\n  background:#16131a!important;\n  aspect-ratio:2 \/ 1!important;\n  max-height:min\(42vw, 168px\)!important;\n\}/,
  ".companion-card-media{\n  background:#16131a!important;\n  aspect-ratio:4 / 5!important;\n  max-height:none!important;\n}"
);

// 2) Compact v1 media block → 4:5, no clamp
s = s.replace(
  /\.companion-hall-grid \.companion-card-media,\n\.companion-card-media\{\n  aspect-ratio:2 \/ 1!important;\n  width:100%!important;\n  max-height:min\(42vw, 168px\)!important;\n  min-height:0!important;\n  height:auto!important;\n  border-radius:0!important;\n  background:#141018!important;\n  overflow:hidden!important;\n\}/,
  `.companion-hall-grid .companion-card-media,
.companion-card-media{
  aspect-ratio:4 / 5!important;
  width:100%!important;
  max-height:none!important;
  min-height:0!important;
  height:auto!important;
  border-radius:0!important;
  background:#141018!important;
  overflow:hidden!important;
}`
);

// 3) Mobile media override inside compact v1 @560
s = s.replace(
  /  \.companion-hall-grid \.companion-card-media,\n  \.companion-card-media\{\n    aspect-ratio:2 \/ 1!important;\n    max-height:min\(42vw, 168px\)!important;\n    min-height:0!important;\n    height:auto!important;\n  \}/,
  `  .companion-hall-grid .companion-card-media,
  .companion-card-media{
    aspect-ratio:4 / 5!important;
    max-height:none!important;
    min-height:0!important;
    height:auto!important;
  }`
);

// 4) Tighten info area in existing compact v1 body/actions (keep structure)
s = s.replace(
  /\.companion-hall-grid \.companion-card-body\{\n  display:flex!important;\n  flex-direction:column!important;\n  align-items:stretch!important;\n  gap:5px!important;\n  padding:8px 12px 10px!important;\n\}/,
  `.companion-hall-grid .companion-card-body{
  display:flex!important;
  flex-direction:column!important;
  align-items:stretch!important;
  gap:3px!important;
  padding:6px 10px 8px!important;
}`
);

s = s.replace(
  /\.companion-hall-grid \.companion-nickname-line\{\n  order:1;\n  margin:0!important;\n  font-size:17px!important;\n  font-weight:700!important;\n  line-height:1\.2!important;/,
  `.companion-hall-grid .companion-nickname-line{
  order:1;
  margin:0!important;
  font-size:15px!important;
  font-weight:700!important;
  line-height:1.2!important;`
);

s = s.replace(
  /\.companion-hall-grid \.companion-status-inline\{\n  display:inline-flex!important;\n  align-items:center!important;\n  gap:5px!important;\n  height:24px!important;\n  min-height:24px!important;\n  padding:0 9px!important;\n  border-radius:999px!important;\n  font-size:11px!important;\n  font-weight:700!important;\n  line-height:1!important;\n\}/,
  `.companion-hall-grid .companion-status-inline{
  display:inline-flex!important;
  align-items:center!important;
  gap:4px!important;
  height:20px!important;
  min-height:20px!important;
  padding:0 7px!important;
  border-radius:999px!important;
  font-size:10px!important;
  font-weight:700!important;
  line-height:1!important;
}`
);

s = s.replace(
  /  gap:5px!important;\n  row-gap:5px!important;\n  margin:0!important;\n  width:100%!important;\n  max-height:58px!important;\n  overflow:hidden!important;\n\}/,
  `  gap:4px!important;
  row-gap:4px!important;
  margin:0!important;
  width:100%!important;
  max-height:42px!important;
  overflow:hidden!important;
}`
);

s = s.replace(
  /\.companion-hall-grid \.companion-identity-row \.companion-level-pill,\n\.companion-hall-grid \.companion-identity-row \.mcj-level-tag\{\n  height:24px!important;\n  min-height:24px!important;\n  padding:0 9px!important;/g,
  `.companion-hall-grid .companion-identity-row .companion-level-pill,
.companion-hall-grid .companion-identity-row .mcj-level-tag{
  height:20px!important;
  min-height:20px!important;
  padding:0 7px!important;`
);

s = s.replace(
  /\.companion-hall-grid \.companion-identity-row \.mcj-service-tag,\n\.companion-hall-grid \.companion-identity-row \.mcj-category-tag\{\n  height:24px!important;\n  min-height:24px!important;\n  padding:0 8px!important;/g,
  `.companion-hall-grid .companion-identity-row .mcj-service-tag,
.companion-hall-grid .companion-identity-row .mcj-category-tag{
  height:20px!important;
  min-height:20px!important;
  padding:0 6px!important;`
);

// Font sizes on tags inside identity row
s = s.replace(
  /  color:#f6e2b0!important;\n  font-size:11px!important;\n  font-weight:800!important;/,
  `  color:#f6e2b0!important;
  font-size:10px!important;
  font-weight:800!important;`
);
s = s.replace(
  /  color:rgba\(255,230,244,\.9\)!important;\n  font-size:11px!important;\n  font-weight:650!important;/,
  `  color:rgba(255,230,244,.9)!important;
  font-size:10px!important;
  font-weight:650!important;`
);

s = s.replace(
  /\.companion-hall-grid \.companion-card-action,\n\.companion-hall-grid a\.companion-card-action,\n\.companion-hall-grid button\.companion-card-action\{\n  flex:1 1 0%!important;\n  width:0!important;\n  height:46px!important;\n  min-height:46px!important;\n  max-height:46px!important;\n  border-radius:13px!important;\n  font-size:13px!important;/,
  `.companion-hall-grid .companion-card-action,
.companion-hall-grid a.companion-card-action,
.companion-hall-grid button.companion-card-action{
  flex:1 1 0%!important;
  width:0!important;
  height:36px!important;
  min-height:36px!important;
  max-height:36px!important;
  border-radius:11px!important;
  font-size:12px!important;`
);

// Mobile overrides for body/actions inside compact v1 @560
s = s.replace(
  /  \.companion-hall-grid \.companion-nickname-line\{\n    font-size:17px!important;\n    font-weight:700!important;\n  \}\n  \.companion-hall-grid \.companion-card-body\{\n    padding:7px 11px 9px!important;\n    gap:4px!important;\n  \}\n  \.companion-hall-grid \.companion-card-action,\n  \.companion-hall-grid a\.companion-card-action,\n  \.companion-hall-grid button\.companion-card-action\{\n    height:46px!important;\n    min-height:46px!important;\n    max-height:46px!important;\n    font-size:13px!important;\n  \}/,
  `  .companion-hall-grid .companion-nickname-line{
    font-size:15px!important;
    font-weight:700!important;
  }
  .companion-hall-grid .companion-card-body{
    padding:5px 10px 7px!important;
    gap:3px!important;
  }
  .companion-hall-grid .companion-card-action,
  .companion-hall-grid a.companion-card-action,
  .companion-hall-grid button.companion-card-action{
    height:36px!important;
    min-height:36px!important;
    max-height:36px!important;
    font-size:12px!important;
  }`
);

// 5) Replace entire compact v3 block with locked 4:5 + info compact
const v3Start = s.indexOf("/* ===== Banner+Hall compact v3");
if (v3Start >= 0) {
  s = s.slice(0, v3Start);
}

s += `
/* ===== Hall photo 4:5 + info compact (2026-09-11) — NEVER flatten portrait ===== */
.companion-hall-grid .companion-card-media,
.companion-card-media{
  aspect-ratio:4 / 5!important;
  width:100%!important;
  max-height:none!important;
  min-height:0!important;
  height:auto!important;
}
.companion-hall-grid .companion-card-media img,
.companion-card-media img{
  width:100%!important;
  height:100%!important;
  object-fit:cover!important;
}
.companion-hall-grid .mcj-verified-badge{
  display:none!important;
}
.companion-hall-grid .companion-brand-watermark{
  font-size:8px!important;
  letter-spacing:.1em!important;
  color:rgba(255,214,232,.22)!important;
}
.companion-hall-grid .companion-card-body{
  padding:5px 10px 7px!important;
  gap:3px!important;
}
.companion-hall-grid .companion-nickname-line{
  font-size:15px!important;
  line-height:1.15!important;
}
.companion-hall-grid .companion-card-head-meta{
  gap:4px!important;
}
.companion-hall-grid .companion-status-inline{
  height:20px!important;
  min-height:20px!important;
  padding:0 7px!important;
  font-size:10px!important;
}
.companion-hall-grid .companion-identity-row,
.companion-hall-grid .companion-capsule-row,
.companion-hall-grid .companion-tags{
  gap:4px!important;
  row-gap:4px!important;
  max-height:42px!important;
}
.companion-hall-grid .companion-identity-row .companion-level-pill,
.companion-hall-grid .companion-identity-row .mcj-level-tag,
.companion-hall-grid .companion-identity-row .mcj-service-tag,
.companion-hall-grid .companion-identity-row .mcj-category-tag,
.companion-hall-grid .companion-identity-row .companion-tag-more{
  height:20px!important;
  min-height:20px!important;
  padding:0 6px!important;
  font-size:10px!important;
}
.companion-hall-grid .companion-card-actions{
  gap:6px!important;
  margin-top:1px!important;
}
.companion-hall-grid .companion-card-action,
.companion-hall-grid a.companion-card-action,
.companion-hall-grid button.companion-card-action{
  height:36px!important;
  min-height:36px!important;
  max-height:36px!important;
  font-size:12px!important;
  border-radius:11px!important;
}
@media(max-width:820px){
  .companion-hall-grid .companion-card-media,
  .companion-card-media{
    aspect-ratio:4 / 5!important;
    max-height:none!important;
  }
}
@media(max-width:560px){
  .companion-hall-grid{
    gap:8px!important;
  }
  .companion-hall-grid .companion-card-media,
  .companion-card-media{
    aspect-ratio:4 / 5!important;
    max-height:none!important;
    min-height:0!important;
  }
  .companion-hall-grid .companion-card-body{
    padding:5px 10px 7px!important;
    gap:2px!important;
  }
  .companion-hall-grid .companion-identity-row,
  .companion-hall-grid .companion-capsule-row,
  .companion-hall-grid .companion-tags{
    max-height:40px!important;
  }
  .companion-hall-grid .companion-card-action,
  .companion-hall-grid a.companion-card-action,
  .companion-hall-grid button.companion-card-action{
    height:36px!important;
    min-height:36px!important;
    max-height:36px!important;
  }
}
`;

fs.writeFileSync(cssPath, s, "utf8");

const after = fs.readFileSync(cssPath, "utf8");
console.log(
  JSON.stringify(
    {
      r21: (after.match(/companion-card-media[\s\S]{0,120}aspect-ratio:\s*2\s*\/\s*1/g) || []).length,
      r45: (after.match(/aspect-ratio:\s*4\s*\/\s*5/g) || []).length,
      clamp42: (after.match(/max-height:min\(42vw/g) || []).length,
      any21onMedia: /companion-card-media\{[^}]*aspect-ratio:\s*2\s*\/\s*1/.test(after.replace(/\s+/g, " ")),
      hasPhotoLock: after.includes("Hall photo 4:5 + info compact"),
    },
    null,
    2
  )
);
