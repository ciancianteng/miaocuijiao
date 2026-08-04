/**
 * Friday settlement center E2E against fixed Staging.
 * Covers plan checks 1–10 + permission gates (best-effort without service_role).
 *
 * Usage:
 *   node scripts/e2e-weekly-friday-chain.mjs
 *   node scripts/e2e-weekly-friday-chain.mjs --base=https://meow-cuijiao-homepage-staging.vercel.app
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeSettlementDate, mergeWeeklySettings } from "../server/api/_weekly-settlement.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const OUT = path.join(root, "scripts/e2e-weekly-friday-chain-results.json");
const API_BASE = (
  process.argv.find((a) => a.startsWith("--base="))?.slice(7) ||
  "https://meow-cuijiao-homepage-staging.vercel.app"
).replace(/\/$/, "");

function loadEnvFile() {
  for (const name of [".env.local", ".env"]) {
    const p = path.join(root, name);
    if (!fs.existsSync(p)) continue;
    for (const raw of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#") || !line.includes("=")) continue;
      const i = line.indexOf("=");
      const k = line.slice(0, i).trim();
      const v = line.slice(i + 1).trim().replace(/^['"]|['"]$/g, "");
      if (k && v && !process.env[k]) process.env[k] = v;
    }
  }
}

loadEnvFile();

const PASS = process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const ACCOUNTS = {
  boss: process.env.E2E_BOSS_EMAIL || "boss@meow.test",
  companion: process.env.E2E_COMPANION_EMAIL || "companion@meow.test",
  cs: process.env.E2E_CS_EMAIL || "service@meow.test",
  admin: process.env.E2E_ADMIN_EMAIL || "admin@meow.test",
};

const results = {
  base: API_BASE,
  at: new Date().toISOString(),
  expectedSettlement: computeSettlementDate(new Date(), mergeWeeklySettings({})),
  checks: [],
};
function check(id, name, pass, detail = "") {
  const row = { id, name, pass: !!pass, detail: String(detail || "").slice(0, 500) };
  results.checks.push(row);
  console.log(`${pass ? "PASS" : "FAIL"} [${id}] ${name}${detail ? " — " + detail : ""}`);
  return !!pass;
}

async function fetchJson(url, opts = {}) {
  const r = await fetch(url, opts);
  const text = await r.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  return { http: r.status, ...body };
}

async function resolveSupabase() {
  if (process.env.SUPABASE_URL && (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY)) {
    return {
      url: String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL).replace(/\/$/, ""),
      anon: process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY,
    };
  }
  const cfg = await fetchJson(`${API_BASE}/api/public/realtime-config`);
  if (!cfg.ok || !cfg.url || !cfg.anonKey) throw new Error("cannot resolve supabase config from staging");
  return { url: String(cfg.url).replace(/\/$/, ""), anon: cfg.anonKey };
}

async function auth(supabase, email) {
  const r = await fetch(`${supabase.url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: supabase.anon, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASS }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`auth ${email}: ${j.msg || j.error_code || JSON.stringify(j)}`);
  return j.access_token;
}

async function api(token, route, action, body = {}, { method = "POST", role } = {}) {
  const isGet = method === "GET";
  const url = isGet
    ? `${API_BASE}${route}${route.includes("?") ? "&" : "?"}action=${encodeURIComponent(action)}`
    : `${API_BASE}${route}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (role) headers["x-mcj-admin-role"] = role;
  return fetchJson(url, {
    method,
    headers,
    body: isGet ? undefined : JSON.stringify({ action, ...body }),
  });
}

async function tinyPngDataUrl() {
  // 1x1 PNG
  return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
}

async function main() {
  const supabase = await resolveSupabase();
  check("env", "Staging + Supabase config resolved", true, API_BASE);

  const tokens = {};
  for (const [role, email] of Object.entries(ACCOUNTS)) {
    try {
      tokens[role] = await auth(supabase, email);
      check(`auth_${role}`, `Login ${role}`, true, email);
    } catch (e) {
      check(`auth_${role}`, `Login ${role}`, false, e.message);
    }
  }

  // 1) Admin finance bootstrap — Friday center present
  const boot = tokens.admin
    ? await api(tokens.admin, "/api/admin/finance", "bootstrap", {}, { method: "GET", role: "super_admin" })
    : { ok: false, message: "no admin token" };
  check(
    "1_admin_friday_center",
    "Admin bootstrap exposes Friday settlement summary + tabs data",
    boot.ok === true && !!boot.settlementSummary,
    JSON.stringify(boot.settlementSummary || boot.message || {})
  );
  check(
    "1b_batch_panel",
    "Current settlement batch panel available (MCJ-PAYOUT…)",
    !!(boot.currentBatch?.batchCode || boot.settlementSummary?.batchCode || boot.settlementSummary?.thisFriday),
    boot.currentBatch?.batchCode || boot.settlementSummary?.thisFriday || boot.message || ""
  );

  // 2) Permission: boss cannot call admin finance
  if (tokens.boss) {
    const denied = await api(tokens.boss, "/api/admin/finance", "bootstrap", {}, { method: "GET", role: "boss" });
    check(
      "2_boss_finance_denied",
      "Boss cannot access admin finance API",
      denied.ok === false || denied.http === 401 || denied.http === 403,
      `http=${denied.http} msg=${denied.message || ""}`
    );
  }

  // 3) Companion / CS cannot access admin finance
  if (tokens.companion) {
    const denied = await api(tokens.companion, "/api/admin/finance", "bootstrap", {}, { method: "GET" });
    check(
      "3_companion_finance_denied",
      "Companion cannot access admin finance API",
      denied.ok === false || denied.http === 401 || denied.http === 403,
      `http=${denied.http}`
    );
  }
  if (tokens.cs) {
    const denied = await api(tokens.cs, "/api/admin/finance", "bootstrap", {}, { method: "GET" });
    check(
      "4_cs_finance_denied",
      "CS cannot access admin finance API",
      denied.ok === false || denied.http === 401 || denied.http === 403,
      `http=${denied.http}`
    );
  }

  // 5) Boss list refunds / orders show Friday copy path
  if (tokens.boss) {
    const refunds = await api(tokens.boss, "/api/orders", "list_my_refunds", {});
    check(
      "5_boss_list_refunds",
      "Boss list_my_refunds works",
      refunds.ok === true && Array.isArray(refunds.refunds),
      `count=${(refunds.refunds || []).length}`
    );
    const orders = await fetchJson(`${API_BASE}/api/orders`, {
      headers: { Authorization: `Bearer ${tokens.boss}`, Accept: "application/json" },
    });
    check("5b_boss_orders", "Boss can list orders", orders.ok === true, `count=${(orders.orders || []).length}`);

    // Try request refund on an eligible order if present
    const eligible = (orders.orders || []).find((o) =>
      /confirmed|in_progress|completed/i.test(String(o.status || o.dbStatus || ""))
    );
    if (eligible) {
      const beforeWallet = await fetchJson(`${API_BASE}/api/wallet?action=balance`, {
        headers: { Authorization: `Bearer ${tokens.boss}` },
      }).catch(() => ({}));
      const req = await api(tokens.boss, "/api/orders", "request_refund", {
        id: eligible.id,
        reason: "E2E friday settlement refund",
      });
      check(
        "6_boss_request_refund",
        "Boss request_refund enqueues Friday path (no crash)",
        req.ok === true,
        req.message || ""
      );
      const afterWallet = await fetchJson(`${API_BASE}/api/wallet?action=balance`, {
        headers: { Authorization: `Bearer ${tokens.boss}` },
      }).catch(() => ({}));
      const beforeBal = Number(beforeWallet?.balance ?? beforeWallet?.paidBalance ?? beforeWallet?.data?.paid ?? NaN);
      const afterBal = Number(afterWallet?.balance ?? afterWallet?.paidBalance ?? afterWallet?.data?.paid ?? NaN);
      check(
        "6b_no_instant_wallet",
        "Approve-path not instant here: wallet not credited solely by request",
        !Number.isFinite(beforeBal) || !Number.isFinite(afterBal) || afterBal <= beforeBal + 0.001,
        `before=${beforeBal} after=${afterBal}`
      );

      if (tokens.cs && req.ok) {
        const decision = await api(tokens.cs, "/api/customer-service", "refund_decision", {
          id: eligible.id,
          decision: "approve",
          note: "E2E approve into Friday queue (no instant credit)",
        });
        check(
          "7_cs_approve_friday_queue",
          "CS approve enters Friday queue (message mentions Friday / 不会即时)",
          decision.ok === true && /周五|即时|队列/i.test(String(decision.message || "")),
          decision.message || ""
        );

        const boot2 = await api(tokens.admin, "/api/admin/finance", "bootstrap", {}, { method: "GET", role: "super_admin" });
        const refundRow = (boot2.bossRefunds || []).find(
          (r) => String(r.orderId) === String(eligible.id) || String(r.orderNo) === String(eligible.orderNo || "")
        );
        check(
          "7b_admin_sees_refund",
          "Admin Friday center lists boss refund",
          !!refundRow,
          refundRow ? `${refundRow.refundNo} ${refundRow.status}` : "missing"
        );

        if (refundRow && /approved_for_payout|included_in_batch|carried_forward|failed|pending_review/i.test(refundRow.status)) {
          if (/approved_for_payout|carried_forward|failed/i.test(refundRow.status)) {
            const batch = await api(tokens.admin, "/api/admin/finance", "add_refund_to_batch", { id: refundRow.id }, { role: "super_admin" });
            check("8_add_refund_batch", "Admin can add refund to weekly batch", batch.ok === true, batch.message || "");
          } else {
            check("8_add_refund_batch", "Admin can add refund to weekly batch", true, "already in batch/status=" + refundRow.status);
          }

          // mark paid without receipt must fail
          const noReceipt = await api(
            tokens.admin,
            "/api/admin/finance",
            "mark_refund_paid",
            { id: refundRow.id, bankReference: "E2E-REF-NO-FILE" },
            { role: "super_admin" }
          );
          check(
            "9_no_receipt_blocked",
            "Mark refund paid without receipt is blocked",
            noReceipt.ok === false,
            noReceipt.message || ""
          );

          const paid = await api(
            tokens.admin,
            "/api/admin/finance",
            "mark_refund_paid",
            {
              id: refundRow.id,
              bankReference: `E2E-REF-${Date.now()}`,
              paidAmount: refundRow.amountRm,
              receiptDataUrl: await tinyPngDataUrl(),
            },
            { role: "super_admin" }
          );
          check("9b_mark_refund_paid", "Mark refund paid with receipt succeeds (or idempotent)", paid.ok === true, paid.message || "");

          const paidAgain = await api(
            tokens.admin,
            "/api/admin/finance",
            "mark_refund_paid",
            {
              id: refundRow.id,
              bankReference: `E2E-REF-DUP-${Date.now()}`,
              paidAmount: refundRow.amountRm,
              receiptDataUrl: await tinyPngDataUrl(),
            },
            { role: "super_admin" }
          );
          check(
            "9c_mark_refund_idempotent",
            "Repeat mark_refund_paid is idempotent / safe",
            paidAgain.ok === true || /已打款|幂等|duplicate/i.test(String(paidAgain.message || "")),
            paidAgain.message || ""
          );
        }
      }
    } else {
      check("6_boss_request_refund", "Boss request_refund enqueues Friday path", false, "no eligible order on staging for boss");
      check("6b_no_instant_wallet", "No instant wallet on request", true, "skipped — no eligible order");
      check("7_cs_approve_friday_queue", "CS approve Friday queue", false, "skipped — no eligible order");
      check("7b_admin_sees_refund", "Admin sees refund", false, "skipped");
      check("8_add_refund_batch", "Add refund to batch", false, "skipped");
      check("9_no_receipt_blocked", "No-receipt blocked", false, "skipped");
      check("9b_mark_refund_paid", "Mark refund paid", false, "skipped");
      check("9c_mark_refund_idempotent", "Idempotent mark paid", false, "skipped");
    }
  }

  // 10) Export settlement CSV
  if (tokens.admin) {
    const now = new Date();
    const exp = await api(
      tokens.admin,
      "/api/admin/finance",
      "export_settlement",
      { year: String(now.getFullYear()), month: String(now.getMonth() + 1).padStart(2, "0"), type: "all" },
      { role: "super_admin" }
    );
    check(
      "10_export_csv",
      "Export settlement CSV available",
      exp.ok === true && typeof exp.csv === "string" && /MeowCuiJiao_Settlement|fileBase/.test(JSON.stringify(exp)),
      `file=${exp.fileBase || ""} count=${exp.count || 0}`
    );
  }

  // Companion withdraw / CS payroll smoke (pending_friday messaging)
  if (tokens.companion) {
    const bootC = await api(tokens.companion, "/api/companion", "bootstrap", {});
    check(
      "comp_bootstrap",
      "Companion bootstrap works",
      bootC.ok === true,
      bootC.message || ""
    );
  }
  if (tokens.cs) {
    const bootCs = await api(tokens.cs, "/api/customer-service", "bootstrap", {});
    check("cs_bootstrap", "CS bootstrap works", bootCs.ok === true, bootCs.message || "");
  }

  const passed = results.checks.filter((c) => c.pass).length;
  const failed = results.checks.filter((c) => !c.pass).length;
  results.summary = { passed, failed, total: results.checks.length };
  fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
  console.log(`\nSUMMARY passed=${passed} failed=${failed} → ${OUT}`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  results.fatal = e.message || String(e);
  fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
  process.exit(1);
});
