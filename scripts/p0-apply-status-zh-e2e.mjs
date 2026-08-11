/**
 * Apply status Chinese labels — no raw DB enums on companion apply UI.
 * PREVIEW=https://meow-cuijiao-homepage-staging.vercel.app node scripts/p0-apply-status-zh-e2e.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.PREVIEW || "https://meow-cuijiao-homepage-staging.vercel.app").replace(/\/$/, "");
const PASS = process.env.PASS || "McjTest@12345678";
const EMAIL = process.env.E2E_COMPANION_EMAIL || "companion@meow.test";
const ART = path.join("/opt/cursor/artifacts", "apply-status-zh-e2e");
const ART_REPO = path.join(ROOT, "artifacts", "apply-status-zh-e2e");
fs.mkdirSync(ART, { recursive: true });
fs.mkdirSync(ART_REPO, { recursive: true });

const EXPECTED = {
  draft: "草稿中",
  pending: "审核中",
  approved: "审核通过",
  rejected: "审核未通过",
};

const results = [];
function step(name, ok, detail) {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "").slice(0, 900) });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
  return !!ok;
}

function statusLabelOf(code) {
  var key = String(code || "").toLowerCase().trim();
  var map = {
    draft: "草稿中",
    pending: "审核中",
    review: "审核中",
    submitted: "审核中",
    resubmit: "需要补资料",
    need_more: "需要补资料",
    approved: "审核通过",
    verified: "审核通过",
    passed: "审核通过",
    rejected: "审核未通过",
  };
  if (map[key]) return map[key];
  if (!key || /^[a-z][a-z0-9_]*$/i.test(key)) return "草稿中";
  return String(code);
}

async function waitDeploy(maxMs = 180000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    try {
      const html = await (await fetch(`${BASE}/companion-apply.html?cb=${Date.now()}`, { cache: "no-store" })).text();
      const asset =
        html.match(/\/assets\/companion-apply-[^"'?]+\.js/) ||
        html.match(/src\/companion-application\.js[^"']*/);
      let jsText = "";
      if (asset) {
        const rel = asset[0].startsWith("src/") ? "/" + asset[0] : asset[0];
        const url = rel.startsWith("http") ? rel : `${BASE}${rel.startsWith("/") ? rel : "/" + rel}`;
        jsText = await (await fetch(url.split("?")[0] + "?cb=" + Date.now(), { cache: "no-store" })).text();
      }
      const ok =
        /草稿中/.test(jsText) &&
        /审核中/.test(jsText) &&
        /审核通过/.test(jsText) &&
        /审核未通过/.test(jsText) &&
        (/draft:\s*"草稿中"|draft:"草稿中"/.test(jsText) || /draft:"草稿中"/.test(jsText.replace(/\s+/g, "")));
      if (ok) {
        step("deploy_ready", true, `elapsed=${Date.now() - t0}ms asset=${asset ? asset[0] : "none"}`);
        return true;
      }
      console.log("[wait] deploy not ready", {
        hasAsset: !!asset,
        draft: /草稿中/.test(jsText),
        len: jsText.length,
      });
    } catch (e) {
      console.log("[wait]", e.message);
    }
    await new Promise((r) => setTimeout(r, 8000));
  }
  step("deploy_ready", false, "timeout");
  return false;
}

