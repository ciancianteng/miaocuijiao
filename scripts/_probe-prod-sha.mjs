import { spawnSync } from "node:child_process";

function run(args) {
  return spawnSync("npx", args, { encoding: "utf8", shell: true, maxBuffer: 20 * 1024 * 1024 });
}

const inspect = run([
  "vercel",
  "inspect",
  "meow-cuijiao-homepage-qkyo3b8r3-ciancianteng-4581s-projects.vercel.app",
]);
const text = `${inspect.stdout || ""}\n${inspect.stderr || ""}`;
fsWrite("artifacts/gift-release/prod-inspect.txt", text);
const shaMatch =
  text.match(/commit\s+[`]?([0-9a-f]{7,40})/i) ||
  text.match(/github\.com\/[^/]+\/[^/]+\/commit\/([0-9a-f]{7,40})/i) ||
  text.match(/"githubCommitSha"\s*:\s*"([0-9a-f]{7,40})"/i) ||
  text.match(/gitCommitSha[\"']?\s*[:=]\s*[\"']([0-9a-f]{7,40})/i);
console.log("sha_from_text", shaMatch?.[1] || null);

const alias = run(["vercel", "alias", "ls"]);
const atext = `${alias.stdout || ""}\n${alias.stderr || ""}`;
fsWrite("artifacts/gift-release/prod-alias.txt", atext);
const lines = atext.split(/\r?\n/).filter((l) => /meowcuijiao\.com|www\.meowcuijiao/i.test(l));
console.log("alias_lines", lines.slice(0, 10));

function fsWrite(p, c) {
  import("node:fs").then((fs) => {
    fs.mkdirSync("artifacts/gift-release", { recursive: true });
    fs.writeFileSync(p, c);
  });
}

// sync write
import fs from "node:fs";
fs.mkdirSync("artifacts/gift-release", { recursive: true });
fs.writeFileSync("artifacts/gift-release/prod-inspect.txt", text);
fs.writeFileSync("artifacts/gift-release/prod-alias.txt", atext);

// API: deployment meta via vercel
const api = run(["vercel", "inspect", "meow-cuijiao-homepage-qkyo3b8r3-ciancianteng-4581s-projects.vercel.app", "--json"]);
const raw = `${api.stdout || ""}`;
const i = raw.indexOf("{");
const j = raw.lastIndexOf("}");
if (i >= 0 && j > i) {
  const obj = JSON.parse(raw.slice(i, j + 1));
  const d = obj.deployment || obj;
  console.log(
    JSON.stringify(
      {
        meta: d.meta,
        gitSource: d.gitSource,
        projectSettings: d.projectSettings,
        aliasAssigned: d.aliasAssigned,
      },
      null,
      2
    ).slice(0, 2500)
  );
}
