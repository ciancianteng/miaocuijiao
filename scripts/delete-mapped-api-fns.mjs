import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const mapping = JSON.parse(
  fs.readFileSync(path.join(root, "docs", "api-catchall-mapping.md"), "utf8")
    ? "null"
    : "null"
);

// Recompute delete list from filesystem rules (same as gen-api-mapping)
const apiRoot = path.join(root, "api");
const deleteList = [];

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
    const serverRel = name === "gateway.js" ? "server/api/gateway.js" : "server/api/" + rel;
    if (!fs.existsSync(path.join(root, serverRel))) {
      console.error("REFUSE delete (unmapped):", "api/" + rel);
      process.exitCode = 1;
      return;
    }
    deleteList.push(full);
  }
}

walk(apiRoot);
if (process.exitCode) process.exit(process.exitCode);

for (const full of deleteList) {
  fs.unlinkSync(full);
  console.log("DELETED", path.relative(root, full).replace(/\\/g, "/"));
}

// Remove empty dirs under api (keep api itself)
function rmEmpty(dir) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) rmEmpty(full);
  }
  if (dir === apiRoot) return;
  if (fs.readdirSync(dir).length === 0) {
    fs.rmdirSync(dir);
    console.log("RMDIR", path.relative(root, dir).replace(/\\/g, "/"));
  }
}
rmEmpty(apiRoot);

const remaining = [];
function listFns(dir, base = "") {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = path.posix.join(base.replace(/\\/g, "/"), name);
    if (fs.statSync(full).isDirectory()) {
      listFns(full, rel);
      continue;
    }
    if (!name.endsWith(".js")) continue;
    if (name.startsWith("_")) continue;
    remaining.push("api/" + rel);
  }
}
listFns(apiRoot);
console.log(JSON.stringify({ deleted: deleteList.length, remainingFunctions: remaining }, null, 2));
