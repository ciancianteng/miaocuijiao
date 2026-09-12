import fs from "node:fs";

const p = "src/boss-header.css";
let t = fs.readFileSync(p, "utf8");
const start = t.indexOf("/* ---------- Shared nav chrome");
const end = t.indexOf("@media (min-width: 900px)");
if (start < 0 || end < 0) {
  console.error("markers", start, end);
  process.exit(1);
}

const block = `/* ---------- Shared nav chrome: compact frosted chips ---------- */
header.mcj-boss-header {
  --mcj-nav-h: 40px;
  --mcj-nav-radius: 10px;
  --mcj-nav-pink: #ffb6d9;
  --mcj-nav-pink-soft: #ffe3f0;
  --mcj-nav-pink-deep: rgba(255, 158, 207, 0.38);
  --mcj-nav-glass: rgba(10, 8, 12, 0.78);
  --mcj-nav-glass-hover: rgba(18, 14, 20, 0.88);
}

header.mcj-boss-header .mcj-desk-nav {
  display: none;
}

header.mcj-boss-header .mcj-mnav {
  display: none;
}

header.mcj-boss-header .mcj-desk-nav > a,
header.mcj-boss-header .mcj-mnav-drawer a,
header.mcj-boss-header .mcj-mnav-drawer .mcj-mnav-logout,
header.mcj-boss-header .mcj-mnav-toggle {
  box-sizing: border-box;
  position: relative;
  height: var(--mcj-nav-h);
  min-height: var(--mcj-nav-h);
  max-height: var(--mcj-nav-h);
  border-radius: var(--mcj-nav-radius);
  border: 1px solid var(--mcj-nav-pink-deep);
  background: var(--mcj-nav-glass);
  backdrop-filter: blur(10px) saturate(1.1);
  -webkit-backdrop-filter: blur(10px) saturate(1.1);
  color: #f7f0f4;
  text-decoration: none;
  font-size: 13px;
  font-weight: 750;
  letter-spacing: 0.02em;
  white-space: nowrap;
  cursor: pointer;
  overflow: hidden;
  box-shadow: none;
  transition: border-color 0.18s ease, background 0.18s ease, color 0.18s ease;
}

header.mcj-boss-header .mcj-desk-nav > a,
header.mcj-boss-header .mcj-mnav-drawer a,
header.mcj-boss-header .mcj-mnav-drawer .mcj-mnav-logout {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 12px;
}

header.mcj-boss-header .mcj-desk-nav > a::after,
header.mcj-boss-header .mcj-mnav-drawer a::after {
  content: "";
  position: absolute;
  left: 22%;
  right: 22%;
  bottom: 5px;
  height: 1.5px;
  border-radius: 999px;
  background: var(--mcj-nav-pink);
  opacity: 0;
  transform: scaleX(0.6);
  transition: opacity 0.18s ease, transform 0.18s ease;
  pointer-events: none;
  box-shadow: none;
}

header.mcj-boss-header .mcj-desk-nav > a:hover,
header.mcj-boss-header .mcj-mnav-drawer a:hover,
header.mcj-boss-header .mcj-mnav-drawer .mcj-mnav-logout:hover,
header.mcj-boss-header .mcj-mnav-toggle:hover {
  background: var(--mcj-nav-glass-hover);
  border-color: rgba(255, 180, 220, 0.55);
  box-shadow: none;
}

header.mcj-boss-header .mcj-desk-nav > a.active,
header.mcj-boss-header .mcj-mnav-drawer a.active {
  color: var(--mcj-nav-pink-soft);
  background: rgba(12, 9, 14, 0.92);
  border-color: rgba(255, 180, 220, 0.55);
  font-weight: 850;
  box-shadow: none;
}

header.mcj-boss-header .mcj-desk-nav > a.active::after,
header.mcj-boss-header .mcj-mnav-drawer a.active::after {
  opacity: 1;
  transform: scaleX(1);
}

header.mcj-boss-header .mcj-desk-nav > a:focus-visible,
header.mcj-boss-header .mcj-mnav-drawer a:focus-visible,
header.mcj-boss-header .mcj-mnav-drawer .mcj-mnav-logout:focus-visible,
header.mcj-boss-header .mcj-mnav-toggle:focus-visible {
  outline: none;
  border-color: rgba(255, 200, 230, 0.75);
  box-shadow: 0 0 0 1px rgba(255, 180, 220, 0.25);
}

`;

