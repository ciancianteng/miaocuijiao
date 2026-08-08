import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const apiRoot = path.join(root, "api");
const rows = [];

function walk(dir, base = "") {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = path.posix.join(base.replace(/\\/g, "/"), name);
    if (fs.statSync(full).isDirectory()) {
      walk(full, rel);
      continue;
    }
    if (!name.endsWith(".js")) continue;
    if (name.startsWith("_")) continue;
    if (name === "[...path].js") continue;
    const route = "/api/" + rel.replace(/\.js$/, "");
    const serverRel = "server/api/" + rel;
    const isGateway = name === "gateway.js";
    const mapped = isGateway || fs.existsSync(path.join(root, serverRel));
    rows.push({
      oldFile: "api/" + rel,
      publicPath: route,
      server: isGateway ? "server/api/gateway.js" : serverRel,
      mapped,
      isGateway,
    });
  }
}

walk(apiRoot);

const mapped = rows.filter((r) => r.mapped).sort((a, b) => a.publicPath.localeCompare(b.publicPath));
const unmapped = rows.filter((r) => !r.mapped).sort((a, b) => a.publicPath.localeCompare(b.publicPath));

const lines = [
  "# API Catch-all Mapping (pre-delete)",
  "",
  `Generated: ${new Date().toISOString()}`,
  "",
  "Vercel entry (kept): `api/[...path].js` → handlers in `server/api/`.",
  "",
  "Public URL paths stay unchanged (e.g. `/api/auth`). The catch-all resolves them to `server/api/*.js`.",
  "",
  "| Old Function file | Public path (unchanged) | catch-all resolves to | Mapped |",
  "| --- | --- | --- | --- |",
];

for (const r of mapped) {
  lines.push(`| \`${r.oldFile}\` | \`${r.publicPath}\` | \`${r.server}\` | yes |`);
}
for (const r of unmapped) {
  lines.push(`| \`${r.oldFile}\` | \`${r.publicPath}\` | \`${r.server}\` | **NO — keep** |`);
}

lines.push(
  "",
  "## Summary",
  `- Old Function entry files scanned: ${rows.length}`,
  `- Mapped (safe to delete after catch-all ready): ${mapped.length}`,
  `- Unmapped (must keep): ${unmapped.length}`,
  "- Remaining Functions after delete: **1** (`api/[...path].js`); `api/_*.js` helpers are private and not counted",
  "- `api/gateway.js` → copy to `server/api/gateway.js`, then delete old entry",
  "",
  "## Safe-to-delete list",
  ...mapped.map((r) => `- \`${r.oldFile}\` → \`${r.server}\``)
);

fs.mkdirSync(path.join(root, "docs"), { recursive: true });
fs.writeFileSync(path.join(root, "docs/api-catchall-mapping.md"), lines.join("\n"), "utf8");

console.log(
  JSON.stringify(
    {
      total: rows.length,
      mapped: mapped.length,
      unmapped: unmapped.length,
      unmappedFiles: unmapped.map((u) => u.oldFile),
      deleteList: mapped.map((m) => m.oldFile),
    },
    null,
    2
  )
);
