#!/usr/bin/env node
/** Offline regression checks for the 9 / 15–35 service batch (no network, no DB). */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");
const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log("PASS", name);
  } catch (e) {
    results.push({ name, ok: false });
    console.error("FAIL", name, "-", e.message || e);
  }
}

function loadBrowserScript(rel, extra = {}) {
  const store = new Map();
  const ctx = {
    window: {},
    Intl,
    Date,
    JSON,
    Promise,
    setTimeout: () => 0,
    setInterval: () => 0,
    sessionStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
    fetch: () => Promise.resolve({ json: () => Promise.resolve({ settings: {} }) }),
    document: {
      readyState: "loading",
      addEventListener() {},
      querySelector: () => null,
      querySelectorAll: () => [],
      head: { appendChild() {} },
      body: {},
      createElement: () => ({ setAttribute() {} }),
    },
    ...extra,
  };
  vm.runInNewContext(read(rel), ctx);
  return ctx.window;
}

// ---------- #20 CS online hours ----------
await test("#20 badge: 10:00 MYT is online, 13:00 MYT is offline (device timezone ignored)", () => {
  const w = loadBrowserScript("src/cs-online-hours.js");
  const api = w.MCJCsOnlineHours;
  assert.equal(api.isOnline(new Date("2026-10-05T02:00:00Z")), true);
  assert.equal(api.isOnline(new Date("2026-10-05T00:59:00Z")), false);
  assert.equal(api.isOnline(new Date("2026-10-05T04:00:00Z")), false);
  assert.equal(api.isOnline(new Date("2026-10-05T05:00:00Z")), false);
});
await test("#20 badge copy matches spec", () => {
  const src = read("src/cs-online-hours.js");
  assert.match(src, /客服在线时间：/);
  assert.match(src, /当前非客服在线时段，可先提交需求，我们会在客服时间处理。/);
  assert.match(src, /非客服在线时段/);
  const w = loadBrowserScript("src/cs-online-hours.js");
  assert.match(w.MCJCsOnlineHours.html("full"), /早上 9:00 – 12:00/);
});
await test("#20 public settings expose hours but never csCommission / SMTP / AI internals", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "x";
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    text: async () =>
      JSON.stringify([{ data: { csCommission: { baseSalary: 1800 }, smtpHost: "smtp.x", aiSystemPrompt: "p", csOnlineHoursStart: "10:00" } }]),
  });
  try {
    const { default: handler } = await import("../server/api/platform/settings.js");
    let out;
    await handler({ method: "GET" }, { setHeader() {}, status: () => ({ json: (d) => (out = d) }) });
    assert.equal(out.settings.csCommission, undefined);
    assert.equal(out.settings.smtpHost, undefined);
    assert.equal(out.settings.aiSystemPrompt, undefined);
    assert.equal(out.settings.csOnlineHoursStart, "10:00");
    assert.equal(out.settings.csOnlineHoursEnd, "12:00");
  } finally {
    globalThis.fetch = realFetch;
  }
});
await test("#20 admin platform settings save keeps keys owned by other modules (csCommission)", () => {
  const src = read("server/api/admin/platform-settings.js");
  assert.match(src, /data: \{ \.\.\.prevData, \.\.\.settings \}/);
  assert.match(src, /csOnlineHoursStart: hhmmOr\(/);
});
await test("#20 support page + boss header render the badge slots", () => {
  assert.match(read("src/support-chat.js"), /data-cs-online-badge="full"/);
  assert.match(read("src/boss-header.js"), /data-cs-online-badge="compact"/);
});

// ---------- #17 chat composers ----------
await test("#17 companion composer: IME-safe Enter, autosize, keyboard inset, 16px on phones", () => {
  const js = read("src/companion-workbench.js");
  assert.match(js, /if\(e\.isComposing\|\|e\.keyCode===229\)return;/);
  assert.match(js, /function autoSizeChatInput\(ta\)/);
  assert.match(js, /classList\.toggle\('pw-kb-open', inset>80\)/);
  const css = read("src/companion-workbench.css");
  assert.match(css, /padding:10px 12px calc\(10px \+ var\(--pw-keyboard-inset,0px\)\)/);
  assert.match(css, /@media \(max-width:820px\)\{\s*\.pw-composer textarea\{font-size:16px\}/);
  assert.match(css, /html\.pw-kb-open \.pw-bottom-nav\{display:none\}/);
});
await test("#17 CS + boss composers share 44px base / 120px cap / 16px mobile font", () => {
  const cs = read("src/customer-service-v2.css");
  assert.match(cs, /\.cs-chat-input textarea\{height:44px;min-height:44px;border-radius:14px/);
  const base15 = cs.lastIndexOf(".cs-chat-input textarea{height:44px");
  const mobile16 = cs.lastIndexOf("@media (max-width:1050px){.cs-chat-input textarea{font-size:16px}}");
  assert.ok(base15 > 0 && mobile16 > base15, "16px mobile rule must come after the 15px base rule");
  assert.match(read("src/customer-service-v2.js"), /Math\.min\(120,Math\.max\(44,el\.scrollHeight\)\)/);
  assert.match(read("src/support-chat.js"), /isComposing/);
});

// ---------- fake PostgREST for money / notification flows ----------
function fakeRest(handlers) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const u = String(url);
    const method = String(init.method || "GET").toUpperCase();
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url: u, method, body });
    let out = [];
    for (const [re, h] of handlers) {
      if (re.test(u) && (!h.method || h.method === method)) {
        out = await h.run({ url: u, method, body });
        break;
      }
    }
    if (out && out.__error) {
      const err = out.__error;
      return { ok: false, status: err.status || 400, text: async () => JSON.stringify(err), headers: { get: () => null } };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify(out ?? null), headers: { get: () => null } };
  };
  fn.calls = calls;
  return fn;
}
async function withFetch(fake, run) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = fake;
  try {
    return await run();
  } finally {
    globalThis.fetch = realFetch;
  }
}
function rechargeDb(row) {
  const db = { row, credits: 0, flipToPaidBeforePatch: false };
  db.fetch = fakeRest([
    [/\/rpc\/mcj_wallet_credit_recharge/, {
      method: "POST",
      run: () => {
        if (db.row.status === "paid") return { ok: true, duplicate: true };
        db.row.status = "paid";
        db.credits += 1;
        return { ok: true, duplicate: false };
      },
    }],
    [/\/payment_orders\?(or=|payment_no=eq)/, { method: "GET", run: () => [{ ...db.row }] }],
    [/\/payment_orders\?status=/, { method: "GET", run: () => [{ ...db.row }] }],
    [/\/payment_orders\?id=eq/, {
      method: "PATCH",
      run: ({ url, body }) => {
        if (db.flipToPaidBeforePatch) db.row.status = "paid";
        const m = url.match(/status=in\.\(([^)]*)\)/);
        if (m && !m[1].split(",").includes(db.row.status)) return [];
        Object.assign(db.row, body);
        return [{ ...db.row }];
      },
    }],
  ]);
  return db;
}
const REVIEWER = { id: "11111111-1111-4111-8111-111111111111", display_name: "小美" };
const pendingRow = () => ({
  id: "22222222-2222-4222-8222-222222222222",
  payment_no: "PAY-T1",
  boss_id: "33333333-3333-4333-8333-333333333333",
  amount: 50,
  cat_food_amount: 500,
  status: "pending_review",
  proof_path: "boss/x/proof.png",
  proof_bucket: "companion-payment-proofs",
  raw_response: {},
});

