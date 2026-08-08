/**
 * P0: mobile email keyboard attrs on boss login (OTP / password tabs).
 * Usage:
 *   node scripts/p0-mobile-email-keyboard-accept.mjs
 *   MCJ_STAGING_URL=https://meow-cuijiao-homepage-staging.vercel.app node scripts/p0-mobile-email-keyboard-accept.mjs
 */
import { chromium, devices } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const STAGING = (process.env.MCJ_STAGING_URL || "").replace(/\/$/, "");
const results = [];

function step(name, ok, detail) {
  results.push({ name, ok, detail: String(detail || "") });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
  return ok;
}

function attrsOf(el) {
  if (!el) return null;
  return {
    type: String(el.getAttribute("type") || el.type || "").toLowerCase(),
    inputmode: String(el.getAttribute("inputmode") || "").toLowerCase(),
    autocomplete: String(el.getAttribute("autocomplete") || "").toLowerCase(),
    maxlength: String(el.getAttribute("maxlength") || ""),
    pattern: String(el.getAttribute("pattern") || ""),
  };
}

function emailOk(a) {
  return a && a.type === "email" && a.inputmode === "email" && a.autocomplete === "email" && !/0-9|\\d/.test(a.pattern);
}

function otpOk(a) {
  return a && a.type === "text" && a.inputmode === "numeric" && a.maxlength === "6";
}

