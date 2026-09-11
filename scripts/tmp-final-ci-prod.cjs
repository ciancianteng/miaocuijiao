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

function request(method, apiPath, token) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.github.com",
        path: apiPath,
        method,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "User-Agent": "mcj-ci-final",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data || "{}"));
          } catch {
            resolve({ raw: data });
          }
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

(async () => {
  const token = getToken();
  const sha = "592a3858b1b3ae08ea247db74dc61c88c0217d8b";
  const checks = await request(
    "GET",
    `/repos/ciancianteng/miaocuijiao/commits/${sha}/check-runs?per_page=50`,
    token
  );
  const status = await request(
    "GET",
    `/repos/ciancianteng/miaocuijiao/commits/${sha}/status`,
    token
  );
  const js = await (await fetch("https://www.meowcuijiao.com/src/companion-hall.js?v=20260911hallCompact4")).text();
  console.log(
    JSON.stringify(
      {
        mergeSha: sha,
        combinedState: status.state,
        checks: (checks.check_runs || []).map((r) => ({
          name: r.name,
          status: r.status,
          conclusion: r.conclusion,
        })),
        prodJs: {
          badgeEmpty: /function verifiedBadgeHtml\(\)\s*\{\s*return ""/.test(js),
          hasYiRenZhengLiteralInReturn: /mcj-verified-badge">已认证</.test(js),
        },
      },
      null,
      2
    )
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
