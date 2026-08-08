import fs from "fs";

const path = "src/design-system.css";
let t = fs.readFileSync(path, "utf8");

// Scope horizontal-scroll header rules away from mcj-boss-header
const replacements = [
  [
    ":where(.topbar .nav, .site-header .nav, .site-header .top-actions, .site-header .header-nav, .topbar .top-actions, .topbar .header-nav) {\n    gap: 12px !important;\n    overflow-x: auto !important;",
    ":where(.topbar:not(.mcj-boss-header) .nav, .site-header:not(.mcj-boss-header) .nav, .site-header:not(.mcj-boss-header) .top-actions, .site-header:not(.mcj-boss-header) .header-nav, .topbar:not(.mcj-boss-header) .top-actions, .topbar:not(.mcj-boss-header) .header-nav) {\n    gap: 12px !important;\n    overflow-x: auto !important;",
  ],
  [
    ":where(.topbar .nav, .site-header .nav, .site-header .top-actions, .site-header .header-nav, .topbar .top-actions, .topbar .header-nav) {",
    ":where(.topbar:not(.mcj-boss-header) .nav, .site-header:not(.mcj-boss-header) .nav, .site-header:not(.mcj-boss-header) .top-actions, .site-header:not(.mcj-boss-header) .header-nav, .topbar:not(.mcj-boss-header) .top-actions, .topbar:not(.mcj-boss-header) .header-nav) {",
  ],
];

let count = 0;
for (const [a, b] of replacements) {
  if (t.includes(a)) {
    t = t.split(a).join(b);
    count++;
  }
}

// Append hard override at end
if (!t.includes("mcj-boss-header-tab-nav-lock")) {
  t += `
/* mcj-boss-header-tab-nav-lock */
header.mcj-boss-header nav.header-nav,
header.mcj-boss-header nav.mcj-boss-nav {
  display: grid !important;
  grid-template-columns: repeat(4, minmax(0, 1fr)) !important;
  width: 100% !important;
  max-width: 100% !important;
  overflow: hidden !important;
  overflow-x: hidden !important;
  gap: 6px !important;
  white-space: normal !important;
}
header.mcj-boss-header nav.header-nav > a,
header.mcj-boss-header nav.mcj-boss-nav > a {
  width: 100% !important;
  min-width: 0 !important;
  max-width: 100% !important;
  height: 48px !important;
  padding: 0 4px !important;
  margin: 0 !important;
  flex: none !important;
  white-space: nowrap !important;
}
header.mcj-boss-header .brand,
header.mcj-boss-header .mcj-boss-brand,
header.mcj-boss-header .top-actions,
header.mcj-boss-header .mcj-boss-more {
  display: none !important;
}
`;
}

fs.writeFileSync(path, t);
console.log("design-system patched", { count, lock: t.includes("mcj-boss-header-tab-nav-lock") });

// bump safe-area link on index
let html = fs.readFileSync("index.html", "utf8");
html = html.replace(/mcj-safe-area\.css\?v=[^"]+/g, "mcj-safe-area.css?v=20260802tabNav4");
fs.writeFileSync("index.html", html);
