#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAIN = "fd548cc8437dd682eacbff6c720401d54772367c";
const DPL = "dpl_41reJ76bmyyxPo8RD1PpCHqiPaJN";

const insp = spawnSync("npx", ["vercel", "inspect", DPL, "--format=json"], {
  encoding: "utf8",
  shell: true,
  maxBuffer: 10 * 1024 * 1024,
});
const raw = `${insp.stdout || ""}\n${insp.stderr || ""}`;
const start = raw.indexOf("{");
const end = raw.lastIndexOf("}");
let parsed = null;
if (start >= 0 && end > start) {
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch (e) {
    parsed = { parseError: String(e.message || e), snippet: raw.slice(start, start + 400) };
  }
}

const d = parsed?.deployment || parsed || {};
const meta = d.meta || {};
const sha =
  meta.githubCommitSha ||
  meta.gitCommitSha ||
  meta.commitSha ||
  d.gitSource?.sha ||
  d.gitSource?.refCommitSha ||
  "";

// Also check aliases via curl headers
function head(url) {
  const r = spawnSync("curl", ["-sI", url], { encoding: "utf8", shell: true });
  return r.stdout || "";
}
const www = head("https://www.meowcuijiao.com/");
const apex = head("https://meowcuijiao.com/");

const out = {
  main_sha: MAIN,
  deployment_id: DPL,
  readyState: d.readyState || d.status || null,
  production_sha: sha || null,
  sha_match: sha ? (sha === MAIN || sha.startsWith(MAIN.slice(0, 7)) ? "YES" : "NO") : "UNKNOWN",
  aliases_from_inspect: d.alias || d.aliases || null,
  www_headers: www.split(/\r?\n/).filter((l) => /HTTP|x-vercel|location|server/i.test(l)).slice(0, 12),
  apex_headers: apex.split(/\r?\n/).filter((l) => /HTTP|x-vercel|location|server/i.test(l)).slice(0, 12),
  meta_keys: Object.keys(meta),
  gitSource: d.gitSource || null,
};

const outPath = path.join(root, "artifacts/p0-multi-cs-confirm-notify/PROD_DEPLOY_VERIFY.json");
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
