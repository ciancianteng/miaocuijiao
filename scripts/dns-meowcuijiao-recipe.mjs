/**
 * Authoritative DNS recipe for meowcuijiao.com.
 *
 * LIVE DNS today is NOT on Vercel. Public NS are Namecheap WHOIS-suspension hosts:
 *   failed-whois-verification.namecheap.com
 *   verify-contact-details.namecheap.com
 * Until WHOIS is verified, NO custom DNS (Vercel or Namecheap Advanced) can go live.
 *
 * Recommended after WHOIS unlock (keep Namecheap BasicDNS, do NOT switch to Vercel NS):
 *   - Point website to Vercel with A/CNAME
 *   - Add Resend DKIM/SPF/MX/DMARC on Namecheap Advanced DNS
 *
 * Alternative after WHOIS: switch NS to ns1/ns2.vercel-dns.com (records already preloaded in Vercel DNS).
 */
export const DOMAIN = "meowcuijiao.com";

export const LIVE_NS_BLOCKED = [
  "failed-whois-verification.namecheap.com",
  "verify-contact-details.namecheap.com",
];

export const NAMECHEAP_BASIC_NS = ["dns1.registrar-servers.com", "dns2.registrar-servers.com"];

export const VERCEL_NS = ["ns1.vercel-dns.com", "ns2.vercel-dns.com"];

/** Website → Vercel without giving Vercel nameserver control */
export const SITE_RECORDS_NAMECHEAP = [
  { type: "A", host: "@", value: "76.76.21.21", ttl: "Automatic", note: "apex → Vercel" },
  { type: "CNAME", host: "www", value: "cname.vercel-dns.com.", ttl: "Automatic", note: "www → Vercel" },
];

/**
 * Resend records (values must match current Resend domain dashboard /admin resend-domain API).
 * Host column is Namecheap-style (no domain suffix).
 */
export function buildResendNamecheapRecords({
  dkimP,
  mxHost = "feedback-smtp.ap-northeast-1.amazonses.com.",
  mxPriority = 10,
  spf = "v=spf1 include:amazonses.com ~all",
  dmarc = "v=DMARC1; p=none; rua=mailto:dmarc@meowcuijiao.com",
} = {}) {
  const dkim = String(dkimP || "").trim();
  const dkimValue = /^v=DKIM1/i.test(dkim) ? dkim : `v=DKIM1; k=rsa; ${dkim.replace(/^v=DKIM1;\s*k=rsa;\s*/i, "")}`;
  return [
    {
      type: "TXT",
      host: "resend._domainkey",
      value: dkimValue,
      ttl: "Automatic",
      note: "Resend DKIM",
    },
    {
      type: "MX",
      host: "send",
      value: mxHost.replace(/\.$/, "") + ".",
      priority: mxPriority,
      ttl: "Automatic",
      note: "Resend return-path MX / SPF",
    },
    {
      type: "TXT",
      host: "send",
      value: spf,
      ttl: "Automatic",
      note: "Resend SPF",
    },
    {
      type: "TXT",
      host: "_dmarc",
      value: dmarc,
      ttl: "Automatic",
      note: "DMARC monitor mode",
    },
  ];
}
