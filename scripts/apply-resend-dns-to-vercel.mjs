/**
 * Add Resend/DMARC DNS records into Vercel DNS for meowcuijiao.com.
 * Reads plan from /tmp/resend-dns-plan.json (or --plan=path).
 *
 * Usage:
 *   node scripts/apply-resend-dns-to-vercel.mjs --plan=/tmp/resend-dns-plan.json
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";

const DOMAIN = "meowcuijiao.com";
const planPath = (process.argv.find((a) => a.startsWith("--plan=")) || "").slice(7) || "/tmp/resend-dns-plan.json";

function run(args) {
  const res = spawnSync("npx", ["vercel", ...args], {
    encoding: "utf8",
    shell: true,
    maxBuffer: 5 * 1024 * 1024,
  });
  return {
    status: res.status,
    out: `${res.stdout || ""}\n${res.stderr || ""}`.trim(),
  };
}

function listExisting() {
  const res = run(["dns", "ls", DOMAIN]);
  return res.out;
}

function addRecord(rec) {
  const type = String(rec.type || "").toUpperCase();
  const name = rec.name === "@" ? "" : String(rec.name || "");
  const value = String(rec.value || "");
  if (!type || !value) return { skipped: true, reason: "missing type/value" };

  // vercel dns add domain [name] type value
  // MX: vercel dns add domain name MX "priority value" OR separate?
  // Docs: vercel dns add <domain> <name> <type> <value>
  // For MX, value often "10 feedback-smtp...."
  let args;
  if (type === "MX") {
    const pri = rec.priority == null ? 10 : Number(rec.priority);
    const host = name || "send";
    args = ["dns", "add", DOMAIN, host, "MX", String(pri), value];
  } else if (type === "TXT") {
    const host = name || "@";
    // Quote TXT value
    args = ["dns", "add", DOMAIN, host === "@" ? "" : host, "TXT", value].filter((x, i, arr) => {
      // keep empty name as explicit ""
      return true;
    });
    // Rebuild carefully: empty name means apex
    if (!name) args = ["dns", "add", DOMAIN, "@", "TXT", value];
    else args = ["dns", "add", DOMAIN, name, "TXT", value];
  } else if (type === "CNAME") {
    args = ["dns", "add", DOMAIN, name || "www", "CNAME", value.replace(/\.$/, "")];
  } else {
    return { skipped: true, reason: `unsupported type ${type}` };
  }

  const res = run(args);
  return { args, status: res.status, out: res.out };
}

const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
console.log("existing DNS:\n", listExisting());
console.log("\napplying", (plan.records || []).length, "records…");
for (const rec of plan.records || []) {
  const result = addRecord(rec);
  console.log(JSON.stringify({ purpose: rec.purpose, type: rec.type, name: rec.name, result }, null, 2));
}
console.log("\nDNS after:\n", listExisting());
