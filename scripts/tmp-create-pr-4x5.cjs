const { execFileSync } = require("child_process");
const https = require("https");

function getToken() {
  const out = execFileSync("git", ["credential", "fill"], {
    input: "protocol=https\nhost=github.com\n\n",
    encoding: "utf8",
  });
  const m = /password=(.+)/.exec(out);
  if (!m) throw new Error("no github token");
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
          "User-Agent": "mcj-hall-4x5-pr",
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
          try {
            resolve({ status: res.statusCode, json: JSON.parse(data || "{}") });
          } catch {
            resolve({ status: res.statusCode, json: { raw: data } });
          }
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
- **Hotfix for #221 mistake:** companion hall media was wrongly forced to \`2/1\` + \`max-height:min(42vw,168px)\`, cropping portraits into banners.
- **Locked rule:** photo container \`aspect-ratio: 4 / 5\`; img \`width/height 100%\` + \`object-fit: cover\`; **no** 2/1, 16/9, or clamp max-height on media.
- Compact comes from **info area only**: smaller tags/status, tighter padding/gap, 36px dual CTAs.
- Keep **已认证** fully hidden on hall cards.
- Accept shots: \`docs/hall-photo-4x5-accept/\` (375/390/393/430).

## Do not merge yet
Waiting for mobile screenshot confirmation from owner.

## Test plan
- [ ] Preview \`/companion-center.html\` @ 375/390/393/430
- [ ] Computed media \`aspect-ratio\` = \`4 / 5\`
- [ ] Face/portrait not banner-cropped
- [ ] No \`已认证\` on cards
- [ ] Dual buttons OK; next card continues below
`;

  const res = await request("POST", "/repos/ciancianteng/miaocuijiao/pulls", token, {
    title: "fix(ui): hall photo 4:5 + info-only compact (hotfix)",
    head: "fix/hall-photo-4x5-info-compact",
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
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
