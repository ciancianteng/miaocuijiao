import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

const BASE = "https://meow-cuijiao-homepage-staging.vercel.app";
const PASS = "OrganicGoLive!Mcj2026";
const exe = existsSync("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe")
  ? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
  : "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const sess = await (
  await fetch(`${BASE}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "login",
      email: "organic.companion@mcj-staging-organic.invalid",
      password: PASS,
      role: "companion",
    }),
  })
).json();

const browser = await chromium.launch({ headless: true, executablePath: exe });
const page = await browser.newPage();
page.on("console", (m) => console.log("CONSOLE", m.type(), m.text()));
let inviteHits = 0;
page.on("response", (r) => {
  if (r.url().includes("invite-links")) {
    inviteHits += 1;
    console.log("INVITE_RESP", inviteHits, r.status(), Date.now());
  }
});

await page.addInitScript(
  ({ token, user }) => {
    const blob = {
      token,
      accessToken: token,
      refreshToken: "",
      user: { ...user, role: "companion" },
      remember: true,
      portal: "companion",
    };
    localStorage.setItem("mcjCompanionSession", JSON.stringify(blob));
    sessionStorage.setItem("mcjCompanionSession", JSON.stringify(blob));
  },
  { token: sess.session.accessToken, user: sess.session.user }
);

await page.goto(`${BASE}/companion/account`, { waitUntil: "domcontentloaded", timeout: 60000 });

for (let i = 0; i < 20; i++) {
  await page.waitForTimeout(500);
  const snap = await page.evaluate(() => {
    const el = document.getElementById("pwInviteCard");
    return {
      text: (el && el.innerText || "").slice(0, 120),
      htmlLen: el ? el.innerHTML.length : 0,
    };
  });
  console.log("T", i, JSON.stringify(snap));
  if (snap.text && !/加载中/.test(snap.text) && /邀请码|专属|开通/.test(snap.text)) break;
}

await browser.close();
