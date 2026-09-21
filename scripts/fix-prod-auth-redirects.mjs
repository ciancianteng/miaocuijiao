/**
 * Fix Production Supabase Auth Site URL / Redirect allow-list.
 *
 * Root cause of Dashboard "Send password recovery" → localhost:
 *   Auth Site URL is currently http://localhost:3000
 *   Non-allowlisted redirectTo values are ignored and fall back to Site URL.
 *
 * Does NOT mutate users or database rows — only Auth service config.
 *
 * Usage:
 *   SUPABASE_ACCESS_TOKEN=sbp_... \
 *   node scripts/fix-prod-auth-redirects.mjs
 *
 * Optional overrides:
 *   PROD_SUPABASE_REF=jqfaknpmcnqwqvatrwgo
 *   PROD_SITE_URL=https://meow-cuijiao-homepage.vercel.app
 *   DRY_RUN=1
 */
const REF =
  process.env.PROD_SUPABASE_REF ||
  (() => {
    const url = process.env.PROD_SUPABASE_URL || process.env.SUPABASE_URL || "";
    try {
      return new URL(url).hostname.split(".")[0] || "";
    } catch {
      return "";
    }
  })() ||
  "jqfaknpmcnqwqvatrwgo";

const TOKEN = String(process.env.SUPABASE_ACCESS_TOKEN || "").trim();
const DRY = String(process.env.DRY_RUN || "") === "1";

const SITE_URL = String(
  process.env.PROD_SITE_URL || "https://meow-cuijiao-homepage.vercel.app"
).replace(/\/$/, "");

const ALLOW_LIST = [
  `${SITE_URL}`,
  `${SITE_URL}/**`,
  `${SITE_URL}/admin/login`,
  `${SITE_URL}/admin/login/`,
  "https://www.meowcuijiao.com",
  "https://www.meowcuijiao.com/**",
  "https://www.meowcuijiao.com/admin/login",
  "https://www.meowcuijiao.com/admin/login/",
  "https://meowcuijiao.com",
  "https://meowcuijiao.com/**",
  "https://meowcuijiao.com/admin/login",
  "https://meowcuijiao.com/admin/login/",
  // local preview only (optional; keep if you still develop against this project)
  "http://127.0.0.1:5190/**",
  "http://localhost:5190/**",
].join(",");

if (!TOKEN) {
  console.error(
    "Missing SUPABASE_ACCESS_TOKEN.\n" +
      "Create one at https://supabase.com/dashboard/account/tokens\n" +
      "Then re-run: SUPABASE_ACCESS_TOKEN=sbp_... node scripts/fix-prod-auth-redirects.mjs"
  );
  process.exit(1);
}

async function getAuthConfig() {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/config/auth`, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/json" },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`GET auth config ${res.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function patchAuthConfig(payload) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/config/auth`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`PATCH auth config ${res.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

const before = await getAuthConfig();
const beforeSite = before.site_url || before.SITE_URL || "";
const beforeAllow = before.uri_allow_list || before.URI_ALLOW_LIST || "";

console.log(
  JSON.stringify(
    {
      ref: REF,
      dryRun: DRY,
      before: { site_url: beforeSite, uri_allow_list: beforeAllow },
      desired: { site_url: SITE_URL, uri_allow_list: ALLOW_LIST },
    },
    null,
    2
  )
);

if (DRY) {
  console.log("DRY_RUN=1 — no changes applied.");
  process.exit(0);
}

if (beforeSite === SITE_URL && String(beforeAllow).includes(SITE_URL)) {
  console.log("Auth redirects already look correct; no PATCH needed.");
  process.exit(0);
}

const after = await patchAuthConfig({
  site_url: SITE_URL,
  uri_allow_list: ALLOW_LIST,
});

console.log(
  JSON.stringify(
    {
      ok: true,
      after: {
        site_url: after.site_url || after.SITE_URL || SITE_URL,
        uri_allow_list: after.uri_allow_list || after.URI_ALLOW_LIST || ALLOW_LIST,
      },
      next: [
        "In Supabase Dashboard → Authentication → Users → meowcuijiao@gmail.com → Send password recovery",
        `Confirm the email link redirect_to host is ${new URL(SITE_URL).hostname} (not localhost)`,
        "Or use Production admin login → 忘记密码 (app OTP flow; no Site URL dependency)",
      ],
    },
    null,
    2
  )
);
