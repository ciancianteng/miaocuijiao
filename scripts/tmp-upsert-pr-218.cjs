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
          "User-Agent": "mcj-hall-compact-v3",
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
  const list = await request(
    "GET",
    "/repos/ciancianteng/miaocuijiao/pulls?state=open&head=ciancianteng:fix/hall-compact-prod-v2",
    token
  );
  const existing = (list.json || [])[0];

  const body = `## Summary
- **Root cause:** Production still tall because \`ui-linglu-polish.css\` forced \`aspect-ratio:16/9\` + \`max-height:none\` and loaded **after** hall CSS (Vite keeps that order / separate chunk on Prod). Compact v1 also self-cancelled clamp with a later \`max-height:none\` in the same rule.
- Hall media forced to \`2/1\` + \`max-height:min(42vw,168px)\` in both \`companion-hall.css\` and \`ui-linglu-polish.css\`.
- Load \`companion-hall.css\` **after** polish in \`companion-center.html\`.
- Remove redundant **已认证** from hall cards (JS empty + CSS \`display:none\`).

## Test plan
- [ ] Preview/Prod \`/companion-center.html\` @ 375/390/393/430: media \`2/1\` or clamped ≤168px
- [ ] No \`已认证\` text on hall cards
- [ ] Dual CTAs + \`+N\` tags intact
- [ ] Real Production https://meowcuijiao.com/companion-center.html after merge — not CI-only

Does not touch #219 / Push / Pricing / Order / Auth / DB.
`;

  if (existing && existing.number) {
    const upd = await request(
      "PATCH",
      `/repos/ciancianteng/miaocuijiao/pulls/${existing.number}`,
      token,
      {
        title: "fix(ui): hall compact v3 — beat polish 16/9 + remove 已认证 (#218)",
        body,
      }
    );
    console.log(JSON.stringify({ action: "updated", status: upd.status, number: existing.number, url: existing.html_url }, null, 2));
    return;
  }

  const res = await request("POST", "/repos/ciancianteng/miaocuijiao/pulls", token, {
    title: "fix(ui): hall compact v3 — beat polish 16/9 + remove 已认证 (#218)",
    head: "fix/hall-compact-prod-v2",
    base: "main",
    body,
  });
  console.log(
    JSON.stringify(
      {
        action: "created",
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
