const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
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
          "User-Agent": "mcj-pwa-install-pr",
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
  const body = fs.readFileSync(path.join(__dirname, "..", "tmp-pr-body-pwa.md"), "utf8");
  const res = await request("POST", "/repos/ciancianteng/miaocuijiao/pulls", token, {
    title: "feat(pwa): Add to Home Screen guide (site-wide)",
    head: "feat/pwa-install-prompt",
    base: "main",
    body,
    draft: false,
  });
  console.log(
    JSON.stringify(
      { status: res.status, number: res.json.number, url: res.json.html_url, message: res.json.message },
      null,
      2
    )
  );
  if (res.status >= 300) process.exit(1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