async function startLocalStatic() {
  const mime = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
  };
  const server = createServer(async (req, res) => {
    try {
      let urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
      if (urlPath === "/") urlPath = "/index.html";
      const filePath = path.join(ROOT, urlPath.replace(/^\//, ""));
      if (!filePath.startsWith(ROOT)) {
        res.writeHead(403);
        res.end("forbidden");
        return;
      }
      const data = await readFile(filePath);
      res.writeHead(200, { "Content-Type": mime[path.extname(filePath)] || "application/octet-stream" });
      res.end(data);
    } catch (e) {
      res.writeHead(404);
      res.end("not found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { server, base: `http://127.0.0.1:${port}` };
}

async function probeBossLogin(page, label) {
  await page.waitForTimeout(800);
  // Open login modal via hash or login control.
  await page.evaluate(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch (e) {}
  });
  const opened = await page.evaluate(async () => {
    if (window.MCJModal && typeof window.MCJModal.openLogin === "function") {
      window.MCJModal.openLogin("login");
      return "MCJModal.openLogin";
    }
    if (typeof window.bossLoginHtml === "function" && window.MCJModal && window.MCJModal.open) {
      window.MCJModal.open(window.bossLoginHtml("login"), { auth: true });
      return "MCJModal.open+bossLoginHtml";
    }
    location.hash = "#login";
    return "hash";
  });
  await page.waitForTimeout(900);
  const email = page.locator("#loginOtpEmail");
  const code = page.locator("#loginOtpCode");
  const visibleEmail = await email.isVisible().catch(() => false);
  step(`${label} OTP email visible`, visibleEmail, `openVia=${opened}`);
  if (!visibleEmail) return;

  const emailAttrs = await email.evaluate(attrsOf);
  const codeAttrs = await code.evaluate(attrsOf);
  step(`${label} OTP email keyboard attrs`, emailOk(emailAttrs), JSON.stringify(emailAttrs));
  step(`${label} OTP code keyboard attrs`, otpOk(codeAttrs), JSON.stringify(codeAttrs));

  // Type letters / @ / . into email (must not be blocked by numeric mode).
  await email.click();
  await email.fill("");
  await page.keyboard.type("boss.test@meow.test", { delay: 15 });
  const typed = await email.inputValue();
  step(`${label} can type email letters/@/.`, typed === "boss.test@meow.test", `value=${typed}`);

  await code.click();
  await code.fill("");
  await page.keyboard.type("12ab34", { delay: 15 });
  const codeTyped = await code.inputValue();
  // Browser may still allow letters in type=text; we only assert maxlength and digits path.
  await code.fill("123456");
  const codeDigits = await code.inputValue();
  step(`${label} OTP accepts 6 digits`, codeDigits === "123456", `value=${codeDigits} mixed=${codeTyped}`);

  const sendBtn = page.locator('[data-send-login-otp]');
  step(`${label} get-code button visible`, await sendBtn.isVisible().catch(() => false), "");

  // Switch to password tab and ensure attrs do not cross-contaminate.
  const passTab = page.locator('[data-login-tab="email"]');
  if (await passTab.count()) {
    await passTab.click();
    await page.waitForTimeout(300);
    const passEmail = page.locator("#loginGmail");
    const passPwd = page.locator("#loginGmailCode");
    const passEmailAttrs = await passEmail.evaluate(attrsOf);
    const passPwdType = await passPwd.evaluate((el) => String(el.type || "").toLowerCase());
    const passPwdMode = await passPwd.evaluate((el) => String(el.getAttribute("inputmode") || "").toLowerCase());
    step(`${label} password-tab email attrs`, emailOk(passEmailAttrs), JSON.stringify(passEmailAttrs));
    step(
      `${label} password field not numeric OTP`,
      passPwdType === "password" && passPwdMode !== "numeric",
      `type=${passPwdType} inputmode=${passPwdMode || "(none)"}`
    );

    // Switch back to OTP — email must still be email keyboard.
    await page.locator('[data-login-tab="otp"]').click();
    await page.waitForTimeout(300);
    const emailAttrs2 = await email.evaluate(attrsOf);
    const codeAttrs2 = await code.evaluate(attrsOf);
    step(`${label} after tab switch email attrs`, emailOk(emailAttrs2), JSON.stringify(emailAttrs2));
    step(`${label} after tab switch code attrs`, otpOk(codeAttrs2), JSON.stringify(codeAttrs2));
  }

  // Overflow check: page shouldn't grow horizontally after focus.
  await email.click();
  await page.waitForTimeout(200);
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return {
      clientWidth: doc.clientWidth,
      scrollWidth: doc.scrollWidth,
      bodyScrollWidth: document.body ? document.body.scrollWidth : 0,
    };
  });
  step(
    `${label} no horizontal overflow on email focus`,
    overflow.scrollWidth <= overflow.clientWidth + 2,
    JSON.stringify(overflow)
  );
}

async function probeClassifier(page, label) {
  // Load local auth-shell logic into an empty page for deterministic unit checks.
  const script = await readFile(path.join(ROOT, "src/auth-shell.js"), "utf8");
  await page.setContent("<!doctype html><html><body></body></html>");
  await page.addScriptTag({ content: script });
  const report = await page.evaluate(() => {
    const shell = window.MCJAuthShell;
    function make(attrs) {
      const el = document.createElement("input");
      Object.keys(attrs).forEach((k) => {
        if (k === "type") el.type = attrs[k];
        else el.setAttribute(k, attrs[k]);
      });
      return el;
    }
    const cases = [
      ["loginOtpEmail", make({ id: "loginOtpEmail", type: "email" }), false, true],
      ["loginOtpCode", make({ id: "loginOtpCode", name: "otp", type: "text", "data-auth-code": "1" }), true, false],
      ["loginGmail", make({ id: "loginGmail", type: "email" }), false, true],
      ["loginGmailCode", make({ id: "loginGmailCode", type: "password", "data-auth-sensitive": "1" }), false, false],
      ["registerEmail", make({ id: "registerEmail", type: "email" }), false, true],
      ["registerOtpCode", make({ id: "registerOtpCode", name: "registerOtp", "data-auth-code": "1" }), true, false],
      ["account", make({ name: "account", type: "email" }), false, true],
    ];
    const out = [];
    const root = document.createElement("div");
    document.body.appendChild(root);
    cases.forEach(([name, el, expectCode, expectAccount]) => {
      root.appendChild(el);
      const isCode = shell.isCodeInput(el);
      const isAccount = shell.isAccountInput(el);
      out.push({ name, isCode, expectCode, isAccount, expectAccount, ok: isCode === expectCode && isAccount === expectAccount });
    });
    // prepareAuthForm must force correct keyboards
    root.innerHTML =
      '<input id="loginOtpEmail" type="email" autocomplete="username">' +
      '<input id="loginOtpCode" name="otp" data-auth-code="1" maxlength="6">' +
      '<input id="loginGmail" type="email">' +
      '<input id="loginGmailCode" type="password" data-auth-sensitive="1">';
    shell.prepareAuthForm(root, { clearAccount: true });
    function snap(sel) {
      const el = root.querySelector(sel);
      return {
        type: String(el.type || "").toLowerCase(),
        inputmode: String(el.getAttribute("inputmode") || "").toLowerCase(),
        autocomplete: String(el.getAttribute("autocomplete") || "").toLowerCase(),
        maxlength: String(el.getAttribute("maxlength") || ""),
      };
    }
    return { cases: out, prepared: {
      email: snap("#loginOtpEmail"),
      code: snap("#loginOtpCode"),
      passEmail: snap("#loginGmail"),
      pass: snap("#loginGmailCode"),
    }};
  });
  const allClassOk = report.cases.every((c) => c.ok);
  step(
    `${label} isCodeInput classification`,
    allClassOk,
    report.cases.map((c) => `${c.name}:code=${c.isCode}/${c.expectCode},acct=${c.isAccount}/${c.expectAccount}`).join(" | ")
  );
  step(
    `${label} prepareAuthForm email`,
    emailOk(report.prepared.email),
    JSON.stringify(report.prepared.email)
  );
  step(
    `${label} prepareAuthForm otp`,
    otpOk(report.prepared.code) && report.prepared.code.autocomplete === "one-time-code",
    JSON.stringify(report.prepared.code)
  );
  step(
    `${label} prepareAuthForm password-tab email`,
    emailOk(report.prepared.passEmail),
    JSON.stringify(report.prepared.passEmail)
  );
  step(
    `${label} prepareAuthForm password not numeric`,
    report.prepared.pass.type === "password" && report.prepared.pass.inputmode !== "numeric",
    JSON.stringify(report.prepared.pass)
  );
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  let local = null;
  try {
    const unitPage = await browser.newPage();
    await probeClassifier(unitPage, "unit");
    await unitPage.close();

    local = await startLocalStatic();
    const iPhone = devices["iPhone 13"] || devices["iPhone 12"];
    const context = await browser.newContext({
      ...iPhone,
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    await page.goto(`${local.base}/index.html`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await probeBossLogin(page, "local-iphone");
    await context.close();

    if (STAGING) {
      const ctx2 = await browser.newContext({
        ...iPhone,
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      });
      const page2 = await ctx2.newPage();
      await page2.goto(`${STAGING}/`, { waitUntil: "domcontentloaded", timeout: 90000 });
      await probeBossLogin(page2, "staging-iphone");
      // companion login otp tab
      await page2.goto(`${STAGING}/companion/login/`, { waitUntil: "domcontentloaded", timeout: 90000 });
      await page2.waitForTimeout(1000);
      const cEmail = page2.locator("#loginOtpEmail, input[name='account'][type='email']").first();
      if (await cEmail.count()) {
        const a = await cEmail.evaluate(attrsOf);
        step("staging-companion OTP email attrs", emailOk(a), JSON.stringify(a));
      } else {
        step("staging-companion OTP email attrs", false, "email input missing");
      }
      await ctx2.close();
    }
  } finally {
    await browser.close();
    if (local) local.server.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log("\nSUMMARY", `${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) {
    failed.forEach((f) => console.log(" -", f.name, f.detail));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
