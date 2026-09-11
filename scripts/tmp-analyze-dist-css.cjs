const fs = require("fs");
const css = fs.readFileSync("dist/assets/companion-center-C99EjuY4.css", "utf8");
const last169 = Math.max(css.lastIndexOf("aspect-ratio:16/9"), css.lastIndexOf("aspect-ratio:16 / 9"));
const last21 = Math.max(css.lastIndexOf("aspect-ratio:2/1"), css.lastIndexOf("aspect-ratio:2 / 1"));
const lastClamp = css.lastIndexOf("42vw");
console.log(
  JSON.stringify(
    {
      len: css.length,
      r21: (css.match(/aspect-ratio:\s*2\s*\/\s*1/g) || []).length,
      r169: (css.match(/aspect-ratio:\s*16\s*\/\s*9/g) || []).length,
      clamp: (css.match(/42vw/g) || []).length,
      last169,
      last21,
      lastClamp,
      hallWins: last21 > last169 && lastClamp > last169,
      hideVerified: /companion-hall-grid\s+\.mcj-verified-badge\{[^}]*display:none/.test(css),
    },
    null,
    2
  )
);
