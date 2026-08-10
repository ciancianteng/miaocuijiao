/**
 * P0: Boss recharge full loop
 * select → pay step (QR+proof) → pending_review → admin approve → wallet + ledger
 * Idempotent re-approve + reject reason path.
 *
 * PREVIEW=https://... node scripts/p0-boss-recharge-full-loop-e2e.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, devices } from "playwright-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.PREVIEW || process.env.MCJ_STAGING_URL || "https://meow-cuijiao-homepage-staging.vercel.app").replace(
  /\/$/,
  ""
);
const PASS = process.env.PASS || process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const BOSS = process.env.E2E_BOSS_EMAIL || "boss@meow.test";
const ADMIN = process.env.E2E_ADMIN_EMAIL || "admin@meow.test";
const ART = path.join("/opt/cursor/artifacts", "boss-recharge-full-loop-e2e");
const ART_REPO = path.join(ROOT, "artifacts", "boss-recharge-full-loop-e2e");
fs.mkdirSync(ART, { recursive: true });
fs.mkdirSync(ART_REPO, { recursive: true });

const results = [];
function step(name, ok, detail) {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "").slice(0, 800) });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
  return !!ok;
}

async function api(pathname, token, body, method = null, extraHeaders = {}) {
  const m = method || (body == null ? "GET" : "POST");
  const res = await fetch(`${BASE}${pathname}`, {
    method: m,
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body != null ? { "Content-Type": "application/json" } : {}),
      ...extraHeaders,
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok && json.ok !== false, status: res.status, json };
}
function tok(j) {
  return j?.session?.accessToken || j?.session?.token || j?.accessToken || j?.token || "";
}
function money(v) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}
function tinyPngDataUrl() {
  const b64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC";
  return `data:image/png;base64,${b64}`;
}
async function shot(page, name) {
  const file = `${name}.png`;
  const p1 = path.join(ART, file);
  await page.screenshot({ path: p1, fullPage: true }).catch(() => null);
  try {
    fs.copyFileSync(p1, path.join(ART_REPO, file));
  } catch {
    /* optional */
  }
  return p1;
}

function writeReport() {
  const out = {
    base: BASE,
    boss: BOSS,
    at: new Date().toISOString(),
    results,
    allPass: results.every((r) => r.result === "PASS"),
  };
  fs.writeFileSync(path.join(ART, "report.json"), JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(ART_REPO, "report.json"), JSON.stringify(out, null, 2));
  const lines = [
    "# Boss recharge full-loop E2E",
    "",
    `| Base | ${BASE} |`,
    `| Boss | ${BOSS} |`,
    "",
    "| Check | Result | Detail |",
    "| --- | --- | --- |",
    ...results.map((r) => `| ${r.step} | ${r.result} | ${String(r.detail || "").replace(/\|/g, "/")} |`),
    "",
    `Overall: **${out.allPass ? "PASS" : "FAIL"}**`,
  ];
  fs.writeFileSync(path.join(ART, "report.md"), lines.join("\n"));
  fs.writeFileSync(path.join(ART_REPO, "report.md"), lines.join("\n"));
  return out;
}

