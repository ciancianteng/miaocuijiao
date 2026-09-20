const fs = require("fs");
const files = fs.readdirSync("dist/assets").filter((f) => /hero-ip|meow-cuijiao-hero/.test(f));
const h = fs.readFileSync("dist/index.html", "utf8");
const m = h.match(/meow-cuijiao-hero[^"'\s]*/);
console.log(
  JSON.stringify(
    {
      files,
      src: m && m[0],
      order:
        h.indexOf("data-home-brand-hero") < h.indexOf("data-mcj-home-hero") &&
        h.indexOf("data-mcj-home-hero") < h.indexOf("homeAnnouncementBar"),
    },
    null,
    2
  )
);
