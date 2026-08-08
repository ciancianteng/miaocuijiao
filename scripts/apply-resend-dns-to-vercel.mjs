/**
 * Add Resend/DMARC DNS records into Vercel DNS for meowcuijiao.com.
 * Reads plan JSON from --plan= path (default /tmp/resend-dns-plan.json).
 *
 * Usage:
 *   node scripts/apply-resend-dns-to-vercel.mjs --plan=/tmp/resend-dns-plan.json
 *
 * MX syntax (Vercel CLI):
 *   vercel dns add <domain> <name> MX <value> <priority>
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
  return run(["dns", "ls", DOMAIN]).out;
}

function normalizeDkim(value) {
  const v = String(value || "").trim();
  if (!v) return v;
  if (/^v=DKIM1/i.test(v)) return v;
  if (/^p=/i.test(v)) return `v=DKIM1; k=rsa; ${v}`;
  return v;
}

function addRecord(rec) {
  const type = String(rec.type || "").toUpperCase();
  const name = rec.name === "@" ? "" : String(rec.name || "");
  let value = String(rec.value || "");
  if (!type || !value) return { skipped: true, reason: "missing type/value" };
  if (type === "TXT" && /domainkey/i.test(name || "")) value = normalizeDkim(value);

  let args;
  if (type === "MX") {
    const pri = rec.priority == null ? 10 : Number(rec.priority);
    args = ["dns", "add", DOMAIN, name || "send", "MX", value, String(pri)];
  } else if (type === "TXT") {
    args = ["dns", "add", DOMAIN, name || "@", "TXT", value];
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
