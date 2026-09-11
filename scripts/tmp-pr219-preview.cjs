const { execFileSync } = require("child_process");
const https = require("https");

function getToken() {
  const out = execFileSync("git", ["credential", "fill"], {
    input: "protocol=https\nhost=github.com\n\n",
    encoding: "utf8",
  });
  return /password=(.+)/.exec(out)[1].trim();
}

function request(apiPath, token) {
  return new Promise((resolve, reject) => {
    https
      .get(
        {
          hostname: "api.github.com",
          path: apiPath,
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${token}`,
            "User-Agent": "mcj-pwa",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        },
        (res) => {
          let d = "";
          res.on("data", (c) => (d += c));
          res.on("end", () => resolve(JSON.parse(d || "{}")));
        }
      )
      .on("error", reject);
  });
}

(async () => {
  const token = getToken();
  const comments = await request("/repos/ciancianteng/miaocuijiao/issues/219/comments", token);
  const reviews = await request("/repos/ciancianteng/miaocuijiao/pulls/219/comments", token);
  const statuses = await request(
    "/repos/ciancianteng/miaocuijiao/commits/ae7e4a3978883509feb598fa63b3af29e2022e7e/statuses",
    token
  );
  const urls = [];
  for (const c of comments || []) {
    const m = String(c.body || "").match(/https?:\/\/[^\s)]+vercel\.app[^\s)]*/g);
    if (m) urls.push(...m);
  }
  console.log(
    JSON.stringify(
      {
        commentCount: (comments || []).length,
        previewUrls: [...new Set(urls)],
        statuses: (statuses || []).map((s) => ({
          context: s.context,
          state: s.state,
          target_url: s.target_url,
        })),
      },
      null,
      2
    )
  );
})();
