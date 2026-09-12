import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const roots = ["server/api", "api", "src", "public"];
const empty = [];

function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(js|mjs|css|json|html)$/.test(e.name)) {
      if (fs.statSync(p).size < 30) empty.push(p);
    }
  }
}
for (const r of roots) if (fs.existsSync(r)) walk(r);

const restored = [];
const missingInGit = [];
const stillEmpty = [];

for (const abs of empty) {
  const rel = path.relative(process.cwd(), abs).replace(/\\/g, "/");
  let buf = null;
  for (const rev of ["HEAD", "c450255", "af4e72b"]) {
    try {
      buf = execSync(`git show ${rev}:${rel}`, {
        encoding: "buffer",
        maxBuffer: 30 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      });
      if (buf && buf.length >= 30) break;
      buf = null;
    } catch {
      buf = null;
    }
  }
  if (!buf) {
    missingInGit.push(rel);
    continue;
  }
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buf);
  restored.push({ rel, bytes: buf.length });
  if (fs.statSync(abs).size < 30) stillEmpty.push(rel);
}

console.log(JSON.stringify({ emptyFound: empty.length, restored: restored.length, missingInGit, stillEmpty, restoredFiles: restored.map((r) => r.rel) }, null, 2));
