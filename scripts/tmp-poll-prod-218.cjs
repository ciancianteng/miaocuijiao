const https = require("https");
const MERGE = "a9df24442dd026a10ea0c0598a882a5e61233211";
const SHORT = MERGE.slice(0, 7);
const HEAD = "a975e85953cc78c41f192cf3f2faf6fa0a4d49ec";

function get(url) {
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        {
          headers: {
            "User-Agent": "mcj-prod-poll",
            "Cache-Control": "no-cache",
            Pragma: "no-cache",
          },
          timeout: 20000,
        },
        (res) => {
          let d = "";
          res.on("data", (c) => (d += c));
          res.on("end", () =>
            resolve({ status: res.statusCode, body: d, headers: res.headers })
          );
        }
      )
      .on("error", reject);
  });
}

function markers(html) {
  const bust = (html.match(/[?&]v=([a-f0-9]{7,40})/gi) || []).slice(0, 10);
  const assetHits = [];
  for (const s of [SHORT, MERGE.slice(0, 8), HEAD.slice(0, 7), "banner-hall", "compact"]) {
    if (html.includes(s)) assetHits.push(s);
  }
  return {
    bust,
    assetHits,
    hasMergeShort: html.includes(SHORT),
    hasHeadShort: html.includes(HEAD.slice(0, 7)),
    len: html.length,
  };
}

(async () => {
  for (let i = 1; i <= 30; i++) {
    try {
      const home = await get("https://www.meowcuijiao.com/?_=" + Date.now());
      const m = markers(home.body);
      console.log(
        JSON.stringify(
          {
            i,
            page: "home",
            status: home.status,
            xvc: home.headers["x-vercel-cache"] || null,
            ...m,
          },
          null,
          2
        )
      );
      const hall = await get(
        "https://www.meowcuijiao.com/companion-center.html?_=" + Date.now()
      );
      const hm = markers(hall.body);
      console.log(
        JSON.stringify(
          {
            i,
            page: "hall",
            status: hall.status,
            xvc: hall.headers["x-vercel-cache"] || null,
            ...hm,
          },
          null,
          2
        )
      );
      if (
        m.hasMergeShort ||
        hm.hasMergeShort ||
        m.hasHeadShort ||
        hm.hasHeadShort
      ) {
        console.log("DEPLOY_MATCH");
        process.exit(0);
      }
    } catch (e) {
      console.log("poll_err", String(e.message || e));
    }
    await new Promise((r) => setTimeout(r, 15000));
  }
  console.log("TIMEOUT_NO_SHA");
  process.exit(2);
})();
