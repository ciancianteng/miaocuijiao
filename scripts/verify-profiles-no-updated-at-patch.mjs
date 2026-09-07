/**
 * Offline guard: profiles PATCH/POST payloads must never include updated_at
 * (Production schema has no profiles.updated_at). companion_profiles.updated_at OK.
 *
 * Usage: node scripts/verify-profiles-no-updated-at-patch.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverRoot = path.join(root, "server");

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|mjs|cjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function extractBalanced(text, openIdx, openCh = "{", closeCh = "}") {
  if (openIdx < 0 || text[openIdx] !== openCh) return null;
  let depth = 0;
  for (let i = openIdx; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === openCh) depth += 1;
    else if (ch === closeCh) {
      depth -= 1;
      if (depth === 0) return { text: text.slice(openIdx, i + 1), end: i };
    }
  }
  return null;
}

function extractCallArgs(text, openParenIdx) {
  if (text[openParenIdx] !== "(") return null;
  let depth = 0;
  for (let i = openParenIdx; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return text.slice(openParenIdx + 1, i);
    }
  }
  return null;
}

/**
 * Only inspect stringify bodies inside the same companionDb/supabaseJson("profiles") call.
 */
function findProfilesUpdatedAtOffenders(text, relFile) {
  const hits = [];
  const startRe = /(?:companionDb|supabaseJson)\s*\(/g;
  let match;
  while ((match = startRe.exec(text))) {
    const openParen = match.index + match[0].length - 1;
    const args = extractCallArgs(text, openParen);
    if (!args) continue;
    // Must target profiles table as first table arg (direct or via restUrl("profiles"...)).
    if (!/^\s*(?:restUrl\s*\(\s*)?["']profiles["']/.test(args)) continue;

    // Find top-level object literals in args (call options), ignore nested objects inside query templates.
    const topLevelObjects = [];
    let depthParen = 0;
    let depthBrace = 0;
    let depthBracket = 0;
    let inStr = null;
    let escape = false;
    for (let i = 0; i < args.length; i += 1) {
      const ch = args[i];
      if (inStr) {
        if (escape) escape = false;
        else if (ch === "\\") escape = true;
        else if (ch === inStr) inStr = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        inStr = ch;
        continue;
      }
      if (ch === "(") depthParen += 1;
      else if (ch === ")") depthParen = Math.max(0, depthParen - 1);
      else if (ch === "[") depthBracket += 1;
      else if (ch === "]") depthBracket = Math.max(0, depthBracket - 1);
      else if (ch === "{") {
        if (depthParen === 0 && depthBrace === 0 && depthBracket === 0) {
          const obj = extractBalanced(args, i);
          if (obj) {
            topLevelObjects.push(obj.text);
            i = obj.end;
            continue;
          }
        }
        depthBrace += 1;
      } else if (ch === "}") depthBrace = Math.max(0, depthBrace - 1);
    }

    for (const opts of topLevelObjects) {
      if (!/\bmethod\s*:\s*["'](?:PATCH|POST|PUT)["']/i.test(opts)) continue;
      const stringifyMatch = /JSON\.stringify\s*\(/.exec(opts);
      if (!stringifyMatch) continue;
      const afterFn = opts.slice(stringifyMatch.index + stringifyMatch[0].length);
      const trimmed = afterFn.trimStart();
      const abs = stringifyMatch.index + stringifyMatch[0].length + (afterFn.length - trimmed.length);
      if (trimmed.startsWith("{")) {
        const lit = extractBalanced(opts, abs);
        if (lit && /\bupdated_at\b/.test(lit.text)) {
          hits.push({
            file: relFile,
            snippet: lit.text.replace(/\s+/g, " ").slice(0, 180),
          });
        }
      } else if (/\bupdated_at\b/.test(trimmed.slice(0, 160))) {
        hits.push({
          file: relFile,
          snippet: trimmed.replace(/\s+/g, " ").slice(0, 180),
        });
      }
    }
  }
  return hits;
}

const files = walk(serverRoot);
const offenders = [];
for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  offenders.push(...findProfilesUpdatedAtOffenders(text, path.relative(root, file)));
}

assert.equal(
  offenders.length,
  0,
  `profiles writes must not include updated_at:\n${offenders
    .map((o) => `- ${o.file}: ${o.snippet}`)
    .join("\n")}`
);

const players = fs.readFileSync(path.join(serverRoot, "api/admin/players.js"), "utf8");
assert.match(
  players,
  /function companionEditablePatch[\s\S]*?updated_at/,
  "companion_profiles patch should keep updated_at"
);

const activateFn = players.match(
  /async function activateCompanionProfile\([\s\S]*?\n\}\n\n/
)?.[0];
assert.ok(activateFn, "activateCompanionProfile function not found");
assert.match(activateFn, /status:\s*"active"/);
assert.doesNotMatch(
  activateFn,
  /updated_at\s*:/,
  "activateCompanionProfile must not write profiles.updated_at"
);
assert.doesNotMatch(players, /\.\.\.profilePatch,\s*updated_at:/);

const profilePatchFn = players.match(/function profileEditablePatch\([\s\S]*?\n\}\n\n/)?.[0];
assert.ok(profilePatchFn, "profileEditablePatch function not found");
assert.doesNotMatch(
  profilePatchFn,
  /updated_at/,
  "profileEditablePatch must not set updated_at"
);

const bosses = fs.readFileSync(path.join(serverRoot, "api/admin/bosses.js"), "utf8");
assert.doesNotMatch(
  bosses,
  /display_name:\s*name,\s*updated_at:/,
  "bosses display_name patch must not include updated_at"
);

const purge = fs.readFileSync(path.join(serverRoot, "api/admin/purge-test-data.js"), "utf8");
assert.doesNotMatch(
  purge,
  /status:\s*"disabled",\s*email:[^,]+,\s*updated_at:/,
  "purge-test-data profiles disable must not include updated_at"
);

console.log(
  JSON.stringify(
    {
      ok: true,
      message: "No profiles write payloads include updated_at; companion_profiles.updated_at retained",
      scannedFiles: files.length,
    },
    null,
    2
  )
);
