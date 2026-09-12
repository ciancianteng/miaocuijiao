import fs from "node:fs";
import path from "node:path";

const roots = [".", "src", "admin", "companion", "customer-service"];
const files = [];
function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "dist" || name === ".git") continue;
      walk(p);
    } else if (/\.(css|html)$/i.test(name)) files.push(p);
  }
}
for (const r of roots) walk(r);

const problems = [];
for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  const chunks = file.endsWith(".html")
    ? [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m, i) => ({ i, css: m[1], start: m.index }))
    : [{ i: 0, css: text, start: 0 }];

  for (const { i, css, start } of chunks) {
    // naive scan for unclosed quotes in CSS string tokens
    let inSingle = false;
    let inDouble = false;
    let inComment = false;
    for (let idx = 0; idx < css.length; idx++) {
      const ch = css[idx];
      const prev = css[idx - 1];
      if (inComment) {
        if (ch === "/" && prev === "*") inComment = false;
        continue;
      }
      if (!inSingle && !inDouble && ch === "/" && css[idx + 1] === "*") {
        inComment = true;
        idx++;
        continue;
      }
      if (!inDouble && ch === "'" && prev !== "\\") inSingle = !inSingle;
      else if (!inSingle && ch === '"' && prev !== "\\") inDouble = !inDouble;
    }
    if (inSingle || inDouble) {
      const line = text.slice(0, start).split(/\n/).length;
      problems.push({ file, styleIndex: i, open: inSingle ? "single" : "double", approxLine: line });
    }
  }
}

if (!problems.length) {
  console.log("No unclosed CSS string quotes found in html/css under scanned roots.");
} else {
  console.log("FOUND unclosed CSS strings:");
  for (const p of problems) console.log(JSON.stringify(p));
  process.exitCode = 1;
}
