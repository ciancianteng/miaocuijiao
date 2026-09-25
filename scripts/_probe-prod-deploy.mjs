import { spawnSync } from "node:child_process";

const r = spawnSync(
  "npx",
  ["vercel", "inspect", "meow-cuijiao-homepage-qkyo3b8r3-ciancianteng-4581s-projects.vercel.app", "--json"],
  { encoding: "utf8", shell: true, maxBuffer: 20 * 1024 * 1024 }
);
const text = `${r.stdout || ""}\n${r.stderr || ""}`;
const start = text.indexOf("{");
const end = text.lastIndexOf("}");
if (start < 0 || end < 0) {
  console.log("NO_JSON", text.slice(0, 500));
  process.exit(1);
}
const j = JSON.parse(text.slice(start, end + 1));
const d = j.deployment || j;
console.log(
  JSON.stringify(
    {
      url: d.url,
      readyState: d.readyState,
      meta: d.meta,
      gitSource: d.gitSource,
      alias: d.alias,
      createdAt: d.createdAt,
    },
    null,
    2
  )
);
