const { execFileSync } = require("child_process");
const https = require("https");

function getToken() {
  const out = execFileSync("git", ["credential", "fill"], {
    input: "protocol=https\nhost=github.com\n\n",
    encoding: "utf8",
  });
  const m = /password=(.+)/.exec(out);
  if (!m) throw new Error("no github password/token from git credential");
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
          "User-Agent": "mcj-hall-compact-v2-pr",
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

(async () => {
  const token = getToken();
  const body = `## Summary
- Force companion hall media to \`aspect-ratio: 2/1\` with \`max-height: min(42vw, 168px)\` (compact v2) so Production cards are shorter than #218's 16/9.
- Fix double ✓ on 已认证 badge (\`::before\` + text).
- Bump \`companion-center.html\` CSS/JS cache query to \`20260911hallCompact3\`.

## Root cause (Prod)
#218 **did** land on Production (\`a9df244\`). Measured Prod card height was **394px / 16/9** — same as local accept. Accept screenshots were against **local static** (\`127.0.0.1:4177\`), not meowcuijiao.com; with page chrome only ~1 card fits above the fold, so cards still feel huge. Legacy 4/5 + 16/10 remain in the CSS file (cascade loses to later rules). SW is network-only (not the cache culprit).

## Test plan
- [ ] Preview \`/companion-center.html\` @ 390: media \`2/1\` or clamped ≤168px; card clearly shorter than 394px
- [ ] Verified badge shows single ✓ + 已认证
- [ ] \`+N\` tag still present when overflow tags exist
- [ ] Bottom tabbar padding intact
- [ ] After merge: Production matches Preview
`;
  const res = await request("POST", "/repos/ciancianteng/miaocuijiao/pulls", token, {
    title: "fix(ui): hall compact v2 shorter media for Production",
    head: "fix/hall-compact-prod-v2",
    base: "main",
    body,
    draft: false,
  });
  console.log(
    JSON.stringify(
      {
        status: res.status,
        number: res.json.number,
        url: res.json.html_url,
        message: res.json.message,
        errors: res.json.errors,
      },
      null,
      2
    )
  );
  if (res.status >= 300) process.exit(1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
