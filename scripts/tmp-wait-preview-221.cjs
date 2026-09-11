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
          "User-Agent": "mcj-hall-compact-v2-pr",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          let json = null;
          try {
            json = JSON.parse(data || "[]");
          } catch (_) {
            json = { raw: data };
          }
          resolve({ status: res.statusCode, json });
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

(async () => {
  const token = getToken();
  const pr = Number(process.argv[2] || 221);
  for (let i = 0; i < 40; i++) {
    const res = await request("GET", `/repos/ciancianteng/miaocuijiao/commits/fix/hall-compact-prod-v2/status`, token);
    const statuses = await request(
      "GET",
      `/repos/ciancianteng/miaocuijiao/commits/fix/hall-compact-prod-v2/statuses`,
      token
    );
    const checks = await request(
      "GET",
      `/repos/ciancianteng/miaocuijiao/commits/fix/hall-compact-prod-v2/check-runs?per_page=50`,
      token
    );
    const vercel = (statuses.json || []).filter((s) => /vercel/i.test(s.context || ""));
    const deploy = (checks.json.check_runs || []).filter((c) => /vercel|deploy/i.test(c.name || ""));
    const preview =
      vercel.find((s) => s.state === "success" && s.target_url)?.target_url ||
      deploy.find((c) => c.conclusion === "success" && c.details_url)?.details_url ||
      null;
    const pending = vercel.some((s) => s.state === "pending") || deploy.some((c) => c.status !== "completed");
    console.log(
      JSON.stringify({
        i,
        combined: res.json.state,
        vercel: vercel.map((s) => ({ context: s.context, state: s.state, url: s.target_url })),
        deploy: deploy.map((c) => ({ name: c.name, status: c.status, conclusion: c.conclusion, url: c.details_url })),
        preview,
      })
    );
    if (preview && !pending) {
      console.log("PREVIEW_URL=" + preview);
      return;
    }
    await new Promise((r) => setTimeout(r, 15000));
  }
  process.exit(2);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
