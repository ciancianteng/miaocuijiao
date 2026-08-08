#!/usr/bin/env node
/**
 * Live DNS diagnosis for meowcuijiao.com + printable Resend / site recipe.
 *
 * Usage:
 *   node scripts/check-meowcuijiao-dns.mjs
 *   node scripts/check-meowcuijiao-dns.mjs --json
 *
 * Does NOT mutate DNS. Safe to run anytime.
 */
import { spawnSync } from "node:child_process";
import {
  DOMAIN,
  LIVE_NS_BLOCKED,
  NAMECHEAP_BASIC_NS,
  VERCEL_NS,
  SITE_RECORDS_NAMECHEAP,
  buildResendNamecheapRecords,
} from "./dns-meowcuijiao-recipe.mjs";

const asJson = process.argv.includes("--json");

function dig(type, name = DOMAIN) {
  const res = spawnSync("dig", ["+short", type, name], { encoding: "utf8" });
  return String(res.stdout || "")
    .trim()
    .split(/\n+/)
    .map((s) => s.trim().replace(/\.$/, ""))
    .filter(Boolean);
}

function digFull(type, name = DOMAIN) {
  const res = spawnSync("dig", ["+short", type, name, "@8.8.8.8"], { encoding: "utf8" });
  return String(res.stdout || "")
    .trim()
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const ns = dig("NS");
const a = dig("A");
const mx = dig("MX");
const txt = dig("TXT");
const dkim = digFull("TXT", `resend._domainkey.${DOMAIN}`);
const sendMx = digFull("MX", `send.${DOMAIN}`);
const sendTxt = digFull("TXT", `send.${DOMAIN}`);
const dmarc = digFull("TXT", `_dmarc.${DOMAIN}`);

const whoisLocked = ns.some((n) =>
  LIVE_NS_BLOCKED.some((b) => n.toLowerCase().includes(b.replace(/\.namecheap\.com$/i, "")) || n.toLowerCase() === b.toLowerCase().replace(/\.$/, ""))
) || ns.some((n) => /failed-whois|verify-contact/i.test(n));

const onNamecheapBasic = ns.every((n) => NAMECHEAP_BASIC_NS.some((b) => n.toLowerCase() === b.toLowerCase()));
const onVercelNs = ns.every((n) => VERCEL_NS.some((b) => n.toLowerCase() === b.toLowerCase()));

/** Default DKIM p= from last known Resend domain (refresh via admin/resend-domain). */
const DEFAULT_DKIM_P =
  "p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDSIU4FeJncyJAA+pjWMZDLWf49XtBQWLjwN4m74zeygUup2Jp539bhk0wQQorYZ7jkkZky3vXtqcgnUUIIAQDQvEAfnvPkedIgj7/+txF9X41pNek7dvis/G+OEnICN95Ikmm0kHmbiTk+SXrSLlRWPfAOhwZkng9+TpLbX5rLZwIDAQAB";

const resendRecords = buildResendNamecheapRecords({ dkimP: DEFAULT_DKIM_P });

const report = {
  domain: DOMAIN,
  checkedAt: new Date().toISOString(),
  live: {
    ns,
    a,
    mx,
    txt,
    resend: { dkim, sendMx, sendTxt, dmarc },
  },
  diagnosis: {
    whoisLocked,
    onNamecheapBasic,
    onVercelNs,
    siteLikelyParked: a.includes("198.54.117.242") || whoisLocked,
    resendRecordsPublic: Boolean(dkim.length && sendMx.length && sendTxt.length),
    blocker: whoisLocked
      ? "Namecheap WHOIS contact verification pending — public NS are suspension hosts; neither Namecheap Advanced DNS nor Vercel DNS can go live until WHOIS is verified."
      : onVercelNs
        ? "Vercel NS live — Resend records should already be on Vercel DNS; trigger Resend Verify."
        : onNamecheapBasic
          ? "Namecheap BasicDNS live — publish site + Resend rows in Advanced DNS, then Resend Verify."
          : "Unexpected NS set — compare with Namecheap / Vercel dashboards.",
  },
  recommendedPath: {
    title: "Keep Namecheap DNS (do not require Vercel nameservers)",
    steps: [
      "Namecheap → Domain List → meowcuijiao.com → complete Registrant WHOIS email verification.",
      `Restore Custom DNS / BasicDNS nameservers: ${NAMECHEAP_BASIC_NS.join(", ")}.`,
      "Advanced DNS → delete parking/URL-redirect leftovers that conflict.",
      "Add the site + Resend records below exactly.",
      "Wait for propagation (often minutes; up to 30–60m).",
      "Resend dashboard (or POST /api/admin/resend-domain action=verify) → status Verified.",
      "Confirm meowcuijiao.com / www open the Vercel site (not Namecheap parking).",
      "Retest: register OTP, forgot-password OTP, designated-order notify email.",
    ],
    alternativeVercelNs: {
      nameservers: VERCEL_NS,
      note: "Resend DKIM/SPF/MX/DMARC already preloaded in Vercel DNS. Only switch NS after WHOIS unlock if you prefer Vercel to manage DNS.",
    },
  },
  namecheapAdvancedDns: [...SITE_RECORDS_NAMECHEAP, ...resendRecords],
  vercelEnvAlreadySet: ["RESEND_API_KEY (Preview+Production)", "RESEND_FROM", "RESEND_ORDERS_FROM"],
};

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(whoisLocked || !report.diagnosis.resendRecordsPublic ? 2 : 0);
}

console.log(`\n=== DNS check: ${DOMAIN} ===`);
console.log(`checkedAt: ${report.checkedAt}`);
console.log(`\nLive NS:\n  ${ns.join("\n  ") || "(none)"}`);
console.log(`Live A:\n  ${a.join("\n  ") || "(none)"}`);
console.log(`\nResend public records:`);
console.log(`  DKIM TXT count: ${dkim.length}`);
console.log(`  send MX: ${sendMx.join(" | ") || "(none)"}`);
console.log(`  send TXT: ${sendTxt.join(" | ") || "(none)"}`);
console.log(`  _dmarc: ${dmarc.join(" | ") || "(none)"}`);
console.log(`\nDiagnosis: ${report.diagnosis.blocker}`);
console.log(`\n--- Namecheap Advanced DNS (after WHOIS unlock) ---`);
for (const r of report.namecheapAdvancedDns) {
  const pri = r.priority != null ? ` Priority=${r.priority}` : "";
  console.log(`  ${r.type.padEnd(5)} Host=${r.host.padEnd(18)} Value=${r.value}${pri}  # ${r.note || ""}`);
}
console.log(`\nVercel intended NS (optional alternative): ${VERCEL_NS.join(", ")}`);
console.log(`Namecheap BasicDNS: ${NAMECHEAP_BASIC_NS.join(", ")}`);
console.log("");
process.exit(whoisLocked || !report.diagnosis.resendRecordsPublic ? 2 : 0);
