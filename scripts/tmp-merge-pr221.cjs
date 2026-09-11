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
          "User-Agent": "mcj-merge-221",
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
  const pr = await request("GET", "/repos/ciancianteng/miaocuijiao/pulls/221", token);
  console.log(
    JSON.stringify(
      {
        mergeable: pr.json.mergeable,
        mergeable_state: pr.json.mergeable_state,
        sha: pr.json.head.sha,
      },
      null,
      2
    )
  );
  const merged = await request("PUT", "/repos/ciancianteng/miaocuijiao/pulls/221/merge", token, {
    merge_method: "squash",
    commit_title: "fix(ui): hall compact v3 beat polish 16/9 + remove 已认证 (#221)",
    commit_message:
      "Force 2/1 media clamp, load hall CSS after polish, hide hall verified badge. Fixes Production #218 tall cards.",
  });
  console.log(JSON.stringify({ mergeStatus: merged.status, merge: merged.json }, null, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
