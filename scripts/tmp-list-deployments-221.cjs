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
          "User-Agent": "mcj-deployments",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, json: JSON.parse(data || "null") });
          } catch {
            resolve({ status: res.statusCode, json: data });
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
  const deps = await request(
    "GET",
    "/repos/ciancianteng/miaocuijiao/deployments?ref=fix/hall-compact-prod-v2&per_page=10",
    token
  );
  const list = Array.isArray(deps.json) ? deps.json : [];
  const out = [];
  for (const d of list.slice(0, 6)) {
    const st = await request(
      "GET",
      `/repos/ciancianteng/miaocuijiao/deployments/${d.id}/statuses`,
      token
    );
    const statuses = Array.isArray(st.json) ? st.json : [];
    out.push({
      id: d.id,
      sha: d.sha,
      created: d.created_at,
      environment: d.environment,
      description: d.description,
      statuses: statuses.slice(0, 3).map((s) => ({
        state: s.state,
        env: s.environment,
        url: s.environment_url || s.target_url,
        desc: s.description,
      })),
    });
  }
  console.log(JSON.stringify(out, null, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
