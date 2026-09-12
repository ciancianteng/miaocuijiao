import fs from "node:fs";
import path from "node:path";

function walk(d, acc = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist" || e.name === ".git") continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(html|js|css)$/.test(e.name)) acc.push(p);
  }
  return acc;
}

const bad = [];
for (const f of walk(".")) {
  const t = fs.readFileSync(f, "utf8");
  if (
    />(\?{2,})</.test(t) ||
    /placeholder="\?{2,}"/i.test(t) ||
    /<title>\?{2,}/.test(t) ||
    /brand-name">\?{2,}/.test(t)
  ) {
    bad.push(f);
  }
}
console.log(bad.length ? "corrupted:\n" + bad.join("\n") : "corrupted UI files: NONE");