// ---------- #15 CS recharge review ----------
await test("#15 approve credits exactly once; second approve (CS or admin) is a no-op duplicate", async () => {
  const { approveRecharge } = await import("../server/api/_recharge-review.js");
  const db = rechargeDb(pendingRow());
  await withFetch(db.fetch, async () => {
    const a = await approveRecharge({ paymentNo: "PAY-T1", reviewer: REVIEWER, operatorRole: "customer_service", requireProof: true });
    assert.equal(a.status, 200);
    assert.equal(a.body.duplicate, false);
    assert.equal(a.body.reviewedByStaffName, "小美");
    const b = await approveRecharge({ paymentNo: "PAY-T1", reviewer: { id: "other", display_name: "管理员甲" } });
    assert.equal(b.status, 200);
    assert.equal(b.body.duplicate, true);
  });
  assert.equal(db.credits, 1);
  const rpc = db.fetch.calls.filter((c) => /mcj_wallet_credit_recharge/.test(c.url));
  assert.equal(rpc.length, 1);
  assert.equal(rpc[0].body.p_idempotency_key, "admin-confirm:PAY-T1");
  assert.ok(db.fetch.calls.some((c) => /payment_review_history/.test(c.url) && c.body?.reviewed_by_staff_name === "小美"));
});
await test("#15 approve blocked without proof / after reject; reject never credits", async () => {
  const { approveRecharge, rejectRecharge } = await import("../server/api/_recharge-review.js");
  const noProof = rechargeDb({ ...pendingRow(), proof_path: "" });
  await withFetch(noProof.fetch, async () => {
    const r = await approveRecharge({ paymentNo: "PAY-T1", reviewer: REVIEWER, requireProof: true });
    assert.equal(r.status, 400);
  });
  assert.equal(noProof.credits, 0);
  const db = rechargeDb(pendingRow());
  await withFetch(db.fetch, async () => {
    assert.equal((await rejectRecharge({ paymentNo: "PAY-T1", reviewer: REVIEWER, reason: "" })).status, 400);
    const rej = await rejectRecharge({ paymentNo: "PAY-T1", reviewer: REVIEWER, reason: "金额不符" });
    assert.equal(rej.status, 200);
    assert.equal(db.row.status, "rejected");
    const after = await approveRecharge({ paymentNo: "PAY-T1", reviewer: REVIEWER });
    assert.equal(after.status, 409);
  });
  assert.equal(db.credits, 0);
  assert.ok(db.fetch.calls.some((c) => /boss_notifications/.test(c.url) && /金额不符/.test(c.body?.body || "")));
});
await test("#15 reject cannot overwrite a row that became paid concurrently", async () => {
  const { rejectRecharge } = await import("../server/api/_recharge-review.js");
  const db = rechargeDb(pendingRow());
  db.flipToPaidBeforePatch = true;
  await withFetch(db.fetch, async () => {
    const r = await rejectRecharge({ paymentNo: "PAY-T1", reviewer: REVIEWER, reason: "x" });
    assert.equal(r.status, 409);
  });
  assert.equal(db.row.status, "paid");
});
await test("#15 CS list never exposes storage proofPath; admin list keeps it", async () => {
  const { listRecharges } = await import("../server/api/_recharge-review.js");
  const db = rechargeDb(pendingRow());
  await withFetch(db.fetch, async () => {
    const cs = await listRecharges({ status: "pending_review" });
    assert.equal(cs.length, 1);
    assert.equal("proofPath" in cs[0], false);
    assert.equal(cs[0].hasProof, true);
    const admin = await listRecharges({ status: "pending_review", includeProofPath: true });
    assert.equal(admin[0].proofPath, "boss/x/proof.png");
  });
});
await test("#15 CS routes/actions + admin wallet delegate to the shared module", () => {
  const cs = read("server/api/customer-service.js");
  for (const a of ["list_recharges", "approve_recharge", "reject_recharge", "review_badges", "mark_staff_notifications_read"]) {
    assert.match(cs, new RegExp(`action === "${a}"`));
  }
  assert.match(cs, /operatorRole: "customer_service",\s*requireProof: true/);
  const admin = read("server/api/admin/wallet.js");
  assert.match(admin, /approveRecharge\(/);
  assert.match(admin, /rejectRecharge\(/);
  assert.match(admin, /includeProofPath: true/);
  const ui = read("src/customer-service-v2.js");
  assert.match(ui, /\['recharges','充值审核','\/customer-service\/recharges'\]/);
  assert.match(ui, /'\/customer-service\/recharges':'recharges'/);
  assert.match(ui, /data-recharge-approve/);
  assert.match(ui, /if\(rechargesState\.busyId\)return;/);
});

// ---------- #16 staff notification on proof upload ----------
await test("#16 notify: one unread row per staff per record; falls back when optional columns are missing", async () => {
  const { notifyCustomerServiceStaff } = await import("../server/api/_staff-notify.js");
  const inserts = [];
  let extendedTried = 0;
  const fake = fakeRest([
    [/\/profiles\?role=eq\.customer_service/, { method: "GET", run: () => [{ id: "cs-a" }, { id: "cs-b" }] }],
    [/\/staff_notifications\?staff_id=eq\.cs-a/, { method: "GET", run: () => [{ id: "n1" }] }],
    [/\/staff_notifications\?staff_id=eq\.cs-b/, { method: "GET", run: () => [] }],
    [/\/staff_notifications$/, {
      method: "POST",
      run: ({ body }) => {
        if ("notice_key" in body) {
          extendedTried += 1;
          return { __error: { status: 400, code: "PGRST204", message: "Could not find the 'notice_key' column of 'staff_notifications' in the schema cache" } };
        }
        inserts.push(body);
        return null;
      },
    }],
  ]);
  const out = await withFetch(fake, () =>
    notifyCustomerServiceStaff({ kind: "recharge_proof", relatedId: "PAY-T1", title: "新的充值凭证待审核", href: "/customer-service/recharges" })
  );
  assert.deepEqual(out, { inserted: 1, skipped: 1 });
  assert.equal(extendedTried, 1);
  assert.equal(inserts.length, 1);
  assert.deepEqual(Object.keys(inserts[0]).sort(), ["body", "kind", "related_id", "staff_id", "title"]);
  assert.equal(inserts[0].staff_id, "cs-b");
});
await test("#16 recharge + gift proof uploads notify CS; review notices stay out of 工资通知", () => {
  assert.match(read("server/api/recharge.js"), /kind: "recharge_proof"/);
  assert.match(read("server/api/_gift-orders.js"), /kind: "gift_proof"/);
  const ui = read("src/customer-service-v2.js");
  assert.match(ui, /n\.kind!=='recharge_proof'&&n\.kind!=='gift_proof'/);
  assert.match(ui, /showReviewNotice\('新的充值凭证待审核/);
});

// ---------- #29 gift review badge ----------
await test("#29 badge counts only reviewable gift orders (payment_submitted / under_review)", async () => {
  const { countPendingGiftOrderReviews } = await import("../server/api/_gift-orders.js");
  let q = "";
  const fake = fakeRest([[/\/gift_orders\?/, { method: "GET", run: ({ url }) => ((q = url), [{ id: 1 }, { id: 2 }]) }]]);
  const n = await withFetch(fake, () => countPendingGiftOrderReviews());
  assert.equal(n, 2);
  assert.match(decodeURIComponent(q), /status=in\.\(payment_submitted,under_review\)/);
});
await test("#29 nav badge hidden at 0, shows count, refreshes after approve/reject and on poll", () => {
  const ui = read("src/customer-service-v2.js");
  assert.match(ui, /function reviewBadgeHtml\(key\)/);
  assert.match(ui, /data-nav-review="'\+key\+'"'\+\(n\?'':' hidden'\)/);
  assert.match(ui, /toast\(res\.message\|\|'已通过'\);loadGiftOrders\(\);refreshReviewBadges\(\);/);
  assert.match(ui, /toast\(res\.message\|\|'已拒绝'\);loadGiftOrders\(\);refreshReviewBadges\(\);/);
  assert.match(ui, /setInterval\(function\(\)\{if\(!document\.hidden\)refreshReviewBadges\(\);\},8000\)/);
});

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
