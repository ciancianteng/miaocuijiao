import fs from "fs";

const bh = "src/boss-header.css";
let t = fs.readFileSync(bh, "utf8");

const oldHeader = `header.mcj-boss-header,
header.mcj-boss-header.site-header,
header.mcj-boss-header.topbar {
  box-sizing: border-box !important;
  width: 100% !important;
  height: 72px !important;
  min-height: 72px !important;
  max-height: 72px !important;
  margin: 0 !important;
  padding: 0 !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;`;

const newHeader = `header.mcj-boss-header,
header.mcj-boss-header.site-header,
header.mcj-boss-header.topbar {
  box-sizing: border-box !important;
  width: 100% !important;
  height: auto !important;
  min-height: calc(72px + constant(safe-area-inset-top)) !important;
  min-height: calc(72px + env(safe-area-inset-top, 0px)) !important;
  max-height: none !important;
  margin: 0 !important;
  padding: 0 !important;
  padding-top: constant(safe-area-inset-top) !important;
  padding-top: env(safe-area-inset-top, 0px) !important;
  display: flex !important;
  align-items: stretch !important;
  justify-content: center !important;`;

if (!t.includes(oldHeader)) throw new Error("header block not found");
t = t.replace(oldHeader, newHeader);

const oldInner = `  height: 72px !important;
  min-height: 72px !important;
  max-height: 72px !important;
  margin: 0 auto !important;
  padding: 0 24px !important;
  display: flex !important;
  align-items: center !important;
  justify-content: space-between !important;`;

const newInner = `  height: 72px !important;
  min-height: 72px !important;
  max-height: 72px !important;
  margin: 0 auto !important;
  padding: 0 24px !important;
  padding-left: max(16px, calc(constant(safe-area-inset-left) + 14px)) !important;
  padding-left: max(16px, calc(env(safe-area-inset-left, 0px) + 14px)) !important;
  padding-right: max(16px, calc(constant(safe-area-inset-right) + 12px)) !important;
  padding-right: max(16px, calc(env(safe-area-inset-right, 0px) + 12px)) !important;
  display: flex !important;
  align-items: center !important;
  justify-content: space-between !important;`;

if (!t.includes(oldInner)) throw new Error("inner block not found");
t = t.replace(oldInner, newInner);

const oldBrand = `header.mcj-boss-header .mcj-boss-brand,
header.mcj-boss-header .brand.mcj-boss-brand {
  flex: 0 0 auto !important;
  display: inline-flex !important;
  align-items: center !important;
  gap: 0 !important;
  margin: 0 !important;`;

const newBrand = `header.mcj-boss-header .mcj-boss-brand,
header.mcj-boss-header .brand.mcj-boss-brand {
  flex: 0 0 auto !important;
  display: inline-flex !important;
  align-items: center !important;
  gap: 0 !important;
  margin: 0 12px 0 0 !important;`;

if (!t.includes(oldBrand)) throw new Error("brand block not found");
t = t.replace(oldBrand, newBrand);

const old980 = `    height: 72px !important;
    min-height: 72px !important;
    max-height: 72px !important;
    flex-wrap: nowrap !important;
    padding-left: 14px !important;
    padding-right: 14px !important;`;

const new980 = `    height: auto !important;
    min-height: 0 !important;
    max-height: none !important;
    flex-wrap: nowrap !important;`;

if (!t.includes(old980)) throw new Error("980 block not found");
t = t.replace(old980, new980);

const old820 = `  header.mcj-boss-header.topbar,
  header.mcj-boss-header.site-header {
    align-items: center !important;
    flex-direction: row !important;
    padding: 0 !important;
    height: 72px !important;
    min-height: 72px !important;
    max-height: 72px !important;
  }`;

const new820 = `  header.mcj-boss-header.topbar,
  header.mcj-boss-header.site-header {
    align-items: stretch !important;
    flex-direction: row !important;
    padding: 0 !important;
    padding-top: constant(safe-area-inset-top) !important;
    padding-top: env(safe-area-inset-top, 0px) !important;
    height: auto !important;
    min-height: calc(72px + env(safe-area-inset-top, 0px)) !important;
    max-height: none !important;
  }`;

if (!t.includes(old820)) throw new Error("820 block not found");
t = t.replace(old820, new820);

const oldPad = `    padding-left: max(10px, env(safe-area-inset-left)) !important;
    padding-right: max(10px, env(safe-area-inset-right)) !important;`;

const newPad = `    padding-left: max(16px, calc(constant(safe-area-inset-left) + 14px)) !important;
    padding-left: max(16px, calc(env(safe-area-inset-left, 0px) + 14px)) !important;
    padding-right: max(14px, calc(constant(safe-area-inset-right) + 10px)) !important;
    padding-right: max(14px, calc(env(safe-area-inset-right, 0px) + 10px)) !important;`;

if (!t.includes(oldPad)) throw new Error("pad block not found");
t = t.replace(oldPad, newPad);

// Keep inner row height under media that zeroed heights
const keepInner = `
@media (max-width: 980px) {
  header.mcj-boss-header .mcj-boss-header-inner,
  header.mcj-boss-header .header-inner,
  header.mcj-boss-header .topbar-inner {
    height: 72px !important;
    min-height: 72px !important;
    max-height: 72px !important;
  }
}
`;
if (!t.includes("/* safe-area inner row lock */")) {
  t += `\n/* safe-area inner row lock */${keepInner}`;
}

fs.writeFileSync(bh, t);
console.log("boss-header.css ok");

let js = fs.readFileSync("src/boss-header.js", "utf8");
const oldEnsure = 'ensureCss("/src/boss-header.css?v=20260731-mobile-nav", "data-mcj-boss-header-css");';
const newEnsure =
  'ensureCss("/src/boss-header.css?v=20260801safeArea", "data-mcj-boss-header-css");\n    ensureCss("/src/mcj-safe-area.css?v=20260801safeArea", "data-mcj-safe-area-css");';
if (!js.includes(oldEnsure) && !js.includes("mcj-safe-area.css")) {
  throw new Error("ensureCss line not found: " + js.includes("boss-header.css"));
}
if (js.includes(oldEnsure)) js = js.replace(oldEnsure, newEnsure);
else if (!js.includes("mcj-safe-area.css")) {
  js = js.replace(
    /ensureCss\("\/src\/boss-header\.css[^"]*",\s*"data-mcj-boss-header-css"\);/,
    newEnsure
  );
}
fs.writeFileSync("src/boss-header.js", js);
console.log("boss-header.js ok", js.includes("mcj-safe-area.css"));
