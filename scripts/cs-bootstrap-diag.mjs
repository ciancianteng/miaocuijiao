import { chromium } from "playwright";

const BASE = "https://meow-cuijiao-homepage-hmhx3tr2j-ciancianteng-4581s-projects.vercel.app";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on("response", async (r) => {
    if (/\/api\/customer-service/.test(r.url())) {
      let t = "";
      try { t = (await r.text()).slice(0, 180); } catch (_) {}
      console.log("CS API", r.status(), r.url().replace(BASE, ""), t);
    }
  });
  await page.goto(`${BASE}/customer-service/login/`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="account"]', "service@meow.test");
  await page.fill('input[name="password"]', "McjTest@12345678");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(5000);
  console.log("url", page.url());
  const diag = await page.evaluate(async () => {
    const sess = JSON.parse(localStorage.getItem("mcjServiceSession") || sessionStorage.getItem("mcjServiceSession") || "null");
    const token = sess && sess.token;
    const headers = { Accept: "application/json" };
    if (token) headers["x-mcj-service-token"] = token;
    const r = await fetch("/api/customer-service?action=bootstrap", { headers });
    const body = await r.json().catch(() => ({}));
    return {
      status: r.status,
      ok: body.ok,
      message: body.message,
      conv: (body.data && body.data.conversations && body.data.conversations.length) || 0,
      waiting: body.data && body.data.summary && body.data.summary.waitingConversations,
      sample: (body.data && body.data.conversations || []).slice(0, 3).map((c) => ({
        id: c.id,
        status: c.status,
        unread: c.unread,
        last: String(c.lastMessage || "").slice(0, 40),
        svc: c.currentServiceId ? "yes" : "no",
      })),
      loadingText: document.body.innerText.includes("正在读取真实数据"),
      error: body.error || null,
    };
  });
  console.log(JSON.stringify(diag, null, 2));
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