t = t.slice(0, start) + block + t.slice(end);

// Desktop desk-nav: content-sized chips, never wrap
t = t.replace(
  /header\.mcj-boss-header \.mcj-desk-nav \{\n    display: flex !important;\n    flex-wrap: nowrap !important;\n    align-items: center;\n    justify-content: flex-end;\n    gap: 8px;\n    flex: 1 1 auto;\n    min-width: 0;\n    width: auto;\n    margin-left: auto;\n    max-width: min\(720px, calc\(100% - 200px\)\);\n    order: 2;\n  \}\n\n  header\.mcj-boss-header \.mcj-desk-nav > a \{\n    flex: 1 1 0;\n    min-width: 0;\n    width: auto;\n    max-width: 112px;\n    padding: 0 10px;\n    font-size: 14px;\n  \}/,
  `header.mcj-boss-header .mcj-desk-nav {
    display: flex !important;
    flex-wrap: nowrap !important;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
    flex: 0 1 auto;
    min-width: 0;
    width: auto;
    margin-left: auto;
    max-width: none;
    order: 2;
  }

  header.mcj-boss-header .mcj-desk-nav > a {
    flex: 0 0 auto;
    min-width: 0;
    width: auto;
    max-width: none;
    padding: 0 11px;
    font-size: 13px;
  }`
);

// Mobile: brand left, hamburger right
t = t.replace(
  "/* ---------- Mobile / tablet (<900): ☰ left + brand ——— */",
  "/* ---------- Mobile / tablet (<900): brand left + ☰ right ——— */"
);

t = t.replace(
  /header\.mcj-boss-header \.mcj-mnav \{\n    display: flex !important;\n    align-items: center !important;\n    justify-content: center !important;\n    flex: 0 0 auto !important;\n    flex-grow: 0 !important;\n    flex-shrink: 0 !important;\n    order: 0 !important;\n    gap: 0 !important;\n    width: auto !important;\n    max-width: 48px !important;\n    min-width: 40px !important;\n    margin: 0 !important;\n    position: relative !important;\n    z-index: 3 !important;\n  \}\n\n  header\.mcj-boss-header \.mcj-header-brand \{\n    display: flex !important;\n    flex: 1 1 auto !important;\n    flex-grow: 1 !important;\n    order: 1 !important;\n    max-width: none !important;\n    min-width: 0 !important;\n    pointer-events: auto !important;\n    margin: 0 !important;\n  \}/,
  `header.mcj-boss-header .mcj-header-brand {
    display: flex !important;
    flex: 1 1 auto !important;
    flex-grow: 1 !important;
    order: 0 !important;
    max-width: none !important;
    min-width: 0 !important;
    pointer-events: auto !important;
    margin: 0 !important;
  }

  header.mcj-boss-header .mcj-mnav {
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    flex: 0 0 auto !important;
    flex-grow: 0 !important;
    flex-shrink: 0 !important;
    order: 2 !important;
    gap: 0 !important;
    width: auto !important;
    max-width: 48px !important;
    min-width: 40px !important;
    margin: 0 0 0 auto !important;
    position: relative !important;
    z-index: 3 !important;
  }`
);

// Soften toggle expanded glow
t = t.replace(
  /header\.mcj-boss-header \.mcj-mnav-toggle\[aria-expanded="true"\] \{\n    color: var\(--mcj-nav-pink-soft\);\n    border-color: rgba\(255, 158, 207, 0\.72\);\n    box-shadow:\n      inset 0 1px 0 rgba\(255, 220, 235, 0\.08\),\n      0 0 18px rgba\(255, 100, 170, 0\.3\);\n  \}/,
  `header.mcj-boss-header .mcj-mnav-toggle[aria-expanded="true"] {
    color: var(--mcj-nav-pink-soft);
    border-color: rgba(255, 158, 207, 0.55);
    box-shadow: none;
  }`
);

// Drawer logout button spacing
if (!t.includes(".mcj-mnav-drawer .mcj-mnav-logout")) {
  t += `
.mcj-mnav-drawer .mcj-mnav-logout {
  width: 100%;
  margin-top: 4px;
  font: inherit;
}
.mcj-mnav-drawer-links {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
`;
}

fs.writeFileSync(p, t, "utf8");
console.log("patched boss-header.css");
