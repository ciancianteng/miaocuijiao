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
          "User-Agent": "mcj-pr221-status",
          "X-GitHub-Api-Version": "2022-11-28",
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
    req.end();
  });
}

(async () => {
  const token = getToken();
  const pr = await request("GET", "/repos/ciancianteng/miaocuijiao/pulls/221", token);
  const checks = await request(
    "GET",
    `/repos/ciancianteng/miaocuijiao/commits/${pr.json.head.sha}/check-runs?per_page=50`,
    token
  );
  const statuses = await request(
    "GET",
    `/repos/ciancianteng/miaocuijiao/commits/${pr.json.head.sha}/status`,
    token
  );
  const runs = (checks.json.check_runs || []).map((r) => ({
    name: r.name,
    status: r.status,
    conclusion: r.conclusion,
  }));
  console.log(
    JSON.stringify(
      {
        number: pr.json.number,
        mergeable: pr.json.mergeable,
        mergeable_state: pr.json.mergeable_state,
        sha: pr.json.head.sha,
        html_url: pr.json.html_url,
        combinedState: statuses.json.state,
        checks: runs,
      },
      null,
      2
    )
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