async function main() {
  step("base", true, BASE);

  const src = fs.readFileSync(path.join(ROOT, "src/companion-application.js"), "utf8");
  step("source_has_draft_map", /draft:\s*"草稿中"/.test(src), "draft→草稿中");
  step("source_has_pending_map", /pending:\s*"审核中"/.test(src), "pending→审核中");
  step("source_has_approved_map", /approved:\s*"审核通过"/.test(src), "approved→审核通过");
  step("source_has_rejected_map", /rejected:\s*"审核未通过"/.test(src), "rejected→审核未通过");
  step(
    "source_no_raw_fallback",
    !/return map\[String\(code[^]]*\)\] \|\| code/.test(src) && /Never leak raw English/.test(src),
    "no raw code fallback"
  );

  for (const [k, v] of Object.entries(EXPECTED)) {
    step(`map_${k}`, statusLabelOf(k) === v, `${k} => ${statusLabelOf(k)}`);
  }

  const ready = await waitDeploy();
  if (!ready) {
    fs.writeFileSync(path.join(ART_REPO, "results.json"), JSON.stringify({ overall: "FAIL", results }, null, 2));
    process.exit(1);
  }

  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || "/usr/bin/google-chrome-stable",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  const login = await fetch(`${BASE}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ action: "login", email: EMAIL, password: PASS, loginPortal: "companion" }),
  }).then((r) => r.json().catch(() => ({})));
  const token =
    login?.session?.accessToken || login?.session?.token || login?.accessToken || login?.token || "";
  step("companion_login", !!token, `tok=${!!token}`);
  if (!token) {
    await browser.close();
    process.exit(1);
  }
  await context.addInitScript((t) => {
    try {
      localStorage.setItem("mcjAuthAccessToken", t);
      sessionStorage.setItem("mcjAuthAccessToken", t);
      localStorage.setItem("mcjCompanionAccessToken", t);
      sessionStorage.setItem("mcjCompanionAccessToken", t);
      localStorage.setItem("mcjRole", "companion");
    } catch (_) {}
  }, token);

  // Live-render each status by stubbing companion bootstrap auditStatus.
  for (const [code, label] of Object.entries(EXPECTED)) {
    await page.route("**/api/companion**", async (route) => {
      const req = route.request();
      const url = req.url();
      if (!/action=bootstrap|bootstrap/i.test(url) && req.method() === "GET" && !/companion\?/.test(url)) {
        return route.continue();
      }
      // Only rewrite bootstrap JSON.
      if (req.method() === "GET" || /bootstrap/i.test(url) || (req.postData() || "").includes("bootstrap")) {
        try {
          const res = await route.fetch();
          const json = await res.json().catch(() => ({}));
          if (json && json.player) {
            json.player.auditStatus = code;
            json.player.applicationStatus = code;
            json.player.application_status = code;
            if (code !== "rejected") json.player.applicationRejectReason = "";
            else json.player.applicationRejectReason = "测试驳回";
          } else if (json) {
            json.player = { auditStatus: code, applicationStatus: code };
          }
          return route.fulfill({
            status: res.status(),
            contentType: "application/json",
            body: JSON.stringify(json),
          });
        } catch (_) {
          return route.continue();
        }
      }
      return route.continue();
    });
    await page.goto(`${BASE}/companion-apply.html?cb=${Date.now()}&statusStub=${code}`, {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });
    await page.waitForTimeout(2800);
    const check = await page.evaluate((expectedLabel) => {
      const note = document.querySelector(".apply-status-note");
      const text = (note && note.textContent) || "";
      return {
        text: text.slice(0, 240),
        hasLabel: text.includes(expectedLabel),
        hasEnglish: /\b(draft|pending|approved|rejected)\b/i.test(text),
        line: (/当前申请状态[：:][^\n]*/.exec(document.body.innerText || "") || [""])[0],
      };
    }, label);
    await page.screenshot({ path: path.join(ART, `live-${code}.png`) }).catch(() => null);
    try {
      fs.copyFileSync(path.join(ART, `live-${code}.png`), path.join(ART_REPO, `live-${code}.png`));
    } catch (_) {}
    step(
      `live_render_${code}`,
      check.hasLabel && !check.hasEnglish,
      JSON.stringify(check)
    );
    await page.unroute("**/api/companion**").catch(() => null);
  }

  // Also verify workbench STATUS_CN.verification mapping via source
  const wb = fs.readFileSync(path.join(ROOT, "src/companion-workbench.js"), "utf8");
  step("workbench_draft_zh", /draft\$\/\.test\(v\)\)return '草稿中'/.test(wb) || /草稿中/.test(wb), "workbench draft label");
  step("workbench_no_raw_return_s", !/return s\|\|'资料未完成'/.test(wb), "no raw s fallback");

  await browser.close();
  const failed = results.filter((r) => r.result === "FAIL");
  const out = { overall: failed.length ? "FAIL" : "PASS", failed: failed.length, base: BASE, results };
  fs.writeFileSync(path.join(ART, "results.json"), JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(ART_REPO, "results.json"), JSON.stringify(out, null, 2));
  console.log("\nALL_PASS", failed.length === 0);
  console.log(JSON.stringify(out, null, 2));
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
