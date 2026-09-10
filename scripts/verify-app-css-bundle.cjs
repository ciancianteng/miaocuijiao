const fs = require("fs");
const { execSync } = require("child_process");
execSync("npm run build", { stdio: "inherit" });
const h = fs.readFileSync("dist/index.html", "utf8");
const css = [...h.matchAll(/href="([^"]+\.css[^"]*)"/g)].map((m) => m[1]);
const assets = fs.readdirSync("dist/assets").filter((f) => f.endsWith(".css"));
const bundled = assets.map((f) => {
  const t = fs.readFileSync("dist/assets/" + f, "utf8");
  return {
    f,
    hasApp: t.includes("mcj-app-tabbar") || t.includes("home-brand-hero"),
    hasTab: t.includes("mcj-app-tabbar"),
    hasBrand: t.includes("home-brand-hero"),
  };
});
console.log(JSON.stringify({ cssLinks: css.filter((c) => /home|boss|index|style/.test(c)), bundled: bundled.filter((b) => b.hasApp || b.hasTab || b.hasBrand) }, null, 2));
