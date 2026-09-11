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
          "User-Agent": "mcj-pr221-preview",
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
  const comments = await request("GET", "/repos/ciancianteng/miaocuijiao/issues/221/comments?per_page=50", token);
  const reviewComments = await request("GET", "/repos/ciancianteng/miaocuijiao/pulls/221/comments?per_page=20", token);
  const statuses = await request("GET", "/repos/ciancianteng/miaocuijiao/commits/6c9f583c0829322d735d8c71eb1ac82f763e139a/status", token);
  const all = []
    .concat(comments.json || [])
    .concat(Array.isArray(reviewComments.json) ? reviewComments.json : []);
  const urls = [];
  for (const c of all) {
    const body = c.body || "";
    const m = body.match(/https:\/\/[a-z0-9.-]+\.vercel\.app[^\s)\]\"']*/gi) || [];
    m.forEach((u) => urls.push({ from: c.user && c.user.login, u, created: c.created_at }));
  }
  const statusUrls = (statuses.json.statuses || [])
    .filter((s) => /vercel/i.test(s.context || "") || /vercel/i.test(s.target_url || ""))
    .map((s) => ({ context: s.context, state: s.state, target: s.target_url }));
  console.log(JSON.stringify({ previewUrls: urls.slice(-10), statusUrls }, null, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
