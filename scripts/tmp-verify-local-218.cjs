const fs = require("fs");
const c = fs.readFileSync("src/companion-hall.css", "utf8");
const p = fs.readFileSync("src/ui-linglu-polish.css", "utf8");
const j = fs.readFileSync("src/companion-hall.js", "utf8");
const html = fs.readFileSync("companion-center.html", "utf8");

const hallLinkIdx = html.indexOf("companion-hall.css");
const polishLinkIdx = html.indexOf("ui-linglu-polish.css");

console.log(
  JSON.stringify(
    {
      hall: {
        r169: (c.match(/aspect-ratio:\s*16\s*\/\s*9/g) || []).length,
        r21: (c.match(/aspect-ratio:\s*2\s*\/\s*1/g) || []).length,
        clamp: (c.match(/min\(42vw,\s*168px\)/g) || []).length,
        maxNoneAfterClamp: /max-height:min\(42vw[\s\S]{0,80}max-height:\s*none/.test(c),
        hideVerified: /companion-hall-grid \.mcj-verified-badge\{\s*display:none/.test(c),
      },
      polish: {
        hall169: /companion-hall-grid[\s\S]{0,160}16\s*\/\s*9/.test(p),
        hall21: /companion-hall-grid[\s\S]{0,160}2\s*\/\s*1/.test(p),
        hideHallVerified: p.includes("companion-hall-grid .mcj-verified-badge"),
      },
      js: {
        hasYiRenZheng: j.includes("已认证"),
        badgeEmpty: /function verifiedBadgeHtml\(\)\s*\{\s*return ""/.test(j),
      },
      html: {
        hallAfterPolish: hallLinkIdx > polishLinkIdx,
        cache: /hallCompact4/.test(html),
      },
    },
    null,
    2
  )
);
