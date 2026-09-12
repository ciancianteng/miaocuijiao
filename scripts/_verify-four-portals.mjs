const base = "https://meow-cuijiao-homepage-staging.vercel.app";
const checks = [
  ["首页", "/"],
  ["客服登录", "/customer-service/login/"],
  ["陪玩登录", "/companion/login/"],
  ["后台登录", "/admin/login/"],
];

for (const [name, path] of checks) {
  const r = await fetch(base + path, { cache: "no-store" });
  const t = await r.text();
  const title = (t.match(/<title[^>]*>([^<]*)/i) || [])[1] || "";
  const hasLoginUi = /password|登录|login/i.test(t);
  console.log(
    JSON.stringify({
      name,
      status: r.status,
      title,
      bytes: t.length,
      hasLoginUi: name === "首页" ? true : hasLoginUi,
      white: t.trim().length < 80,
    })
  );
}
