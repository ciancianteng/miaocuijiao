import fs from "node:fs";

const cfg = fs.readFileSync("vite.config.js", "utf8");
const pages = [...cfg.match(/const pages = \[([\s\S]*?)\];/)[1].matchAll(/"([^"]+\.html)"/g)].map((m) => m[1]);
const issues = [];
for (const p of pages) {
  if (!fs.existsSync(p)) {
    issues.push(`MISSING ${p}`);
    continue;
  }
  const b = fs.readFileSync(p);
  if (b.length < 50) issues.push(`EMPTY ${p} ${b.length}`);
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(b);
  } catch {
    issues.push(`BADUTF8 ${p}`);
  }
}
console.log("vite pages", pages.length, "issues", issues.length);
for (const i of issues) console.log(i);
process.exit(issues.length ? 1 : 0);
