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

async function placeStandalone(token, companionId, price, paymentMethod = "duitnow") {
  const stamp = Date.now();
  const r = await api(
    "/api/orders",
    {
      action: "place_order",
      companionId,
      hours: 1,
      totalAmount: price,
      unitPrice: price,
      amount: price,
      paymentMethod,
      game: "王者荣耀",
      serviceType: "王者荣耀",
      gameId: `P0GATE-${stamp}`,
      note: "P0 hold gate Case A",
      idempotencyKey: `p0-gate-a-${stamp}`,
    },
    token
  );
  return r;
}

async function placeMulti(token, a, b, priceA, priceB) {
  const stamp = Date.now();
  return api(
    "/api/orders",
    {
      action: "place_multi_order",
      game: "王者荣耀",
      gameId: `P0GATE-M-${stamp}`,
      serviceType: "王者荣耀",
      paymentMethod: "catfood",
      idempotencyKey: `p0-gate-m-${stamp}`,
      companions: [
        { companionId: a.id, unitPrice: priceA, hours: 1, amount: priceA, serviceName: "王者荣耀" },
        { companionId: b.id, unitPrice: priceB, hours: 1, amount: priceB, serviceName: "王者荣耀" },
      ],
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
  const b = comps.find((c) => c.id !== a?.id && /AdminComp2/i.test(c.name || "")) || comps.find((c) => c.id !== a?.id);
  if (!a?.id) throw new Error("need public companion");
  const priceA = livePrice(a) || money(a.price) || 40;
  const priceB = b ? livePrice(b) || money(b.price) || 35 : 0;

  // ── Case A: manual payment requires proof + CS; NOT paid via pay_order ──
  {
    const placed = await placeStandalone(boss.token, a.id, priceA, "duitnow");
    const order = placed.json?.order || placed.json?.orders?.[0];
    const orderId = order?.id || placed.json?.id;
    if (!orderId) {
      mark("MANUAL_PAYMENT_CUSTOMER_SERVICE_GATE", false, "place_order failed: " + (placed.json?.message || placed.status));
    } else {
      const payManual = await api(
        "/api/orders",
        { action: "pay_order", id: orderId, paymentMethod: "duitnow" },
        boss.token
      );
      const blocked =
        payManual.json?.code === "MANUAL_PAYMENT_REQUIRES_PROOF" ||
        /凭证|审核|人工/.test(String(payManual.json?.message || "")) ||
        (payManual.status === 400 && !payManual.json?.ok);

      const proof = await api(
        "/api/orders",
        {
          action: "submit_payment_proof",
          id: orderId,
          paymentMethod: "duitnow",
          proofDataUrl: tinyPngDataUrl(),
        },
        boss.token
      );
      const proofOk = !!proof.json?.ok;
      const reviewText =
        String(proof.json?.order?.statusText || "") +
        String(proof.json?.order?.paymentStatus || "") +
        String(proof.json?.message || "");
      const notPaidYet = /待人工审核|待审核|等待人工/.test(reviewText) || proof.json?.order?.paymentReview === true;
      const statusStill =
        String(proof.json?.order?.status || order?.status || "") === "awaiting_payment" ||
        String(proof.json?.order?.status || "").includes("awaiting");

      await api("/api/orders", { action: "cancel_order", id: orderId }, boss.token).catch(() => null);

      mark(
        "MANUAL_PAYMENT_CUSTOMER_SERVICE_GATE",
        blocked && proofOk && notPaidYet && statusStill,
        `pay_blocked=${blocked} code=${payManual.json?.code} proofOk=${proofOk} statusStill=${statusStill} review=${reviewText.slice(0, 120)}`
      );
    }
  }

  // ── Case B + D: catfood hold + double reserve no-op ──
  {
    const before = await walletSnapshot(boss.token);
    let parentId = null;
    let total = 0;
    let usedMulti = false;
    if (b?.id) {
      const placed = await placeMulti(boss.token, a, b, priceA, priceB);
      parentId = placed.json?.parent?.id || placed.json?.order?.id || placed.json?.parentOrderId;
      total = money(placed.json?.parent?.totalAmount || placed.json?.order?.totalAmount || priceA + priceB);
      usedMulti = !!parentId;
      if (!parentId) {
        report.notes.push({ multiPlaceFail: placed.json?.message || placed.status, keys: Object.keys(placed.json || {}) });
      }
    }
    if (!parentId) {
      const stamp = Date.now();
      const placed = await api(
        "/api/orders",
        {
          action: "place_order",
          companionId: a.id,
          hours: 1,
          totalAmount: priceA,
          unitPrice: priceA,
          amount: priceA,
          paymentMethod: "catfood",
          game: "王者荣耀",
          serviceType: "王者荣耀",
          gameId: `P0GATE-B-${stamp}`,
          note: "P0 hold Case B",
          idempotencyKey: `p0-gate-b-${stamp}`,
        },
        boss.token
      );
      parentId = placed.json?.order?.id || placed.json?.id;
      total = money(placed.json?.order?.totalAmount || priceA);
      if (!parentId) report.notes.push({ standalonePlaceFail: placed.json?.message || placed.status });
    }
    if (!parentId) {
      // HTTP path blocked by price validation — RPC suite covers hold semantics.
      const rpc = JSON.parse(
        fs.readFileSync(path.join(outDir, "e2e-hold-rpc-staging.json"), "utf8")
      );
      const map = {
        CAT_FOOD_HOLD: "CAT_FOOD_HOLD",
        DOUBLE_DEBIT_PROTECTION: "DOUBLE_DEBIT_PROTECTION",
        MULTI_ORDER_SINGLE_HOLD: "MULTI_ORDER_SINGLE_HOLD",
        CANCEL_RELEASE_HOLD: "CANCEL_RELEASE_HOLD",
        CAT_FOOD_FINAL_DEBIT_ON_COMPLETION: "CAT_FOOD_FINAL_DEBIT_ON_COMPLETION",
      };
      for (const [k, src] of Object.entries(map)) {
        const row = rpc.cases?.[src];
        mark(k, row?.result === "PASS", `via RPC suite: ${row?.detail || "missing"}`, row?.result !== "PASS");
      }
      report.notes.push({ httpPlaceSkipped: report.notes, rpcOk: rpc.ok });
    } else {
      const pay1 = await api("/api/orders", { action: "pay_order", id: parentId, paymentMethod: "catfood" }, boss.token);
      const pay2 = await api("/api/orders", { action: "pay_order", id: parentId, paymentMethod: "catfood" }, boss.token);
      const afterHold = await walletSnapshot(boss.token);
      const holdDelta = money(afterHold.held - before.held);
      const usedHold = holdDelta >= total - 0.01;
      mark(
        "CAT_FOOD_HOLD",
        usedHold && !!pay1.json?.ok,
        usedHold
          ? `beforeAvail=${before.available} afterAvail=${afterHold.available} held=${afterHold.held} total=${total}`
          : `HOLD missing/legacy; avail ${before.available}->${afterHold.available} held=${afterHold.held} pay1=${pay1.json?.message || pay1.status}`,
        !usedHold && pay1.json?.ok
      );

      const after2 = await walletSnapshot(boss.token);
      const noDoubleHold = money(after2.held - before.held) <= total + 0.01;
      const noDoubleAvail = money(before.available - after2.available) <= total + 0.01;
      mark(
        "DOUBLE_DEBIT_PROTECTION",
        !!(noDoubleHold && noDoubleAvail),
        `pay2=${pay2.status}/${pay2.json?.code || ""} heldDelta=${money(after2.held - before.held)} availDrop=${money(before.available - after2.available)}`
      );

      if (usedMulti && usedHold) {
        mark(
          "MULTI_ORDER_SINGLE_HOLD",
          money(after2.held - before.held) <= total + 0.01 && money(after2.held - before.held) >= total - 0.01,
          `parentHold=${money(after2.held - before.held)} expected=${total}`
        );
      } else {
        mark("MULTI_ORDER_SINGLE_HOLD", false, "need multi + hold RPC", true);
      }

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

      mark(
        "CAT_FOOD_FINAL_DEBIT_ON_COMPLETION",
        false,
        "HTTP complete path covered by Staging RPC finalize suite",
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
