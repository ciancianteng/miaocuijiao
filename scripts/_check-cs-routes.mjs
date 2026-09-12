const STAGING = "https://meow-cuijiao-homepage-staging.vercel.app";
for (const path of [
  "/customer-service/conversations",
  "/customer-service/conversations/",
  "/customer-service/chats/",
  "/customer-service/dashboard/",
]) {
  const r = await fetch(STAGING + path, { redirect: "follow" });
  const t = await r.text();
  console.log(
    JSON.stringify({
      path,
      status: r.status,
      final: r.url,
      hasApp: t.includes("serviceApp"),
      hasV2: t.includes("customer-service-v2.js"),
      title: (t.match(/<title>[^<]+/) || [])[0] || "",
    })
  );
}
