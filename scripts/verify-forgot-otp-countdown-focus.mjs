/**
 * Mobile/iOS-UA check: countdown must not remount OTP input.
 * node scripts/verify-forgot-otp-countdown-focus.mjs
 */
import { chromium } from "playwright-core";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import http from "node:http";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function contentType(p) {
  if (p.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (p.endsWith(".html")) return "text/html; charset=utf-8";
  return "application/octet-stream";
}

const FIXTURE = `<!doctype html><html><body>
<button type="button" data-forgot-password data-forgot-role="boss">forgot</button>
<script src="/src/forgot-password.js?v=20260907otpFocus1"></script>
</body></html>`;

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  if (urlPath === "/fixture-forgot.html") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(FIXTURE);
    return;
  }
  const filePath = path.join(ROOT, urlPath.replace(/^\//, ""));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      res.writeHead(404);
      res.end("missing " + urlPath);
      return;
    }
    res.writeHead(200, { "Content-Type": contentType(filePath) });
    res.end(buf);
  });
});

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const PORT = server.address().port;

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM || "/usr/bin/google-chrome-stable",
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
});
const page = await context.newPage();
page.on("pageerror", (err) => console.error("pageerror", err.message));
page.on("console", (msg) => {
  if (msg.type() === "error") console.error("console", msg.text());
});
await page.goto(`http://127.0.0.1:${PORT}/fixture-forgot.html`, {
  waitUntil: "domcontentloaded",
});
await page.waitForFunction(() => !!window.MCJForgotPassword, null, {
  timeout: 10000,
});

await page.evaluate(() => {
  window.fetch = function (_url, opts) {
    var body = {};
    try {
      body = JSON.parse((opts && opts.body) || "{}");
    } catch (e) {}
    if (body.action === "forgot_send_otp") {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            ok: true,
            message: "验证码已发送",
            emailMasked: "t***@example.com",
            debugCode: "123456",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );
    }
    if (body.action === "forgot_verify_otp") {
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true, resetToken: "tok-test", message: "ok" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
    }
    if (body.action === "forgot_reset_password") {
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true, message: "密码修改成功，请重新登录。" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
    }
    return Promise.reject(new Error("unexpected fetch " + (body.action || "")));
  };
});

await page.click("[data-forgot-password]");
await page.waitForSelector('input[name="email"]');
await page.fill('input[name="email"]', "test@example.com");
await page.click("[data-forgot-submit]");
await page.waitForSelector('input[name="code"]');

const identity = await page.evaluate(async () => {
  var n1 = document.querySelector('input[name="code"]');
  n1.focus();
  n1.value = "345";
  await new Promise(function (r) {
    setTimeout(r, 2200);
  });
  var n2 = document.querySelector('input[name="code"]');
  return {
    same: n1 === n2,
    value: n2 && n2.value,
    focused: document.activeElement === n2,
    resend: (document.querySelector("[data-forgot-resend]") || {}).textContent || "",
  };
});

console.log("identity", identity);
if (!(identity.same && identity.value === "345" && /重新发送（\d+s）/.test(identity.resend))) {
  console.error("FAIL countdown remounted OTP or wiped value");
  process.exitCode = 1;
} else {
  console.log("PASS OTP input survives countdown; value+focus preserved; resend label updates");
}

await page.fill('input[name="code"]', "123456");
await page.click("[data-forgot-submit]");
await page.waitForSelector('input[name="new_password"]', { timeout: 5000 });
await page.fill('input[name="new_password"]', "NewPass123!");
await page.fill('input[name="confirm_password"]', "NewPass123!");
await page.click("[data-forgot-submit]");
await page.waitForFunction(() => {
  var host = document.querySelector("[data-mcj-forgot-host]");
  return host && (host.hidden || host.getAttribute("hidden") != null);
}, null, { timeout: 5000 });
console.log("PASS full reset flow closes overlay");

await browser.close();
server.close();
process.exit(process.exitCode || 0);
