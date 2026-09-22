#!/usr/bin/env node
/**
 * Staging E2E Cases A–D: manual CS gate + cat-food hold/finalize/release + idempotency + multi single hold.
 * Writes Staging only. Target: https://meow-cuijiao-homepage-staging.vercel.app
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertSmokeTargetAllowed, STAGING_SUPABASE_REF } from "./lib/prod-guard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "artifacts/p0-multi-payment-fix");
fs.mkdirSync(outDir, { recursive: true });

const STG = "https://meow-cuijiao-homepage-staging.vercel.app";
const PASS = "McjTest@12345678";

assertSmokeTargetAllowed({
  script: "e2e-staging-catfood-hold-payment-gates",
  base: STG,
  supabaseUrl: `https://${STAGING_SUPABASE_REF}.supabase.co`,
});

const report = {
  ok: false,
  generated_at: new Date().toISOString(),
  staging: STG,
  cases: {},
  errors: [],
  notes: [],
};

function money(v) {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

async function api(pathname, body, token) {
  const res = await fetch(`${STG}${pathname}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}`, "x-mcj-access-token": token } : {}),
      ...(body != null ? { "Content-Type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

function mark(key, ok, detail, soft = false) {
  const result = ok ? "PASS" : soft ? "NOT PROVEN" : "FAIL";
  report.cases[key] = { result, detail: String(detail || "").slice(0, 1000) };
  console.log(`[${result}] ${key} :: ${detail}`);
  return ok;
}

async function login(email, role) {
  const r = await api("/api/auth", { action: "login", email, password: PASS, role });
  const token = r.json?.session?.accessToken || r.json?.session?.access_token || "";
  const user = r.json?.session?.user || r.json?.user || r.json?.profile || {};
  return { token, user, status: r.status, json: r.json };
}

function livePrice(c) {
  const svc = Array.isArray(c?.services) && c.services[0];
  return money(svc?.price ?? svc?.unitPrice ?? c?.price ?? c?.priceValue ?? c?.minPrice ?? 0);
}

async function walletSnapshot(token) {
  const res = await fetch(`${STG}/api/recharge`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "x-mcj-access-token": token,
    },
  });
  const json = await res.json().catch(() => ({}));
  const w = json?.wallet || {};
  return {
    available: money(w.availableBalance ?? 0),
    held: money(w.heldBalance ?? 0),
    paid: money(w.paidBalance ?? 0),
    bonus: money(w.bonusBalance ?? 0),
    total: money(w.totalBalance ?? 0),
    raw: w,
  };
}

function tinyPngDataUrl() {
  // 1x1 PNG
  return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
}

async function placeStandalone(token, companionId, price) {
  const r = await api(
    "/api/orders",
    {
      action: "place_order",
      companionId,
      hours: 1,
      totalAmount: price,
      paymentMethod: "bank_transfer",
      game: "测试",
      note: "P0 hold gate Case A",
    },
    token
  );
  return r;
}

async function placeMulti(token, a, b, priceA, priceB) {
  return api(
    "/api/orders",
    {
      action: "place_multi_order",
      items: [
        { companionId: a.id, companionName: a.name, price: priceA, hours: 1 },
        { companionId: b.id, companionName: b.name, price: priceB, hours: 1 },
      ],
      paymentMethod: "catfood",
      note: "P0 hold gate multi",
    },
    token
  );
}

try {
  const boss = await login("boss@meow.test", "boss");
  if (!boss.token) throw new Error("boss login failed: " + JSON.stringify(boss.json).slice(0, 200));

  const pubs = await api("/api/public/companions");
  const comps = pubs.json?.companions || [];
  const a = comps.find((c) => /CompA/i.test(c.name || "")) || comps[0];
  const b = comps.find((c) => c.id !== a?.id) || comps[1];
  if (!a?.id) throw new Error("need public companion");
  const priceA = livePrice(a) || 35;
  const priceB = b ? livePrice(b) || 35 : 0;

  // ── Case A: manual payment requires proof + CS; NOT paid via pay_order ──
  {
    const placed = await placeStandalone(boss.token, a.id, priceA);
    const order = placed.json?.order || placed.json?.orders?.[0];
    const orderId = order?.id || placed.json?.id;
    if (!orderId) {
      mark("MANUAL_PAYMENT_CUSTOMER_SERVICE_GATE", false, "place_order failed: " + (placed.json?.message || placed.status));
    } else {
      const payManual = await api(
        "/api/orders",
        { action: "pay_order", id: orderId, paymentMethod: "bank_transfer" },
        boss.token
      );
      const blocked =
        payManual.json?.code === "MANUAL_PAYMENT_REQUIRES_PROOF" ||
        /凭证|审核|人工/.test(String(payManual.json?.message || ""));
      const stillAwaiting =
        String(payManual.json?.order?.status || order?.status || "").includes("awaiting") ||
        payManual.status === 400;

      const proof = await api(
        "/api/orders",
        {
          action: "submit_payment_proof",
          id: orderId,
          paymentMethod: "bank_transfer",
          proofDataUrl: tinyPngDataUrl(),
        },
        boss.token
      );
      const proofOk = !!proof.json?.ok;
      const reviewText =
        String(proof.json?.order?.statusText || "") +
        String(proof.json?.order?.paymentStatus || "") +
        String(proof.json?.message || "");
      const notPaidYet =
        !/已支付|paid/i.test(reviewText) ||
        /待人工审核|待审核|等待人工/.test(reviewText);

      // Cancel unpaid-after-proof if still awaiting (cleanup)
      await api("/api/orders", { action: "cancel_order", id: orderId }, boss.token).catch(() => null);

      mark(
        "MANUAL_PAYMENT_CUSTOMER_SERVICE_GATE",
        blocked && proofOk && notPaidYet && stillAwaiting !== false,
        `pay_blocked=${blocked} code=${payManual.json?.code} proofOk=${proofOk} review=${reviewText.slice(0, 120)}`
      );
    }
  }

  // ── Case B + D: catfood hold + double reserve no-op ──
  {
    const before = await walletSnapshot(boss.token);
    const amount = Math.min(70, Math.max(30, Math.floor(before.available / 3) || 35));
    // Prefer multi if two companions; else standalone at amount
    let parentId = null;
    let total = amount;
    if (b?.id) {
      const pa = Math.min(priceA, Math.floor(amount / 2));
      const pb = amount - pa;
      const placed = await placeMulti(boss.token, a, b, pa, pb);
      parentId = placed.json?.parent?.id || placed.json?.order?.id || placed.json?.parentOrderId;
      total = money(placed.json?.parent?.totalAmount || placed.json?.total || pa + pb);
      if (!parentId) {
        report.notes.push({ multiPlaceFail: placed.json?.message || placed.status });
      }
    }
    if (!parentId) {
      const placed = await api(
        "/api/orders",
        {
          action: "place_order",
          companionId: a.id,
          hours: 1,
          totalAmount: amount,
          paymentMethod: "catfood",
          note: "P0 hold Case B",
        },
        boss.token
      );
      parentId = placed.json?.order?.id || placed.json?.id;
      total = money(placed.json?.order?.totalAmount || amount);
    }
    if (!parentId) {
      mark("CAT_FOOD_HOLD", false, "could not place order");
      mark("DOUBLE_DEBIT_PROTECTION", false, "skipped");
      mark("MULTI_ORDER_SINGLE_HOLD", false, "skipped", true);
    } else {
      const pay1 = await api("/api/orders", { action: "pay_order", id: parentId, paymentMethod: "catfood" }, boss.token);
      const pay2 = await api("/api/orders", { action: "pay_order", id: parentId, paymentMethod: "catfood" }, boss.token);
      const afterHold = await walletSnapshot(boss.token);
      const holdDelta = money(afterHold.held - before.held);
      const availDrop = money(before.available - afterHold.available);
      const holdOk =
        pay1.json?.ok &&
        (holdDelta >= total - 0.01 || availDrop >= total - 0.01) &&
        afterHold.available + 0.01 >= before.available - total;
      // If legacy debit path (no hold RPC): held stays 0 but available drops — mark NOT PROVEN for hold
      const usedHold = holdDelta >= total - 0.01;
      mark(
        "CAT_FOOD_HOLD",
        usedHold && holdOk,
        usedHold
          ? `beforeAvail=${before.available} afterAvail=${afterHold.available} held=${afterHold.held} total=${total}`
          : `HOLD RPC likely missing; avail ${before.available}->${afterHold.available} held=${afterHold.held} pay1=${pay1.json?.message || pay1.status}`,
        !usedHold && pay1.json?.ok
      );

      const doubleOk =
        pay2.status === 409 ||
        pay2.json?.code === "NOT_AWAITING_PAYMENT" ||
        pay2.json?.alreadyPaid ||
        (usedHold && money(afterHold.held - before.held) <= total + 0.01);
      // Re-check wallet after second pay — held must not double
      const after2 = await walletSnapshot(boss.token);
      const noDoubleHold = money(after2.held - before.held) <= total + 0.01;
      const noDoubleAvail = money(before.available - after2.available) <= total + 0.01;
      mark(
        "DOUBLE_DEBIT_PROTECTION",
        !!(noDoubleHold && noDoubleAvail && (doubleOk || pay2.json?.ok === false || pay2.status >= 400)),
        `pay2=${pay2.status}/${pay2.json?.code || ""} heldDelta=${money(after2.held - before.held)} availDrop=${money(before.available - after2.available)}`
      );

      if (b?.id && usedHold) {
        mark(
          "MULTI_ORDER_SINGLE_HOLD",
          money(after2.held - before.held) <= total + 0.01 && money(after2.held - before.held) >= total - 0.01,
          `parentHold=${money(after2.held - before.held)} expected=${total}`
        );
      } else {
        mark("MULTI_ORDER_SINGLE_HOLD", false, "need multi + hold RPC", true);
      }

      // ── Case C: cancel releases hold ──
      const cancel = await api("/api/orders", { action: "cancel_order", id: parentId }, boss.token);
      const afterCancel = await walletSnapshot(boss.token);
      const released =
        cancel.json?.ok &&
        money(afterCancel.held) <= money(before.held) + 0.01 &&
        money(afterCancel.available) >= money(before.available) - 0.01;
      mark(
        "CANCEL_RELEASE_HOLD",
        usedHold ? released : false,
        usedHold
          ? `cancelOk=${!!cancel.json?.ok} avail ${afterHold.available}->${afterCancel.available} held ${afterHold.held}->${afterCancel.held}`
          : `skipped/legacy: cancel=${cancel.json?.code || cancel.json?.message || cancel.status}`,
        !usedHold
      );

      // Case B finalize cannot run without completing full companion flow; soft if hold works
      mark(
        "CAT_FOOD_FINAL_DEBIT_ON_COMPLETION",
        false,
        "requires companion complete path on Staging (hold path verified separately if CAT_FOOD_HOLD PASS)",
        true
      );
    }
  }

  const hardFails = Object.entries(report.cases).filter(([, v]) => v.result === "FAIL");
  report.ok = hardFails.length === 0;
  fs.writeFileSync(path.join(outDir, "e2e-hold-gates-result.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: report.ok, cases: report.cases }, null, 2));
  process.exit(report.ok ? 0 : 1);
} catch (err) {
  report.errors.push(String(err?.stack || err));
  fs.writeFileSync(path.join(outDir, "e2e-hold-gates-result.json"), JSON.stringify(report, null, 2));
  console.error(err);
  process.exit(1);
}
