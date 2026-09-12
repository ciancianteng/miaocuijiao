import { chromium } from "playwright-core";
const base = "http://localhost:5190";
async function launch() {
  try { return await chromium.launch({ channel: "chrome", headless: true }); }
  catch { return await chromium.launch({ channel: "msedge", headless: true }); }
}
async function main() {
  const browser = await launch();
  const page = await browser.newPage();
  const fails = [];
  page.on("response", async (r) => {
    const u = r.url();
    if (!u.includes("/api/")) return;
    if (r.status() >= 400 || u.includes("customer-service") || u.includes("orders") || u.includes("wallet") || u.includes("platform")) {
      let body = "";
      try { body = (await r.text()).slice(0, 500); } catch {}
      const line = { status: r.status(), url: u.replace(base, ""), method: r.request().method(), body };
      console.log("RESP", JSON.stringify(line));
      if (r.status() >= 400) fails.push(line);
    }
  });
  const login = await page.request.post(base + "/api/customer-service", {
    data: { action: "login", account: "service@meow.test", password: "McjTest@12345678", remember: true },
  });
  const body = await login.json();
  await page.addInitScript((s) => localStorage.setItem("mcjServiceSession", JSON.stringify(s)), body.session);
  await page.goto(base + "/customer-service/dashboard/", { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(5000);
  const ui = await page.evaluate(() => ({
    title: document.querySelector(".cs-top h1")?.textContent || "",
    error: document.querySelector(".cs-empty")?.innerText || "",
    hasMetrics: !!document.querySelector(".cs-metric, .cs-grid"),
  }));
  console.log("UI", JSON.stringify(ui));
  console.log("FAILS", JSON.stringify(fails, null, 2));
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