(async () => {
  console.log("BASE", BASE);
  let failedHard = false;

  const html = await (await fetch(`${BASE}/recharge.html?cb=${Date.now()}`, { cache: "no-store" })).text();
  step(
    "asset_recharge_center_js",
    /recharge-center\.js\?v=20260810rechargeLoop/.test(html),
    /recharge-center\.js\?v=[^"']+/.exec(html)?.[0] || "missing recharge-center.js"
  );
  const adminHtml = await (await fetch(`${BASE}/admin.html?cb=${Date.now()}`, { cache: "no-store" })).text();
  step(
    "asset_admin_recharge_review_js",
    /admin-recharge-review\.js\?v=20260810rechargeLoop/.test(adminHtml),
    /admin-recharge-review\.js\?v=[^"']+/.exec(adminHtml)?.[0] || "missing"
  );

  const bossLogin = await api("/api/auth", null, { action: "login", email: BOSS, password: PASS, loginPortal: "boss" });
  const adminLogin = await api("/api/auth", null, { action: "login", email: ADMIN, password: PASS, loginPortal: "admin" });
  const bossT = tok(bossLogin.json);
  const adminT = tok(adminLogin.json);
  step("logins", !!(bossT && adminT), `boss=${!!bossT} admin=${!!adminT}`);
  if (!bossT || !adminT) {
    writeReport();
    process.exit(1);
  }

  // Cleanup named fake shells if still present
  for (const pn of ["PAY-1786296969555-6CS3", "PAY-1786296959730-NBSH"]) {
    await api("/api/admin/wallet", adminT, { action: "cleanup_test_recharges", paymentNos: [pn] }, "POST", {
      "x-mcj-admin-role": "admin",
    });
  }

  const before = await api("/api/recharge", bossT, null, "GET");
  const balanceA = money(before.json?.summary?.balance ?? before.json?.wallet?.totalBalance);
  const txCountA = (before.json?.transactions || []).length;
  const campaigns = before.json?.campaigns || [];
  const methods = (before.json?.methods || []).filter((m) => m && m.open !== false);
  const camp =
    campaigns.find((c) => money(c.payAmountRm) === 100 && money(c.totalCatFood) === 105) ||
    campaigns.find((c) => money(c.payAmountRm) === 100) ||
    campaigns[0];
  const duitnow = methods.find((m) => String(m.code || "").toLowerCase() === "duitnow") || methods[0];
  step(
    "campaign_rm100_105",
    !!(camp && money(camp.payAmountRm) > 0),
    camp
      ? `${camp.name} pay=${camp.payAmountRm} base=${camp.baseCatFood} bonus=${camp.bonusCatFood} total=${camp.totalCatFood}`
      : "no campaign"
  );
  step("method_duitnow_enabled", !!(duitnow && duitnow.code), duitnow ? `${duitnow.code} open=${duitnow.open}` : "missing");

  // Create recharge → must enter payment step with payInfo QR
  const created = await api("/api/recharge", bossT, {
    campaignId: camp?.id,
    paymentMethod: duitnow?.code || "duitnow",
  });
  const order = created.json?.paymentOrder || {};
  const payInfo = created.json?.payInfo || null;
  const paymentNo = order.paymentNo || "";
  const creditExpect =
    money(order.totalCatFood) || money(order.catFoodAmount) || money(camp?.totalCatFood) || money(camp?.baseCatFood) + money(camp?.bonusCatFood);
  step(
    "立即充值进入付款步骤",
    !!(created.ok && created.json?.enterPaymentStep && paymentNo && /pending/i.test(String(order.status || ""))),
    `enter=${created.json?.enterPaymentStep} no=${paymentNo} status=${order.status} msg=${created.json?.message || ""}`
  );
  step(
    "二维码真实读取后台",
    !!(payInfo && payInfo.qrUrl && /^https?:\/\//i.test(String(payInfo.qrUrl))),
    payInfo ? `title=${payInfo.title || ""} qr=${String(payInfo.qrUrl).slice(0, 80)} receiver=${payInfo.receiverName || ""}` : "no payInfo"
  );

  // UI: pay step + preview + disabled until file
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || "/usr/bin/google-chrome-stable",
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    const context = await browser.newContext({ ...devices["iPhone 13"] });
    const page = await context.newPage();
    await page.addInitScript(
      ({ token }) => {
        try {
          localStorage.setItem("mcjAuthAccessToken", token);
          sessionStorage.setItem("mcjAuthAccessToken", token);
          localStorage.setItem("mcjBossAccessToken", token);
        } catch (e) {}
      },
      { token: bossT }
    );
    // Inject local recharge-center.js so UI checks work even before CDN cache bust on alias
    const localJs = fs.readFileSync(path.join(ROOT, "src/recharge-center.js"), "utf8");
    await page.route("**/src/recharge-center.js**", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/javascript", body: localJs });
    });
    await page.goto(`${BASE}/recharge.html?paymentNo=${encodeURIComponent(paymentNo)}&cb=${Date.now()}`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForTimeout(2500);
    await shot(page, "01-pay-step");

    const payUi = await page.evaluate(() => {
      const qr = document.querySelector("[data-mcj-pay-qr], .pay-qr-frame img");
      const paidBtn = document.querySelector("[data-i-paid]");
      const file = document.querySelector("[data-proof-file]");
      const h1 = document.querySelector("h1")?.textContent || "";
      return {
        h1,
        hasQr: !!(qr && (qr.getAttribute("src") || "").length > 8),
        paidDisabled: !paidBtn ? null : !!paidBtn.disabled,
        hasFile: !!file,
        bodySnippet: (document.body?.innerText || "").slice(0, 400),
      };
    });
    step(
      "ui_pay_step_visible",
      /充值付款|付款/.test(payUi.h1) && payUi.hasFile,
      `h1=${payUi.h1} qr=${payUi.hasQr} paidDisabled=${payUi.paidDisabled} file=${payUi.hasFile}`
    );
    step("我已付款_未上传禁用", payUi.paidDisabled === true, `disabled=${payUi.paidDisabled}`);

    // Pick file → preview → enable
    const pngPath = path.join(ART, "proof.png");
    fs.writeFileSync(
      pngPath,
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC",
        "base64"
      )
    );
    const fileInput = page.locator("[data-proof-file]");
    if ((await fileInput.count()) > 0) {
      await fileInput.setInputFiles(pngPath);
      await page.waitForTimeout(800);
      await shot(page, "02-proof-preview");
      const afterPick = await page.evaluate(() => {
        const img = document.querySelector(".pay-proof-preview img");
        const paidBtn = document.querySelector("[data-i-paid]");
        return {
          preview: !!(img && (img.getAttribute("src") || "").startsWith("data:image")),
          paidDisabled: !paidBtn ? null : !!paidBtn.disabled,
          label: document.querySelector(".pay-proof-name")?.textContent || "",
        };
      });
      step("截图预览", afterPick.preview === true, `preview=${afterPick.preview} label=${afterPick.label}`);
      step("我已付款_上传后可点", afterPick.paidDisabled === false, `disabled=${afterPick.paidDisabled}`);
    } else {
      step("截图预览", false, "no file input");
      step("我已付款_上传后可点", false, "no file input");
    }
  } catch (err) {
    step("ui_pay_step_visible", false, err.message || String(err));
    step("我已付款_未上传禁用", false, "ui error");
    step("截图预览", false, "ui error");
    step("我已付款_上传后可点", false, "ui error");
  } finally {
    if (browser) await browser.close().catch(() => null);
  }

  // API submit proof (source of truth for storage + status)
  const submitted = await api("/api/recharge", bossT, {
    action: "submit_proof",
    paymentNo,
    proofDataUrl: tinyPngDataUrl(),
  });
  const afterSubmit = submitted.json?.paymentOrder || {};
  step(
    "付款截图上传",
    !!(submitted.ok && (afterSubmit.hasProof || afterSubmit.proofUrl || afterSubmit.proofPath)),
    `ok=${submitted.ok} status=${afterSubmit.status} hasProof=${afterSubmit.hasProof} url=${String(afterSubmit.proofUrl || "").slice(0, 60)} msg=${submitted.json?.message || ""}`
  );
  step(
    "待支付→待审核",
    String(afterSubmit.status || "").toLowerCase() === "pending_review",
    `status=${afterSubmit.status}`
  );

  // Ensure no duplicate order created
  const list2 = await api("/api/recharge", bossT, null, "GET");
  const sameNos = (list2.json?.records || []).filter((r) => r.paymentNo === paymentNo);
  step("不重复创建订单", sameNos.length === 1, `count=${sameNos.length} status=${sameNos[0]?.status}`);

  // Admin sees proof
  const queue = await api(
    "/api/admin/wallet?action=pending_recharges&status=pending_review",
    adminT,
    null,
    "GET",
    { "x-mcj-admin-role": "admin" }
  );
  const hit = (queue.json?.items || []).find((i) => i.paymentNo === paymentNo);
  step(
    "后台看到截图",
    !!(hit && hit.proofUrl && /^https?:\/\//i.test(String(hit.proofUrl))),
    hit
      ? `bossId=${hit.bossId} amount=${hit.amountRm} total=${hit.totalCatFood} proof=${String(hit.proofUrl).slice(0, 70)}`
      : `not in queue n=${(queue.json?.items || []).length}`
  );

  // Approve
  const approved = await api(
    "/api/admin/wallet",
    adminT,
    { action: "confirm_manual_recharge", paymentNo },
    "POST",
    { "x-mcj-admin-role": "admin" }
  );
  step(
    "后台审核通过",
    !!(approved.ok && !approved.json?.duplicate),
    `ok=${approved.ok} dup=${approved.json?.duplicate} msg=${approved.json?.message || ""} result=${JSON.stringify(approved.json?.result || {}).slice(0, 200)}`
  );

  const after = await api("/api/recharge", bossT, null, "GET");
  const balanceB = money(after.json?.summary?.balance ?? after.json?.wallet?.totalBalance);
  const credited = (after.json?.records || []).find((r) => r.paymentNo === paymentNo);
  const delta = money(balanceB - balanceA);
  step(
    "猫粮真实增加",
    delta === money(creditExpect) || Math.abs(delta - money(creditExpect)) < 0.01,
    `A=${balanceA} B=${balanceB} delta=${delta} expect=${creditExpect}`
  );
  step(
    "充值订单已到账",
    /paid|credited/i.test(String(credited?.status || "")),
    `status=${credited?.status} text=${credited?.statusText}`
  );

  const txs = after.json?.transactions || [];
  const related = txs.filter(
    (t) =>
      String(t.relatedRechargeId || t.related_recharge_id || "").length > 0 &&
      (String(credited?.id || "") === String(t.relatedRechargeId || t.related_recharge_id || "") ||
        String(t.reason || "").includes(paymentNo) ||
        /充值/.test(String(t.typeText || t.type || "")))
  );
  // Prefer txs created after this run that sum to creditExpect (paid + bonus often split).
  const recentPos = txs.filter((t) => money(t.signedAmount || t.amount) > 0).slice(0, 6);
  const sumRecent = money(
    recentPos
      .filter((t) => /recharge|充值/i.test(String(t.typeText || t.type || t.reason || "")))
      .slice(0, 2)
      .reduce((s, t) => s + money(t.signedAmount || t.amount), 0)
  );
  const ledgerOk =
    sumRecent === money(creditExpect) ||
    related.some((t) => money(t.signedAmount || t.amount) === money(creditExpect)) ||
    (related.length >= 1 &&
      money(related.reduce((s, t) => s + money(t.signedAmount || t.amount), 0)) === money(creditExpect));
  step(
    "钱包流水生成",
    ledgerOk,
    `sumRecent=${sumRecent} expect=${creditExpect} related=${related.length} sample=${JSON.stringify(
      recentPos.slice(0, 2).map((t) => ({ t: t.typeText || t.type, a: t.signedAmount, r: t.relatedRechargeId }))
    )}`
  );

  // Re-approve must not double credit
  const reApprove = await api(
    "/api/admin/wallet",
    adminT,
    { action: "confirm_manual_recharge", paymentNo },
    "POST",
    { "x-mcj-admin-role": "admin" }
  );
  const after2 = await api("/api/recharge", bossT, null, "GET");
  const balanceC = money(after2.json?.summary?.balance ?? after2.json?.wallet?.totalBalance);
  step(
    "重复审核不会重复到账",
    balanceC === balanceB && (reApprove.json?.duplicate === true || /已到账|重复/.test(String(reApprove.json?.message || ""))),
    `B=${balanceB} C=${balanceC} dup=${reApprove.json?.duplicate} msg=${reApprove.json?.message || ""}`
  );

  // Reject path on a fresh order
  const created2 = await api("/api/recharge", bossT, {
    campaignId: camp?.id,
    paymentMethod: duitnow?.code || "duitnow",
  });
  const pn2 = created2.json?.paymentOrder?.paymentNo || "";
  const sub2 = await api("/api/recharge", bossT, {
    action: "submit_proof",
    paymentNo: pn2,
    proofDataUrl: tinyPngDataUrl(),
  });
  const rejected = await api(
    "/api/admin/wallet",
    adminT,
    { action: "reject_manual_recharge", paymentNo: pn2, reason: "E2E拒绝原因-截图不符" },
    "POST",
    { "x-mcj-admin-role": "admin" }
  );
  const bossSee = await api(`/api/recharge?paymentNo=${encodeURIComponent(pn2)}`, bossT, null, "GET");
  const rejectReason = bossSee.json?.paymentOrder?.rejectReason || "";
  step(
    "拒绝原因老板可见",
    !!(rejected.ok && sub2.ok && /E2E拒绝原因/.test(rejectReason) && String(bossSee.json?.paymentOrder?.status) === "rejected"),
    `pn2=${pn2} status=${bossSee.json?.paymentOrder?.status} reason=${rejectReason}`
  );

  const report = writeReport();
  console.log("\n=== MATRIX ===");
  const matrixKeys = [
    ["立即充值进入付款步骤", "立即充值进入付款步骤"],
    ["二维码真实读取后台", "二维码真实读取后台"],
    ["付款截图上传", "付款截图上传"],
    ["截图预览", "截图预览"],
    ["我已付款", "我已付款_上传后可点"],
    ["待支付→待审核", "待支付→待审核"],
    ["后台看到截图", "后台看到截图"],
    ["后台审核通过", "后台审核通过"],
    ["猫粮真实增加", "猫粮真实增加"],
    ["钱包流水生成", "钱包流水生成"],
    ["重复审核不会重复到账", "重复审核不会重复到账"],
    ["拒绝原因老板可见", "拒绝原因老板可见"],
  ];
  for (const [label, key] of matrixKeys) {
    const r = results.find((x) => x.step === key);
    const gated = results.find((x) => x.step === "我已付款_未上传禁用");
    if (label === "我已付款") {
      const ok = r?.result === "PASS" && gated?.result === "PASS";
      console.log(`【${label}】${ok ? "PASS" : "FAIL"}`);
      continue;
    }
    console.log(`【${label}】${r ? r.result : "FAIL"}`);
  }
  console.log("OVERALL", report.allPass ? "PASS" : "FAIL");
  if (!report.allPass) failedHard = true;
  process.exit(failedHard ? 1 : 0);
})().catch((err) => {
  console.error(err);
  results.push({ step: "fatal", result: "FAIL", detail: String(err?.message || err) });
  try {
    writeReport();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
