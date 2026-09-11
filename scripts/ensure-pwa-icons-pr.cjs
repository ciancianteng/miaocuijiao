/**
 * Ensure PR exists for feat/pwa-install-prompt; update title/body for cat icons.
 * Does NOT merge.
 */
"use strict";

const { execFileSync } = require("child_process");
const https = require("https");

function getToken() {
  const out = execFileSync("git", ["credential", "fill"], {
    input: "protocol=https\nhost=github.com\n\n",
    encoding: "utf8",
  });
  const m = /password=(.+)/.exec(out);
  if (!m) throw new Error("no github token from git credential");
  return m[1].trim();
}

function request(method, apiPath, token, body) {
  const payload = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.github.com",
        path: apiPath,
        method,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "User-Agent": "mcj-pwa-icons-pr",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(payload
            ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
            : {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          let json = null;
          try {
            json = JSON.parse(data || "{}");
          } catch (_) {
            json = { raw: data };
          }
          resolve({ status: res.statusCode, json });
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const TITLE =
  "feat(pwa): Add to Home Screen install prompt + official cat app icons";

const BODY = `## Summary
- Site-wide PWA “Add to Home Screen” glass sheet (iOS Safari teach / Android install)
- **Official cat app icons** (not letter M): any + maskable + apple-touch + favicon from \`public/og/meowcuijiao-logo-transparent.png\`
- Separate maskable assets with ~20% safe zone; brand purple-black gradient (\`#120818\` → \`#1a0a18\`)
- Manifest, minimal SW, static + JS meta tags; Mine entry 「添加妙脆角到主屏幕」
- Evidence in \`docs/pwa-install-accept/\` (icon previews, circle-crop overlay, iOS/Android sheets)

## Why Production shows letter M today
\`/icons/*\` + \`/manifest.webmanifest\` **404 on Production** until this merges → browser falls back to a monochrome letter glyph. After merge, users must **delete old home icon and re-add**.

## Test plan
- [ ] Preview: GET icons return 200 \`image/png\` (\`/icons/icon-192.png\`, maskable, \`/apple-touch-icon.png\`, \`/favicon-32.png\`)
- [ ] Preview: \`/manifest.webmanifest\` lists any + maskable separately
- [ ] iOS UA: install sheet shows cat logo; apple-touch meta points to \`/apple-touch-icon.png\`
- [ ] Android: maskable safe zone (see circle overlay evidence); install UI shows cat
- [ ] Mine entry opens force tutorial; dismiss/installed rules still hold
- [ ] **Do not merge until Preview icon checklist PASS**

## Reproduce icons
\`\`\`bash
node scripts/build-pwa-icons.cjs
\`\`\`
`;

(async () => {
  const token = getToken();
  const list = await request(
    "GET",
    "/repos/ciancianteng/miaocuijiao/pulls?head=ciancianteng:feat/pwa-install-prompt&state=open",
    token
  );
  let pr = (list.json || [])[0];
  if (!pr) {
    const created = await request("POST", "/repos/ciancianteng/miaocuijiao/pulls", token, {
      title: TITLE,
      head: "feat/pwa-install-prompt",
      base: "main",
      body: BODY,
    });
    if (created.status >= 300) {
      console.log(JSON.stringify(created, null, 2));
      process.exit(1);
    }
    pr = created.json;
    console.log(JSON.stringify({ action: "created", number: pr.number, url: pr.html_url }, null, 2));
  } else {
    const patched = await request(
      "PATCH",
      "/repos/ciancianteng/miaocuijiao/pulls/" + pr.number,
      token,
      { title: TITLE, body: BODY }
    );
    console.log(
      JSON.stringify(
        {
          action: "updated",
          status: patched.status,
          number: pr.number,
          url: pr.html_url,
          title: patched.json.title,
        },
        null,
        2
      )
    );
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
