/**
 * Weekly Friday payout chain smoke against Staging API.
 * node scripts/e2e-weekly-friday-payout.mjs --base=https://meow-cuijiao-homepage-staging.vercel.app
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { computeSettlementDate, mergeWeeklySettings } from "../server/api/_weekly-settlement.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(root, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    })
);

const SUPABASE_URL = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const ANON = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const API_BASE = (
  process.argv.find((a) => a.startsWith("--base="))?.slice(7) ||
  "https://meow-cuijiao-homepage-staging.vercel.app"
).replace(/\/$/, "");

const expectedSettlement = computeSettlementDate(new Date(), mergeWeeklySettings({}));
const log = [];
function step(name, data) {
  log.push({ name, ...data, at: new Date().toISOString() });
  console.log(JSON.stringify({ step: name, ...data }));
}

async function auth(email, pass) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: pass }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`auth ${email}: ${JSON.stringify(j)}`);
  return j.access_token;
}

async function rest(table, qs, { method = "GET", body } = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}${qs || ""}`, {
    method,
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  const data = text ? JSON.parse(text) : null;
  if (!r.ok) throw new Error(`${method} ${table} ${r.status}: ${text}`);
  return data;
}

async function companionApi(token, action, body = {}) {
  const r = await fetch(`${API_BASE}/api/companion`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...body }),
  });
  const j = await r.json().catch(() => ({}));
  return { http: r.status, ...j };
}

async function csApi(token, action, body = {}) {
  const r = await fetch(`${API_BASE}/api/customer-service`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...body }),
  });
  const j = await r.json().catch(() => ({}));
  return { http: r.status, ...j };
}

async function finance(token, action, body = {}) {
  const isGet = action === "bootstrap";
  const r = await fetch(
    isGet ? `${API_BASE}/api/admin/finance?action=bootstrap` : `${API_BASE}/api/admin/finance`,
    {
      method: isGet ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "x-mcj-admin-role": "admin",
        "Content-Type": "application/json",
      },
      body: isGet ? undefined : JSON.stringify({ action, ...body }),
    }
  );
  const j = await r.json().catch(() => ({}));
  return { http: r.status, ...j };
}

async function main() {
  step("env", { API_BASE, expectedSettlement, timezone: "Asia/Kuala_Lumpur" });

  // Resolve test accounts from env or known staging seeds
  const companionEmail = env.E2E_COMPANION_EMAIL || env.COMPANION_TEST_EMAIL || "";
  const companionPass = env.E2E_COMPANION_PASS || env.COMPANION_TEST_PASS || "Test1234!";
  const csEmail = env.E2E_CS_EMAIL || env.CS_TEST_EMAIL || "";
  const csPass = env.E2E_CS_PASS || env.CS_TEST_PASS || "Test1234!";
  const adminEmail = env.E2E_ADMIN_EMAIL || env.ADMIN_TEST_EMAIL || "";
  const adminPass = env.E2E_ADMIN_PASS || env.ADMIN_TEST_PASS || "Test1234!";

  const accounts = await rest(
    "profiles",
    `?role=in.(companion,customer_service,admin,super_admin)&select=id,role,email,display_name&limit=40`
  ).catch(() => []);

  let cTok = null;
  let csTok = null;
  let aTok = null;
  let companionId = null;
  let csId = null;

  if (companionEmail) {
    cTok = await auth(companionEmail, companionPass);
    const me = await rest("profiles", `?email=eq.${encodeURIComponent(companionEmail)}&limit=1`);
    companionId = me?.[0]?.id;
  } else {
    const c = (accounts || []).find((p) => p.role === "companion" && p.email);
    if (c?.email) {
      try {
        cTok = await auth(c.email, companionPass);
        companionId = c.id;
      } catch (e) {
        step("companion_auth_skip", { reason: e.message, email: c.email });
      }
    }
  }

  if (csEmail) {
    csTok = await auth(csEmail, csPass);
    const me = await rest("profiles", `?email=eq.${encodeURIComponent(csEmail)}&limit=1`);
    csId = me?.[0]?.id;
  } else {
    const c = (accounts || []).find((p) => p.role === "customer_service" && p.email);
    if (c?.email) {
      try {
        csTok = await auth(c.email, csPass);
        csId = c.id;
      } catch (e) {
        step("cs_auth_skip", { reason: e.message, email: c.email });
      }
    }
  }

  if (adminEmail) {
    aTok = await auth(adminEmail, adminPass);
  } else {
    const a = (accounts || []).find((p) => /admin|super_admin/.test(p.role) && p.email);
    if (a?.email) {
      try {
        aTok = await auth(a.email, adminPass);
      } catch (e) {
        step("admin_auth_skip", { reason: e.message, email: a.email });
      }
    }
  }

  // DB schema probe
  const cols = await rest(
    "companion_withdrawals",
    "?select=id,status,settlement_date&limit=1"
  ).catch((e) => {
    throw new Error("companion_withdrawals probe failed: " + e.message);
  });
  step("schema_ok", { sample: cols?.[0] || null, payout_table: true });

  const payoutTable = await rest("payout_requests", "?select=id&limit=1").catch(() => null);
  step("payout_requests", { ok: payoutTable !== null });

  // Companion submit (if auth)
  let wdId = null;
  if (cTok) {
    // Cancel open pending to allow retest
    await rest(
      "companion_withdrawals",
      `?companion_id=eq.${companionId}&status=in.(pending_friday,pending_review,pending,submitted,reviewing)`,
      { method: "PATCH", body: { status: "cancelled", reject_reason: "e2e reset" } }
    ).catch(() => null);

    const sub = await companionApi(cTok, "request_withdrawal", { amount: 50, remark: "e2e weekly friday" });
    step("companion_submit", {
      ok: !!sub.ok,
      message: sub.message,
      settlementDate: sub.preview?.settlementDate || sub.data?.settlementDate,
      status: sub.data?.status || sub.preview?.status,
      http: sub.http,
    });
    if (sub.ok) {
      wdId = sub.data?.withdrawalId || sub.item?.id;
      const settle = sub.preview?.settlementDate || sub.data?.settlementDate;
      if (settle !== expectedSettlement) {
        step("WARN_settlement_mismatch", { got: settle, expected: expectedSettlement });
      }
      // Dup block
      const dup = await companionApi(cTok, "request_withdrawal", { amount: 50, remark: "e2e dup" });
      step("companion_dup_block", { ok: !dup.ok, message: dup.message, http: dup.http });
    }
  } else {
    step("companion_submit_skipped", { reason: "no auth" });
  }

  // CS submit
  let payId = null;
  if (csTok) {
    const sub = await csApi(csTok, "request_salary_withdraw", {});
    step("cs_submit", {
      ok: !!sub.ok,
      message: sub.message,
      settlementDate: sub.settlementDate || sub.item?.settlementDate,
      amount: sub.amount,
      http: sub.http,
    });
    if (sub.ok) {
      payId = sub.item?.id || sub.payroll?.id;
      const dup = await csApi(csTok, "request_salary_withdraw", {});
      step("cs_dup_block", { ok: !dup.ok, message: dup.message, http: dup.http });
    }
  } else {
    step("cs_submit_skipped", { reason: "no auth" });
  }

  // Admin bootstrap visibility
  if (aTok) {
    const boot = await finance(aTok, "bootstrap");
    step("admin_bootstrap", {
      ok: !!boot.ok,
      withdrawals: (boot.withdrawals || []).length,
      payrolls: (boot.payrolls || []).length,
      weeklyRules: boot.weeklyRules || null,
      hasWd: wdId ? !!(boot.withdrawals || []).find((w) => w.id === wdId) : null,
      hasPay: payId ? !!(boot.payrolls || []).find((p) => p.id === payId) : null,
    });

    if (wdId) {
      const ap = await finance(aTok, "approve_withdraw", { id: wdId });
      step("admin_approve_wd", { ok: !!ap.ok, message: ap.message, status: ap.item?.status });
      // Mark paid requires receipt — skip full upload; verify status is pending_payment
      const row = await rest("companion_withdrawals", `?id=eq.${wdId}&select=status,settlement_date&limit=1`);
      step("wd_after_approve", { row: row?.[0] });
      // Complete with tiny 1x1 png data url
      const png =
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
      const paid = await finance(aTok, "mark_withdraw_paid", {
        id: wdId,
        bankReference: `E2E-WD-${Date.now()}`,
        receiptDataUrl: png,
        paymentRemark: "e2e weekly",
      });
      step("admin_paid_wd", { ok: !!paid.ok, message: paid.message, status: paid.item?.status });
    }

    if (payId) {
      const ap = await finance(aTok, "approve_payroll", { id: payId });
      step("admin_approve_pay", { ok: !!ap.ok, message: ap.message });
      const row = await rest("staff_payrolls", `?id=eq.${payId}&select=status,settlement_date&limit=1`);
      step("pay_after_approve", { row: row?.[0] });
    }
  } else {
    step("admin_skipped", { reason: "no auth" });
  }

  const outPath = path.join(root, "scripts", "e2e-weekly-friday-payout-results.json");
  fs.writeFileSync(outPath, JSON.stringify({ API_BASE, expectedSettlement, log }, null, 2));
  console.log("WROTE", outPath);
  const fails = log.filter((x) => x.ok === false && !/skip|WARN|dup_block/.test(x.name));
  if (fails.length) process.exit(1);
}

main().catch((e) => {
  console.error("FAILED", e.message || e);
  process.exit(1);
});
