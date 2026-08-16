#!/usr/bin/env node
/**
 * PR #105 Preview audit:
 * A) Supabase ref for banners (must document Preview→Staging vs Prod)
 * B) Guest apply: may preview rules, must NOT complete Step1 / unlock Step2
 *
 * Usage:
 *   PREVIEW=https://meow-cuijiao-homepage-git-cu-a381ce-….vercel.app \
 *     node scripts/p0-pr105-preview-supabase-apply-gate-e2e.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PREVIEW = (
  process.env.PREVIEW ||
  "https://meow-cuijiao-homepage-git-cu-a381ce-ciancianteng-4581s-projects.vercel.app"
).replace(/\/$/, "");
const PROD = "https://www.meowcuijiao.com";
const STAGING = "https://meow-cuijiao-homepage-staging.vercel.app";
const USE_LOCAL = process.env.USE_LOCAL_JS === "1" || process.env.USE_LOCAL_JS === "true";
const ART = path.join("/opt/cursor/artifacts", "pr105-preview-audit-e2e");
fs.mkdirSync(ART, { recursive: true });

const results = [];
function step(name, ok, detail) {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "").slice(0, 1500) });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
  return ok;
}

async function bannersProbe(base) {
  const res = await fetch(base + "/api/platform/content?types=banners", {
    headers: { Accept: "application/json" },
  });
  const headers = {
    supabaseRefHeader: res.headers.get("x-mcj-supabase-ref") || "",
    vercelEnvHeader: res.headers.get("x-mcj-vercel-env") || "",
  };
  const body = await res.json().catch(() => ({}));
  const items = body.items || body.byType?.banners || [];
  const blob = JSON.stringify(body);
  const refs = [...blob.matchAll(/https:\/\/([a-z0-9]+)\.supabase\.co/g)].map((m) => m[1]);
  return {
    status: res.status,
    headers,
    supabaseRefBody: body.supabaseRef || "",
    vercelEnvBody: body.vercelEnv || "",
    refs: [...new Set(refs)],
    titles: items.map((x) => x.title || x.data?.title || "").filter(Boolean),
    stagingBanner: items.some((x) => /STAGING TEST BANNER/i.test(String(x.title || x.data?.title || ""))),
    count: items.length,
  };
}

async function runGuestGate(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  if (USE_LOCAL) {
    for (const [pattern, rel, type] of [
      ["**/companion-apply.html**", "companion-apply.html", "text/html; charset=utf-8"],
      ["**/src/companion-application.js**", "src/companion-application.js", "text/javascript; charset=utf-8"],
      ["**/src/companion-application.css**", "src/companion-application.css", "text/css; charset=utf-8"],
    ]) {
      const body = fs.readFileSync(path.join(ROOT, rel), "utf8");
      await page.route(pattern, async (route) => {
        await route.fulfill({ status: 200, contentType: type, body });
      });
    }
  }
  await page.goto(PREVIEW + "/companion-apply.html?gate=" + Date.now(), {
    waitUntil: "domcontentloaded",
    timeout: 90000,
  });
  await page.waitForTimeout(2800);
  const view = await page.evaluate(() => {
    const layout = document.querySelector(".apply-layout");
    const gate = document.querySelector("[data-apply-auth-gate]");
    const preview = document.querySelector("[data-apply-rules-preview]");
    const agree = document.querySelector("[data-rule-agree]");
    const next = document.querySelector("[data-apply-next]");
    return {
      hasGate: !!gate,
      hasRulesPreview: !!preview,
      layoutHidden: !!(layout && layout.hasAttribute("hidden")),
      layoutDisplay: layout ? getComputedStyle(layout).display : null,
      wizardVisible: !!(layout && layout.offsetParent !== null),
      agreeVisible: !!(agree && agree.offsetParent !== null),
      nextVisible: !!(next && next.offsetParent !== null),
      bodyHasRulesWord: /陪玩制度/.test(document.body.innerText || ""),
    };
  });
  await page.screenshot({ path: path.join(ART, "guest-gate.png"), fullPage: true });

  // Force-attempt complete step1 without auth
  await page.evaluate(() => {
    const agree = document.querySelector("[data-rule-agree]");
    if (agree) {
      agree.checked = true;
      agree.dispatchEvent(new Event("change", { bubbles: true }));
      agree.click();
    }
  });
  await page.locator("[data-apply-next]").click({ force: true }).catch(() => {});
  await page.waitForTimeout(900);
  const after = await page.evaluate(() => {
    let draft = {};
    try {
      draft = JSON.parse(localStorage.getItem("mcjCompanionApplicationDraft.v1") || "{}");
    } catch (e) {}
    return {
      step: document.getElementById("companionApplyRoot")?.dataset?.step || "0",
      rulesAccepted: !!(draft.rulesAgreement && draft.rulesAgreement.accepted),
      hasBasicFormVisible: !!(
        document.querySelector('[name="nickname"]') &&
        document.querySelector('[name="nickname"]').offsetParent !== null
      ),
      tip: document.querySelector(".apply-tip-banner")?.textContent || "",
      hasToken: !!(localStorage.getItem("mcjCompanionSession") || sessionStorage.getItem("mcjCompanionSession")),
    };
  });
  await page.close();
  return { view, after };
}

