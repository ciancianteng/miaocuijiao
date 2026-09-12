const fs = require("fs");
const files = [
  "admin.html",
  "customer-service/login/index.html",
  "customer-service/dashboard/index.html",
  "customer-service/index.html",
  "companion/index.html",
  "companion/dashboard/index.html",
  "companion/verification/index.html",
];
for (const f of files) {
  const b = fs.readFileSync(f);
  const t = new TextDecoder("utf-8", { fatal: true }).decode(b);
  const title = (t.match(/<title>[^<]+<\/title>/) || [])[0];
  const brokenClose = /[\u4e00-\u9fffA-Za-z0-9]\/(button|h1|h2|h3|div|p)>/.test(t);
  const badAria = /aria-label="[^"]+>/.test(t) && !/aria-label="[^"]+">/.test(t.match(/aria-label="[^>]+>/)?.[0] || "");
  console.log(
    JSON.stringify({
      f,
      title,
      fffd: t.includes("\uFFFD"),
      brokenClose,
      sampleDash: f.includes("dashboard") ? t.slice(0, 400) : undefined,
    })
  );
}
