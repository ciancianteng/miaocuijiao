import fs from "node:fs";

const s = fs.readFileSync("index.html", "utf8");
console.log("lines", s.split(/\n/).length);
console.log("ok desk nav", /aria-label="桌面主导航"/.test(s));
console.log("ok brand", /aria-label="MEOW CUI JIAO 妙脆角 首页"/.test(s));

const badAria = [...s.matchAll(/aria-label="[^"]*\?>/g)].map((m) => m[0]);
console.log("broken aria-label count", badAria.length, badAria.slice(0, 3));

// Look for unclosed CSS strings in style blocks (common PowerShell corruption)
const styleBlocks = [...s.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)];
let unclosedHints = 0;
for (const [, css] of styleBlocks) {
  const singles = (css.match(/'/g) || []).length;
  const doubles = (css.match(/"/g) || []).length;
  if (singles % 2 !== 0 || doubles % 2 !== 0) unclosedHints += 1;
}
console.log("style blocks", styleBlocks.length, "odd-quote blocks", unclosedHints);
