const { execFileSync } = require("child_process");
const https = require("https");

function getToken() {
  const out = execFileSync("git", ["credential", "fill"], {
    input: "protocol=https\nhost=github.com\n\n",
    encoding: "utf8",
  });
  const m = /password=(.+)/.exec(out);
  if (!m) throw new Error("no token");
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
          "User-Agent": "mcj-pwa-status",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, json: JSON.parse(data || "{}") });
          } catch (e) {
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
  const pr = await request("GET", "/repos/ciancianteng/miaocuijiao/pulls/219", token);
  const checks = await request(
    "GET",
    "/repos/ciancianteng/miaocuijiao/commits/" + encodeURIComponent(pr.json.head.sha) + "/status",
    token
  );
  const checkRuns = await request(
    "GET",
    "/repos/ciancianteng/miaocuijiao/commits/" + encodeURIComponent(pr.json.head.sha) + "/check-runs",
    token
  );
  const deployments = await request(
    "GET",
    "/repos/ciancianteng/miaocuijiao/deployments?ref=feat/pwa-install-prompt&per_page=5",
    token
  );
  console.log(
    JSON.stringify(
      {
        pr: { number: pr.json.number, url: pr.json.html_url, state: pr.json.state, sha: pr.json.head.sha },
        combinedStatus: checks.json.state,
        checkRuns: (checkRuns.json.check_runs || []).map((c) => ({
          name: c.name,
          status: c.status,
          conclusion: c.conclusion,
        })),
        deployments: (deployments.json || []).slice(0, 3).map((d) => ({
          id: d.id,
          environment: d.environment,
          created_at: d.created_at,
        })),
      },
      null,
      2
    )
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