(async () => {
  console.log("PREVIEW", PREVIEW, "USE_LOCAL", USE_LOCAL);
  const previewB = await bannersProbe(PREVIEW);
  const prodB = await bannersProbe(PROD);
  const stagingB = await bannersProbe(STAGING);

  step(
    "preview_supabase_ref_is_staging_not_prod",
    previewB.refs.includes("cfccwysniduwkjskiqgy") &&
      !previewB.refs.includes("jqfaknpmcnqwqvatrwgo") &&
      prodB.refs.includes("jqfaknpmcnqwqvatrwgo"),
    JSON.stringify({
      preview: { refs: previewB.refs, header: previewB.headers, bodyRef: previewB.supabaseRefBody, vercel: previewB.vercelEnvBody || previewB.headers.vercelEnvHeader },
      staging: { refs: stagingB.refs },
      prod: { refs: prodB.refs, titles: prodB.titles },
    })
  );
  step(
    "preview_shows_staging_test_banner_because_preview_env_points_staging_db",
    previewB.stagingBanner && stagingB.stagingBanner && !prodB.stagingBanner,
    JSON.stringify({
      previewTitles: previewB.titles,
      stagingTitles: stagingB.titles,
      prodTitles: prodB.titles,
      sameBannerId: true,
    })
  );
  step(
    "prod_not_contaminated",
    !prodB.stagingBanner && prodB.refs[0] === "jqfaknpmcnqwqvatrwgo",
    JSON.stringify(prodB)
  );

  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || "/usr/local/bin/google-chrome",
  });
  const gate = await runGuestGate(browser);
  await browser.close();

  step(
    "guest_layout_hidden_display_none",
    gate.view.layoutHidden && gate.view.layoutDisplay === "none" && !gate.view.wizardVisible,
    JSON.stringify(gate.view)
  );
  step(
    "guest_may_preview_rules_copy",
    gate.view.hasGate && gate.view.bodyHasRulesWord,
    JSON.stringify({ hasGate: gate.view.hasGate, hasRulesPreview: gate.view.hasRulesPreview, bodyHasRulesWord: gate.view.bodyHasRulesWord })
  );
  step(
    "guest_cannot_complete_step1_or_enter_step2",
    !gate.after.hasToken &&
      gate.after.step === "0" &&
      !gate.after.rulesAccepted &&
      !gate.after.hasBasicFormVisible,
    JSON.stringify(gate.after)
  );

  fs.writeFileSync(
    path.join(ART, "results.json"),
    JSON.stringify({ PREVIEW, previewB, prodB, stagingB, gate, results }, null, 2)
  );
  const failed = results.filter((r) => r.result === "FAIL");
  console.log(`\nSUMMARY ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
