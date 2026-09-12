/**
 * Setup Resend domain meowcuijiao.com and print DNS records to add.
 * Usage: npx vercel env run -- node scripts/resend-domain-setup.mjs
 */
const DOMAIN = process.env.MCJ_MAIL_DOMAIN || "meowcuijiao.com";
const REGION = process.env.RESEND_REGION || "ap-northeast-1";

function key() {
  const k = String(process.env.RESEND_API_KEY || "").trim();
  if (!k || k === "[SENSITIVE]") throw new Error("RESEND_API_KEY missing in env run");
  return k;
}

async function resend(path, { method = "GET", body } = {}) {
  const res = await fetch(`https://api.resend.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key()}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { ok: res.ok, status: res.status, json };
}

function printRecords(records = []) {
  console.log("\n=== DNS records to publish ===");
  for (const r of records) {
    console.log(
      JSON.stringify(
        {
          purpose: r.record || r.type,
          type: r.type,
          name: r.name,
          value: r.value,
          priority: r.priority,
          ttl: r.ttl,
          status: r.status,
        },
        null,
        0
      )
    );
  }
}

(async () => {
  console.log("from_env", {
    hasKey: !!process.env.RESEND_API_KEY && process.env.RESEND_API_KEY !== "[SENSITIVE]",
    from: process.env.RESEND_FROM || "",
    domain: DOMAIN,
  });

  const listed = await resend("/domains");
  if (!listed.ok) {
    console.error("list domains failed", listed.status, listed.json);
    process.exit(1);
  }
  const domains = listed.json?.data || listed.json || [];
  let domain = (Array.isArray(domains) ? domains : []).find((d) => d.name === DOMAIN);

  if (!domain) {
    console.log("creating domain", DOMAIN, REGION);
    const created = await resend("/domains", {
      method: "POST",
      body: { name: DOMAIN, region: REGION },
    });
    if (!created.ok) {
      // retry without region / with us-east-1
      const created2 = await resend("/domains", { method: "POST", body: { name: DOMAIN } });
      if (!created2.ok) {
        console.error("create failed", created.status, created.json, created2.status, created2.json);
        process.exit(1);
      }
      domain = created2.json;
    } else {
      domain = created.json;
    }
  }

  const detail = await resend(`/domains/${domain.id}`);
  const full = detail.json || domain;
  console.log(
    JSON.stringify(
      {
        id: full.id,
        name: full.name,
        status: full.status,
        region: full.region,
        records: (full.records || []).length,
      },
      null,
      2
    )
  );
  printRecords(full.records || []);

  // Suggest DMARC (not returned by Resend)
  console.log(
    JSON.stringify({
      purpose: "DMARC",
      type: "TXT",
      name: "_dmarc",
      value: "v=DMARC1; p=none; rua=mailto:dmarc@" + DOMAIN,
    })
  );

  // Trigger verify (will stay pending until DNS propagates under Vercel NS)
  const verify = await resend(`/domains/${full.id}/verify`, { method: "POST" });
  console.log("verify_trigger", verify.status, verify.json);

  // Write machine-readable plan for vercel dns add
  const plan = {
    domain: DOMAIN,
    resendDomainId: full.id,
    status: full.status,
    records: [
      ...(full.records || []).map((r) => ({
        type: r.type,
        name: r.name === DOMAIN || r.name === "@" ? "" : String(r.name || "").replace(new RegExp(`\\.?${DOMAIN}$`), ""),
        value: String(r.value || "").replace(/^"|"$/g, ""),
        priority: r.priority,
        purpose: r.record || r.type,
      })),
      {
        type: "TXT",
        name: "_dmarc",
        value: `v=DMARC1; p=none; rua=mailto:dmarc@${DOMAIN}`,
        purpose: "DMARC",
      },
    ],
  };
  const fs = await import("node:fs");
  fs.writeFileSync("/tmp/resend-dns-plan.json", JSON.stringify(plan, null, 2));
  console.log("wrote /tmp/resend-dns-plan.json");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
