/**
 * Strip import.meta from server runtime loadLocalEnv / ROOT helpers.
 * Does not change business logic.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const targets = [];

function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) {
      walk(full);
      continue;
    }
    if (!name.endsWith(".js")) continue;
    targets.push(full);
  }
}

walk(path.join(root, "server", "api"));
targets.push(path.join(root, "api", "[...path].js"));

let changed = 0;
for (const file of targets) {
  if (!fs.existsSync(file)) continue;
  let text = fs.readFileSync(file, "utf8");
  if (!text.includes("import.meta")) continue;
  const before = text;

  // loadLocalEnv style A: apiDir + single resolve
  text = text.replace(
    /function loadLocalEnv\(\)\s*\{\s*const apiDir = path\.dirname\(fileURLToPath\(import\.meta\.url\)\);\s*const envPath = path\.resolve\(apiDir,[^;]+;/g,
    'function loadLocalEnv() {\n  const envPath = path.resolve(process.cwd(), ".env.local");'
  );

  // loadLocalEnv style B: auth.js candidates with apiDir
  text = text.replace(
    /function loadLocalEnv\(\)\s*\{\s*const apiDir = path\.dirname\(fileURLToPath\(import\.meta\.url\)\);\s*\/\/[^\n]*\n\s*const candidates = \[[\s\S]*?\];\s*const envPath = candidates\.find\(\(p\) => fs\.existsSync\(p\)\);/g,
    'function loadLocalEnv() {\n  const envPath = path.resolve(process.cwd(), ".env.local");'
  );

  // gateway / catch-all ROOT via import.meta.url
  text = text.replace(
    /const __dirname = dirname\(fileURLToPath\(import\.meta\.url\)\);\s*\nconst ROOT = join\(__dirname, "\.\.", "server", "api"\);/,
    'const ROOT = join(process.cwd(), "server", "api");'
  );
  text = text.replace(
    /const ROOT = dirname\(fileURLToPath\(import\.meta\.url\)\);/,
    'const ROOT = join(process.cwd(), "server", "api");'
  );

  // leftover import.meta.url in fileURLToPath
  if (text.includes("import.meta")) {
    text = text.replace(/path\.dirname\(fileURLToPath\(import\.meta\.url\)\)/g, "process.cwd()");
    text = text.replace(/fileURLToPath\(import\.meta\.url\)/g, "process.cwd()");
    text = text.replace(/import\.meta\.url/g, "process.cwd()");
  }

  // Drop unused fileURLToPath / dirname imports when no longer referenced
  if (!text.includes("fileURLToPath")) {
    text = text.replace(/,?\s*fileURLToPath/g, "");
    text = text.replace(/fileURLToPath\s*,?\s*/g, "");
  }
  if (!/\bdirname\b/.test(text.replace(/from "node:path"/, ""))) {
    // keep dirname if still used elsewhere
  }
  if (!text.includes("dirname(") && text.includes('from "node:path"')) {
    text = text.replace(/,?\s*dirname/g, "");
    text = text.replace(/dirname\s*,?\s*/g, "");
  }
  text = text.replace(/import \{\s*\} from "node:url";\r?\n/g, "");
  text = text.replace(/import \{\s*\} from "node:path";\r?\n/g, "");

  if (text !== before) {
    fs.writeFileSync(file, text);
    changed += 1;
    console.log("PATCHED", path.relative(root, file).replace(/\\/g, "/"));
  }
}

console.log("CHANGED", changed);

// Report leftover import.meta in server + api catch-all
const leftovers = [];
for (const file of targets) {
  if (!fs.existsSync(file)) continue;
  const t = fs.readFileSync(file, "utf8");
  if (t.includes("import.meta")) leftovers.push(path.relative(root, file).replace(/\\/g, "/"));
}
console.log("LEFTOVER", JSON.stringify(leftovers));
