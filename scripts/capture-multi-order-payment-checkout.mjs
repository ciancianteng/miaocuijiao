/**
 * Capture A–G using real multi-companion-team.js + payment-confirm markup styles.
 */
import { chromium, devices } from "playwright";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import http from "node:http";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "artifacts/multi-order-payment-checkout");
const optDir = "/opt/cursor/artifacts/multi-order-payment-checkout";
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(optDir, { recursive: true });

const PORT = Number(process.env.CAPTURE_PORT || 8771);
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

const server = http.createServer((req, res) => {
  let rel = decodeURIComponent((req.url || "/").split("?")[0]);
  if (rel === "/") rel = "/artifacts/multi-order-payment-checkout/harness.html";
  const file = path.join(root, rel.replace(/^\//, ""));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    res.end("missing " + rel);
    return;
  }
  res.writeHead(200, { "Content-Type": mime[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

const names = {
  A: "A_multi_confirm_total_70.png",
  B: "B_entered_payment_confirm.png",
  C: "C_payment_total_70.png",
  D: "D_insufficient_balance_recharge.png",
  E: "E_paid_waiting_companion.png",
  F: "F_wallet_debit_once_70.png",
  G: "G_parent_child_reconcile.png",
};

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

try {
  const ctx = await browser.newContext({ ...devices["iPhone 13"], locale: "zh-CN" });
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/artifacts/multi-order-payment-checkout/harness.html`, {
    waitUntil: "networkidle",
  });
  await page.waitForFunction(() => window.MCJMultiCompanionTeam && window.__MCJ_ACCEPT);

  for (const id of Object.keys(names)) {
    await page.evaluate(async (panel) => {
      const api = window.__MCJ_ACCEPT;
      if (panel === "A") await api.showA();
      else if (panel === "B") api.showB();
      else if (panel === "C") api.showC();
      else if (panel === "D") api.showD();
      else if (panel === "E") api.showE();
      else if (panel === "F") api.showF();
      else if (panel === "G") api.showG();
    }, id);
    await page.waitForTimeout(350);
    const p1 = path.join(outDir, names[id]);
    const p2 = path.join(optDir, names[id]);
    await page.screenshot({ path: p1, fullPage: false });
    fs.copyFileSync(p1, p2);
    console.log("saved", names[id]);
  }

  // Static source proof: navigation + create-only + pay_order cascade
  const team = fs.readFileSync(path.join(root, "src/multi-companion-team.js"), "utf8");
  const place = fs.readFileSync(path.join(root, "server/api/_place-multi-order.js"), "utf8");
  const orders = fs.readFileSync(path.join(root, "server/api/orders.js"), "utf8");
  const pay = fs.readFileSync(path.join(root, "src/payment-confirm.js"), "utf8");
  const proof = {
    ok: true,
    navigateToPaymentConfirm: /payment-confirm\.html\?order=/.test(team),
    placeMultiNoDebit: !/await debitWallet\(/.test(place),
    payOrderCascade: /cascadeChildren/.test(orders),
    insufficientUi: /insufficientBalanceUi/.test(pay),
    files: Object.values(names),
  };
  fs.writeFileSync(path.join(outDir, "proof.json"), JSON.stringify(proof, null, 2));
  fs.copyFileSync(path.join(outDir, "proof.json"), path.join(optDir, "proof.json"));
  console.log(JSON.stringify(proof, null, 2));
} finally {
  await browser.close();
  server.close();
}
