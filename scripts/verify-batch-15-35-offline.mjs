#!/usr/bin/env node
/** Offline regression checks for the 9 / 15–35 service batch (no network, no DB). */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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

// ---------- #21 / #23 unified CS cancel + refund ----------
function orderDb(order, { hold = false, receipts = [] } = {}) {
  const st = { order: { ...order }, hold, holdReleases: 0, credits: [], refunds: [], receipts: receipts.map((r) => ({ ...r })) };
  st.fetch = fakeRest([
    [/\/rpc\/mcj_wallet_release_hold/, {
      method: "POST",
      run: ({ body }) => {
        st.lastReleaseKey = body.p_idempotency_key;
        if (!st.hold) return { __error: { status: 400, message: "no_hold" } };
        if (st.holdReleased) return { ok: true, duplicate: true };
        st.holdReleased = true;
        st.holdReleases += 1;
        return { ok: true, hold: { status: "released" } };
      },
    }],
    [/\/rpc\/mcj_wallet_credit$/, {
      method: "POST",
      run: ({ body }) => {
        if (st.credits.some((c) => c.p_idempotency_key === body.p_idempotency_key)) return { ok: true, duplicate: true };
        st.credits.push(body);
        return { ok: true, duplicate: false };
      },
    }],
    [/\/orders\?id=eq\.[^&]+&limit=1/, { method: "GET", run: () => [{ ...st.order }] }],
    [/\/orders\?id=eq\.[^&]+&select=/, { method: "GET", run: () => [{ ...st.order }] }],
    [/\/orders\?id=eq\./, {
      method: "PATCH",
      run: ({ url, body }) => {
        const m = url.match(/status=eq\.([a-z_]+)/);
        if (m && m[1] !== st.order.status) return [];
        Object.assign(st.order, body);
        return [{ ...st.order }];
      },
    }],
    [/\/payment_receipts\?order_id=eq/, { method: "GET", run: () => st.receipts.filter((r) => r.status === "pending") }],
    [/\/payment_receipts\?id=eq/, {
      method: "PATCH",
      run: ({ url, body }) => {
        const id = decodeURIComponent(url.match(/id=eq\.([^&]+)/)[1]);
        const r = st.receipts.find((x) => x.id === id);
        if (r) Object.assign(r, body);
        return r ? [r] : [];
      },
    }],
    [/\/boss_refund_requests\?order_id=eq/, { method: "GET", run: () => st.refunds.filter((r) => !/rejected|cancelled/.test(r.status)) }],
    [/\/boss_refund_requests\?id=eq/, {
      method: "GET",
      run: ({ url }) => st.refunds.filter((r) => r.id === decodeURIComponent(url.match(/id=eq\.([^&]+)/)[1])),
    }],
    [/\/boss_refund_requests$/, {
      method: "POST",
      run: ({ body }) => {
        const row = { ...body, id: `rf-${st.refunds.length + 1}` };
        st.refunds.push(row);
        return [row];
      },
    }],
    [/\/boss_refund_requests\?id=eq/, {
      method: "PATCH",
      run: ({ url, body }) => {
        const r = st.refunds.find((x) => x.id === decodeURIComponent(url.match(/id=eq\.([^&]+)/)[1]));
        if (r) Object.assign(r, body);
        return r ? [r] : [];
      },
    }],
  ]);
  return st;
}
const CS_OP = { id: "44444444-4444-4444-8444-444444444444", name: "小美", role: "customer_service" };
const baseOrder = (over = {}) => ({
  id: "55555555-5555-4555-8555-555555555555",
  order_no: "MCJ-T21",
  boss_id: "33333333-3333-4333-8333-333333333333",
  companion_id: null,
  status: "awaiting_payment",
  total_amount: 120,
  paid_cat_food: 0,
  paid_at: null,
  note: "",
  ...over,
});

await test("#21 unpaid CS-created order: cancel works, reason recorded, repeat is a no-op", async () => {
  const { csCancelOrRefundOrder } = await import("../server/api/_order-cancel.js");
  const st = orderDb(baseOrder());
  await withFetch(st.fetch, async () => {
    assert.equal((await csCancelOrRefundOrder(st.order, { reason: "", operator: CS_OP })).status, 400);
    const a = await csCancelOrRefundOrder(st.order, { reason: "老板不要了", operator: CS_OP });
    assert.equal(a.ok, true);
    assert.equal(a.mode, "unpaid");
    assert.equal(st.order.status, "cancelled");
    assert.match(st.order.note, /\[客服取消\] 老板不要了/);
    const b = await csCancelOrRefundOrder(st.order, { reason: "again", operator: CS_OP });
    assert.equal(b.duplicate, true);
  });
  assert.equal(st.refunds.length, 0);
  assert.equal(st.credits.length, 0);
});
await test("#21 awaiting_payment with a boss proof pending review is blocked (no silent money loss)", async () => {
  const { csCancelOrRefundOrder } = await import("../server/api/_order-cancel.js");
  const st = orderDb(baseOrder(), { receipts: [{ id: "rc1", status: "pending", payment_method: "tng", storage_path: "x/proof.png" }] });
  const out = await withFetch(st.fetch, () => csCancelOrRefundOrder(st.order, { reason: "x", operator: CS_OP }));
  assert.equal(out.status, 409);
  assert.equal(out.code, "PAYMENT_PROOF_PENDING");
  assert.equal(st.order.status, "awaiting_payment");
});
await test("#21 cat-food hold order: hold released once, wallet-hold receipt superseded, no extra credit", async () => {
  const { csCancelOrRefundOrder } = await import("../server/api/_order-cancel.js");
  const st = orderDb(baseOrder(), { hold: true, receipts: [{ id: "rw", status: "pending", payment_method: "catfood", review_remark: "[[WALLET_HOLD_PENDING_REVIEW]]" }] });
  await withFetch(st.fetch, async () => {
    const a = await csCancelOrRefundOrder(st.order, { reason: "下错单", operator: CS_OP });
    assert.equal(a.mode, "hold_release");
    assert.equal(st.order.status, "cancelled");
    await csCancelOrRefundOrder(st.order, { reason: "下错单", operator: CS_OP });
  });
  assert.equal(st.holdReleases, 1);
  assert.equal(st.lastReleaseKey, "order-release:MCJ-T21");
  assert.equal(st.receipts[0].status, "superseded");
  assert.equal(st.credits.length, 0);
});
await test("#21 paid hall order with hold: cancel → hold released, status cancelled, single release", async () => {
  const { csCancelOrRefundOrder } = await import("../server/api/_order-cancel.js");
  const st = orderDb(baseOrder({ status: "pending", paid_cat_food: 120, paid_at: "2026-10-05T01:00:00Z" }), { hold: true });
  await withFetch(st.fetch, async () => {
    const a = await csCancelOrRefundOrder(st.order, { reason: "无人接单", operator: CS_OP });
    assert.equal(a.ok, true);
    assert.equal(a.mode, "hold_release");
    assert.equal(a.amount, 120);
    assert.equal(st.order.status, "cancelled");
    const b = await csCancelOrRefundOrder(st.order, { reason: "无人接单", operator: CS_OP });
    assert.equal(b.duplicate, true);
  });
  assert.equal(st.holdReleases, 1);
  assert.equal(st.refunds.length, 0);
});
await test("#23 paid without hold (debit / proof): exact amount refunded to 猫粮 once; repeat does not refund again", async () => {
  const { csCancelOrRefundOrder } = await import("../server/api/_order-cancel.js");
  const st = orderDb(baseOrder({ status: "claimed", companion_id: "66666666-6666-4666-8666-666666666666", paid_cat_food: 88, paid_at: "2026-10-05T01:00:00Z" }));
  await withFetch(st.fetch, async () => {
    const a = await csCancelOrRefundOrder(st.order, { intent: "refund", reason: "指定陪玩无法接单", operator: CS_OP });
    assert.equal(a.ok, true, a.message);
    assert.equal(a.mode, "catfood_credit");
    assert.equal(st.order.status, "refunded");
    const b = await csCancelOrRefundOrder(st.order, { intent: "refund", reason: "重复点击", operator: CS_OP });
    assert.equal(b.duplicate, true);
  });
  assert.equal(st.refunds.length, 1);
  assert.equal(st.refunds[0].amount_rm, 88);
  assert.equal(st.credits.length, 1);
  assert.equal(st.credits[0].p_amount, 88);
  assert.equal(st.credits[0].p_idempotency_key, "refund-meow:rf-1");
});
await test("#21/#23 blocked states: in_progress / completed / multi child / no-taker sweep in flight / refund on unpaid", async () => {
  const { csCancelOrRefundOrder } = await import("../server/api/_order-cancel.js");
  const cases = [
    [baseOrder({ status: "in_progress", paid_at: "x" }), "cancel", "NOT_CANCELLABLE"],
    [baseOrder({ status: "completed", paid_at: "x" }), "cancel", "NOT_CANCELLABLE"],
    [baseOrder({ status: "claimed", paid_at: "x", parent_order_id: "p1" }), "cancel", "MULTI_ORDER_USE_GROUP_FLOW"],
    [baseOrder({ status: "refund_requested", paid_at: "x", note: "[[NO_TAKER_REFUND]]2026-10-05T01:00:00Z" }), "cancel", "IN_REFUND_FLOW"],
    [baseOrder(), "refund", "NOTHING_TO_REFUND"],
  ];
  for (const [o, intent, code] of cases) {
    const st = orderDb(o);
    const out = await withFetch(st.fetch, () => csCancelOrRefundOrder(st.order, { intent, reason: "x", operator: CS_OP }));
    assert.equal(out.code, code, `${o.status} → ${out.code}`);
    assert.equal(st.order.status, o.status);
    assert.equal(st.credits.length + st.holdReleases, 0);
  }
});
await test("#21 every CS cancel entry routes through the unified path", () => {
  const cs = read("server/api/customer-service.js");
  assert.match(cs, /action === "cs_cancel_order"/);
  assert.match(cs, /action === "cs_refund_order"/);
  assert.match(cs, /if \(String\(status\)\.toLowerCase\(\) === "cancelled"\) \{\s*return runCsCancelOrRefund\(/);
  assert.doesNotMatch(cs, /cancel_reason: String\(body\.reason \|\| "客服取消抢单"\)/);
  const ui = read("src/customer-service-v2.js");
  assert.match(ui, /api\('cs_cancel_order',\{id:cid,reason:cReason\}\)/);
  assert.match(ui, /data-cancel-order="'\+esc\(o\.id\)\+'">取消订单<\/button>'\);\s*\}/);
});

// ---------- #22 per-staff schedule / attendance + #35A clock button ----------
await test("#22 missing days: Mon–Fri schedule counts only scheduled past days without clock-in", async () => {
  const w = await import("../server/api/_customer-service-work.js");
  const cfg = { workDays: [1, 2, 3, 4, 5], attendanceEnabled: true };
  const out = w.monthAbsence(cfg, ["2026-10-01", "2026-10-05"], "2026-10", "2026-10-08");
  assert.deepEqual(out.dates, ["2026-10-02", "2026-10-06", "2026-10-07"]);
  assert.equal(out.count, 3);
  assert.equal(w.monthAbsence({ standardDays: 22 }, ["2026-10-01", "2026-10-05"], "2026-10", "2026-10-08").count, 20);
  assert.equal(w.monthAbsence({ ...cfg, attendanceEnabled: false }, [], "2026-10", "2026-10-08").count, 0);
});
await test("#22 attendance day: Sunday off-schedule and attendance-off never count late", async () => {
  const w = await import("../server/api/_customer-service-work.js");
  const cfg = { workDays: [1, 2, 3, 4, 5], shiftStart: "09:00", shiftEnd: "18:00", graceMinutes: 10 };
  assert.equal(w.isAttendanceDay(cfg, "2026-10-04"), false);
  assert.equal(w.isAttendanceDay(cfg, "2026-10-05"), true);
  assert.equal(w.isAttendanceDay({ attendanceEnabled: false }, "2026-10-05"), false);
  const lateRow = { shift_start: "2026-10-05T01:30:00Z", shift_end: "2026-10-05T09:30:00Z" };
  assert.equal(w.calcAttendanceMeta(cfg, lateRow, "2026-10-05").lateMinutes, 20);
  assert.equal(w.calcAttendanceMeta(cfg, lateRow, "2026-10-05").earlyLeaveMinutes, 30);
  const sundayRow = { shift_start: "2026-10-04T01:30:00Z", shift_end: "2026-10-04T09:30:00Z" };
  assert.equal(w.calcAttendanceMeta(cfg, sundayRow, "2026-10-04").lateMinutes, 0);
  assert.equal(w.calcAttendanceMeta({ ...cfg, attendanceEnabled: false }, lateRow, "2026-10-05").lateMinutes, 0);
});
await test("#22 base salary: explicit per-staff 0 sticks, unset falls back to global", async () => {
  const w = await import("../server/api/_customer-service-work.js");
  assert.equal(w.mergeServiceConfig({ baseSalary: 1800 }, { baseSalary: 0, baseSalarySet: true }).baseSalary, 0);
  assert.equal(w.mergeServiceConfig({ baseSalary: 1800 }, { baseSalary: 0 }).baseSalary, 1800);
  assert.equal(w.mergeServiceConfig({ baseSalary: 1800 }, { baseSalary: 2500, baseSalarySet: true }).baseSalary, 2500);
  assert.deepEqual(w.normalizeWorkDays("5,1,1,9,x"), [1, 5]);
  assert.equal(w.normalizeWorkDays([]), null);
});
await test("#22 saveServiceConfig rejects bad HH:MM and stamps updatedAt/updatedBy", async () => {
  const w = await import("../server/api/_customer-service-work.js");
  const sid = "11111111-2222-3333-4444-555555555555";
  let written = null;
  const fake = fakeRest([
    [/customer_service_reports\?customer_service_id=eq\./, { method: "GET", run: () => [] }],
    [/customer_service_reports/, { method: "POST", run: ({ body }) => ((written = body), [body]) }],
  ]);
  await withFetch(fake, async () => {
    await assert.rejects(() => w.saveServiceConfig(sid, { shiftStart: "25:00" }), /HH:MM/);
    await w.saveServiceConfig(sid, { shiftStart: "10:00", shiftEnd: "19:00", workDays: [1, 3, 5], attendanceEnabled: false, baseSalary: 0, updatedBy: "admin-1", updatedByName: "Admin" });
  });
  const meta = JSON.parse(String(written.note).replace(/^[^{]*/, ""));
  assert.equal(meta.shiftStart, "10:00");
  assert.deepEqual(meta.workDays, [1, 3, 5]);
  assert.equal(meta.attendanceEnabled, false);
  assert.equal(meta.baseSalarySet, true);
  assert.equal(meta.baseSalary, 0);
  assert.equal(meta.updatedBy, "admin-1");
  assert.ok(Date.parse(meta.updatedAt) > 0);
});
await test("#22 clock-in late uses server config; duplicate (23505) race returns already instead of 500", async () => {
  const w = await import("../server/api/_customer-service-work.js");
  const sid = "11111111-2222-3333-4444-555555555555";
  const sessions = [];
  let failInsert = false;
  const fake = fakeRest([
    [/cs_attendance_sessions\?.*status=eq\.open/, { method: "GET", run: () => sessions.filter((s) => s.status === "open") }],
    [/cs_attendance_sessions\?/, { method: "GET", run: () => sessions }],
    [/cs_attendance_sessions/, {
      method: "POST",
      run: ({ body }) => {
        if (failInsert) {
          sessions.push({ ...body, id: "raced" });
          return { __error: { status: 409, code: "23505", message: 'duplicate key value violates unique constraint "idx_cs_att_sessions_one_open"' } };
        }
        const row = { ...body, id: `s${sessions.length + 1}` };
        sessions.push(row);
        return [row];
      },
    }],
    [/customer_service_reports/, { run: () => [] }],
  ]);
  await withFetch(fake, async () => {
    const off = await w.clockInService(sid, { config: { shiftStart: "00:00", graceMinutes: 0, attendanceEnabled: false }, sessionType: "normal" });
    assert.equal(off.row.late_minutes, 0);
    sessions.length = 0;
    failInsert = true;
    const raced = await w.clockInService(sid, { config: {}, sessionType: "normal" });
    assert.equal(raced.already, true);
    assert.equal(raced.row.id, "raced");
  });
});
await test("#22 CS clock handler ignores client config; admin uses per-staff config + save_staff_config", () => {
  const cs = read("server/api/customer-service.js");
  assert.match(cs, /const cfg = await workApi\.loadClockConfig\(service\.profile\.id\);/);
  assert.doesNotMatch(cs, /body\.config \|\| body\.shiftConfig/);
  const ui = read("src/customer-service-v2.js");
  assert.match(ui, /var req=api\(action,\{\}\);/);
  const admin = read("server/api/admin/service-accounts.js");
  assert.match(admin, /const staffConfig = configFor\(row\.id\);/);
  assert.match(admin, /action === "save_staff_config"/);
  assert.match(admin, /workApi\.monthAbsence\(staffConfig/);
  assert.match(admin, /attendanceSummary: \{/);
  const adminUi = read("src/admin-service-accounts.js");
  assert.match(adminUi, /shiftFieldsHtml\(row, readonly\)/);
  assert.match(adminUi, /payload\.workDays = fd\.getAll\("workDay"\)\.map\(Number\)/);
});
await test("#35A clock panel: exactly one primary action per state + explicit done line", () => {
  const src = read("src/customer-service-v2.js");
  const start = src.indexOf("function clockCanIn(att){");
  const end = src.indexOf("function optimisticClockIn(prev){");
  const nodes = {};
  const mk = (sel) => (nodes[sel] = { hidden: false, disabled: false, textContent: "", className: "" });
  ["[data-clock-status]", "[data-clock-in-at]", "[data-clock-out-at]", "[data-live-hours]", "[data-overtime-hours]", "[data-clock-label]", "[data-clock-done]", "[data-clock-in]", "[data-clock-out]"].forEach(mk);
  const ctx = { root: { querySelector: (s) => nodes[s] || null }, state: {}, Date, Number, Math, fmtAttDateTime: (t) => t || "" };
  vm.runInNewContext(src.slice(start, end) + ";this.patch=patchClockPanel;", ctx);
  ctx.patch({ canClockIn: true, canClockOut: false, closedCount: 0 }, false);
  assert.equal(nodes["[data-clock-status]"].textContent, "未上班");
  assert.equal(nodes["[data-clock-in]"].hidden, false);
  assert.equal(nodes["[data-clock-in]"].textContent, "上班打卡");
  assert.match(nodes["[data-clock-in]"].className, /primary/);
  assert.equal(nodes["[data-clock-out]"].hidden, true);
  ctx.patch({ canClockIn: false, canClockOut: true, clockInAt: "x", clockInText: "2026-10-05 09:01" }, false);
  assert.equal(nodes["[data-clock-status]"].textContent, "上班中");
  assert.equal(nodes["[data-clock-in]"].hidden, true);
  assert.equal(nodes["[data-clock-out]"].hidden, false);
  assert.equal(nodes["[data-clock-out]"].textContent, "下班打卡");
  assert.equal(nodes["[data-clock-done]"].hidden, true);
  ctx.patch({ canClockIn: true, canClockOut: false, closedCount: 1, clockInText: "2026-10-05 09:01", clockOutText: "2026-10-05 18:03", clockOutAt: "y", attendanceLabel: "正常" }, false);
  assert.equal(nodes["[data-clock-status]"].textContent, "今日已下班");
  assert.equal(nodes["[data-clock-done]"].hidden, false);
  assert.match(nodes["[data-clock-done]"].textContent, /今日已下班 09:01–18:03 · 正常/);
  assert.equal(nodes["[data-clock-in]"].textContent, "加班上班");
  assert.doesNotMatch(nodes["[data-clock-in]"].className, /primary/);
  assert.equal(nodes["[data-clock-out]"].hidden, true);
  const css = read("src/customer-service-v2.css");
  assert.match(css, /\.cs-clock-btn\[hidden\],\.cs-clock-done\[hidden\]\{display:none!important\}/);
  assert.match(css, /\.cs-clock-actions \.cs-clock-btn\{min-height:44px/);
});

await test("#26 per-game companion rank: tied to service, sanitized, empty ranks never shown", async () => {
  const ss = await import("../server/api/_service-standard.js");
  assert.equal(ss.cleanRank("  钻石<script>\u0007 II  "), "钻石script II");
  assert.equal(ss.cleanRank("x".repeat(80)).length, 30);
  const standards = {
    s1: { name: "王者荣耀", rank: "星耀 III", content: "" },
    s2: { name: "和平精英", rank: "", content: "带飞" },
    s3: { name: "英雄联盟", rank: "钻石 II" },
  };
  assert.deepEqual(ss.gameRanksFromStandards(standards).map((r) => [r.name, r.rank]), [["王者荣耀", "星耀 III"], ["英雄联盟", "钻石 II"]]);
  assert.equal(ss.rankForService(standards, { serviceId: "s1" }), "星耀 III");
  assert.equal(ss.rankForService(standards, { name: "英雄联盟" }), "钻石 II");
  assert.equal(ss.rankForService(standards, { serviceId: "s2" }), "");
  const pub = read("server/api/public/companions.js");
  assert.match(pub, /legacy && games\.length === 1/);
  assert.match(read("src/companion-hall.js"), /data-game-rank/);
  assert.match(read("src/profile-detail.js"), /pd-service-chip--rank/);
  assert.match(read("src/companion-workbench.js"), /name="rank" maxlength="30"/);
});
await test("#27 boss rank frozen in order snapshot; hall keeps only bossRank; CS + admin render it", async () => {
  const ss = await import("../server/api/_service-standard.js");
  const snap = ss.buildServiceSnapshot({ standards: {}, serviceId: "s1", serviceName: "王者荣耀", unitPrice: 30, bossRank: "王者 50星", bossRankGame: "王者荣耀" });
  assert.deepEqual(snap.bossRank, { game: "王者荣耀", rank: "王者 50星" });
  const noRank = ss.buildServiceSnapshot({ standards: {}, serviceId: "s1", serviceName: "王者荣耀" });
  assert.equal(noRank.bossRank, undefined);
  const viewed = ss.viewServiceSnapshot({ service_snapshot: snap, game: "王者荣耀" });
  assert.deepEqual(viewed.bossRank, { game: "王者荣耀", rank: "王者 50星" });
  const { sanitizeHallOrderView } = await import("../server/api/_order-assignment.js");
  const hall = sanitizeHallOrderView({ id: "o1", serviceSnapshot: { ...viewed, sections: [{ label: "x", value: "secret" }] } });
  assert.deepEqual(hall.serviceSnapshot, { bossRank: { game: "王者荣耀", rank: "王者 50星" } });
  assert.equal(sanitizeHallOrderView({ id: "o2", serviceSnapshot: viewServiceNull() }).serviceSnapshot, null);
  function viewServiceNull() { return null; }
  assert.match(read("src/customer-service-v2.js"), /data-order-boss-rank/);
  assert.match(read("src/admin-final-v1.js"), /\['老板段位'/);
  assert.match(read("src/companion-workbench.js"), /function bossRankMetaHtml\(o\)/);
  assert.match(read("server/api/orders.js"), /cleanRank\(order\.bossRank/);
  assert.match(read("server/api/_place-multi-order.js"), /sharedBossRank/);
});

await test("#32 cancelled/refunded multi parent never derives a payment-review label and is never reopened", async () => {
  const g = await import("../server/api/_order-group.js");
  const kids = [{ status: "awaiting_payment" }, { status: "awaiting_payment" }];
  const c = g.deriveMultiGroupState({ status: "cancelled", order_type: "multi_group" }, kids);
  assert.equal(c.label, "已取消");
  assert.equal(c.parentStatus, "cancelled");
  const r = g.deriveMultiGroupState({ status: "refunded", order_type: "multi_group" }, kids);
  assert.equal(r.label, "已退款");
  const live = g.deriveMultiGroupState({ status: "awaiting_payment", order_type: "multi_group" }, kids);
  assert.equal(live.parentStatus, "awaiting_payment");
  const patches = [];
  const out = await g.refreshParentOrderStatus("p1", {
    loadOrder: async () => ({ id: "p1", status: "cancelled", order_type: "multi_group" }),
    loadChildren: async () => kids,
    patchOrder: async (id, patch) => { patches.push(patch); return { id, ...patch }; },
  });
  assert.equal(patches.length, 0, "cancelled parent must not be patched back to awaiting_payment");
  assert.notEqual(out?.error, "missing_deps");
});
await test("#32 CS + admin labels/filters: terminal orders show 已取消/已退款, never 待审核", async () => {
  const pr = await import("../server/api/_payment-receipts.js");
  assert.equal(pr.isTerminalOrderStatus("cancelled"), true);
  assert.equal(pr.isTerminalOrderStatus("refunded"), true);
  assert.doesNotMatch(pr.terminalOrderReviewText("cancelled"), /待审核|付款审核|等待审核/);
  const admin = read("server/api/admin/orders.js");
  assert.match(admin, /if \(st === "refunded"\) return "已退款";\r?\n  if \(rv === "pending" && isTerminalOrderStatus\(st\)\)/);
  assert.match(admin, /if \(st === "refunded"\) return "已退款";\r?\n    return "主单已付·分配";/);
  const cs = read("server/api/customer-service.js");
  assert.match(cs, /paymentReview: !!extras\.paymentReceipt && !isTerminalOrderStatus\(row\.status\)/);
  const ui = read("src/customer-service-v2.js");
  assert.match(ui, /state\.orderFilter==='payment_review'\)\{if\(!o\.paymentReview\)return false;\}/);
  assert.match(ui, /state\.orderFilter==='awaiting_payment'\)\{if\(o\.status!=='awaiting_payment'\|\|o\.paymentReview\)return false;\}/);
});
await test("#33 KL formatters: UTC→+8 once, zone-less kept, identical under any device TZ", async () => {
  const { execFileSync } = await import("node:child_process");
  const probe = `
    const fs=require('fs'),vm=require('vm');
    const cs=fs.readFileSync('src/customer-service-v2.js','utf8');
    const a=cs.indexOf('function klDate(v){'),b=cs.indexOf('function companionAcceptLabel(');
    const s2=cs.indexOf('function fmtOrderDateTime(v){'),e2=cs.indexOf('function conversationStatusKind(');
    const ctx={};vm.runInNewContext(cs.slice(a,b)+cs.slice(s2,e2)+';this.o=fmtOrderDateTime;this.c=fmtChatTime;',ctx);
    const ad=fs.readFileSync('src/admin-final-v1.js','utf8');
    const a3=ad.indexOf('function klDate(v){'),b3=ad.indexOf('function orderStatusSelectValue(');
    const ctx2={};vm.runInNewContext(ad.slice(a3,b3)+';this.f=fmtOrderTime;',ctx2);
    const ct={window:{}};vm.runInNewContext(fs.readFileSync('src/content-time.js','utf8'),ct);
    const k=ct.window.MCJContentTime.fmtContentTime;
    const inputs=['2026-10-06T01:05:09.123+00:00','2026-10-06T01:05:09Z','2026-10-06 01:05:09+00','2026-10-06T09:05:09+08:00','2026-10-06 09:05:09','2026-10-06T09:05:09','2026-10-05T16:30:00Z'];
    console.log(JSON.stringify(inputs.map(v=>[ctx.o(v),ctx2.f(v,true),k(v,true)])));
  `;
  const outs = ["UTC", "America/Los_Angeles", "Asia/Kolkata", "Asia/Kuala_Lumpur"].map((tz) =>
    execFileSync(process.execPath, ["-e", probe], { cwd: root, env: { ...process.env, TZ: tz }, encoding: "utf8" }).trim()
  );
  assert.ok(outs.every((o) => o === outs[0]), "device TZ must not change output:\n" + outs.join("\n"));
  const rows = JSON.parse(outs[0]);
  for (const r of rows.slice(0, 6)) assert.deepEqual(r, ["2026-10-06 09:05:09", "2026-10-06 09:05:09", "2026-10-06 09:05:09"]);
  assert.deepEqual(rows[6], ["2026-10-06 00:30:00", "2026-10-06 00:30:00", "2026-10-06 00:30:00"]);
});
await test("#33 every end routes order/chat times through the KL helper (no device-local toLocaleString)", () => {
  const wb = read("src/companion-workbench.js");
  assert.match(wb, /function fmtTime\(v\)\{if\(!v\)return '-';return klFmt\(v,true\)\|\|'-';\}/);
  assert.doesNotMatch(wb, /toLocaleTimeString\('zh-CN'/);
  const admin = read("src/admin-final-v1.js");
  assert.doesNotMatch(admin, /toLocaleString\('zh-CN',\{hour12:false\}\)/);
  const cs = read("src/customer-service-v2.js");
  assert.doesNotMatch(cs, /String\(d\.getHours\(\)\)/);
  assert.match(read("orders.html"), /function date\(v\)\{if\(!v\)return '-';var K=window\.MCJContentTime/);
  assert.match(read("server/api/_companion-order-notify.js"), /8 \* 3600 \* 1000/);
  assert.match(read("src/place-order-modal.js"), /pad2\(\(d\.getUTCHours\(\) \+ 1\) % 24\) \+ ":00"/);
});

// ---------- #35B CS early finish ----------
function efDb(orders) {
  const st = { orders: orders.map((o) => ({ ...o })), credits: [], refunds: [], tx: [], patches: [] };
  const byId = (url) => st.orders.find((o) => o.id === decodeURIComponent((url.match(/[?&]id=eq\.([^&]+)/) || [])[1] || ""));
  st.fetch = fakeRest([
    [/\/rpc\/mcj_wallet_credit$/, {
      method: "POST",
      run: ({ body }) => {
        if (st.credits.some((c) => c.p_idempotency_key === body.p_idempotency_key)) return { ok: true, duplicate: true };
        st.credits.push(body);
        return { ok: true, duplicate: false };
      },
    }],
    [/\/rpc\//, { method: "POST", run: () => ({ __error: { status: 400, message: "no_hold" } }) }],
    [/\/orders\?parent_order_id=eq\./, { method: "GET", run: ({ url }) => st.orders.filter((o) => o.parent_order_id === decodeURIComponent(url.match(/parent_order_id=eq\.([^&]+)/)[1])).map((o) => ({ ...o })) }],
    [/\/orders\?id=eq\./, { method: "GET", run: ({ url }) => { const o = byId(url); return o ? [{ ...o }] : []; } }],
    [/\/orders\?id=eq\./, {
      method: "PATCH",
      run: ({ url, body }) => {
        const o = byId(url);
        if (!o) return [];
        const m = url.match(/status=eq\.([a-z_]+)/);
        if (m && m[1] !== o.status) return [];
        if (/note\.not\.like/.test(url) && String(o.note || "").includes("EARLY_FINISH:")) return [];
        Object.assign(o, body);
        st.patches.push({ id: o.id, body });
        return [{ ...o }];
      },
    }],
    [/\/transactions\?/, {
      method: "GET",
      run: ({ url }) => {
        const type = (url.match(/transaction_type=eq\.([a-z_]+)/) || [])[1];
        return st.tx.filter((t) => (!type || t.transaction_type === type) && t.status !== "cancelled");
      },
    }],
    [/\/transactions$/, { method: "POST", run: ({ body }) => { const row = { ...body, id: `tx-${st.tx.length + 1}` }; st.tx.push(row); return [row]; } }],
    [/\/transactions\?id=eq/, {
      method: "PATCH",
      run: ({ url, body }) => { const t = st.tx.find((x) => x.id === decodeURIComponent(url.match(/id=eq\.([^&]+)/)[1])); if (t) Object.assign(t, body); return t ? [t] : []; },
    }],
    [/\/boss_refund_requests\?order_id=eq/, {
      method: "GET",
      run: ({ url }) => {
        const oid = decodeURIComponent(url.match(/order_id=eq\.([^&]+)/)[1]);
        const onlyPaid = /status=eq\.paid/.test(url);
        const notId = decodeURIComponent((url.match(/id=neq\.([^&]+)/) || [])[1] || "");
        return st.refunds.filter((r) => r.order_id === oid && !/rejected|cancelled/.test(r.status) && (!onlyPaid || r.status === "paid") && r.id !== notId);
      },
    }],
    [/\/boss_refund_requests\?id=eq/, { method: "GET", run: ({ url }) => st.refunds.filter((r) => r.id === decodeURIComponent(url.match(/id=eq\.([^&]+)/)[1])) }],
    [/\/boss_refund_requests$/, { method: "POST", run: ({ body }) => { const row = { ...body, id: `rf-${st.refunds.length + 1}` }; st.refunds.push(row); return [row]; } }],
    [/\/boss_refund_requests\?id=eq/, {
      method: "PATCH",
      run: ({ url, body }) => { const r = st.refunds.find((x) => x.id === decodeURIComponent(url.match(/id=eq\.([^&]+)/)[1])); if (r) Object.assign(r, body); return r ? [r] : []; },
    }],
  ]);
  return st;
}
const EF_BOSS = "33333333-3333-4333-8333-333333333333";
const efOrder = (over = {}) => ({
  id: "77777777-7777-4777-8777-777777777777",
  order_no: "MCJ-EF1",
  boss_id: EF_BOSS,
  companion_id: "66666666-6666-4666-8666-666666666666",
  status: "in_progress",
  hours: 2,
  total_amount: 100,
  paid_cat_food: 100,
  paid_at: "2026-10-06T01:00:00Z",
  started_at: "2026-10-06T02:00:00Z",
  companion_commission_rate_snapshot: 80,
  note: "",
  ...over,
});

await test("#35B math: pro-rata settle/refund, full when served ≥ booked, bad input rejected", async () => {
  const ef = await import("../server/api/_order-early-finish.js");
  const c = ef.computeEarlyFinish(efOrder(), { servedHours: 1.5, companionShareRate: 80 });
  assert.deepEqual([c.settleAmount, c.refundAmount, c.companionIncome, c.platformCommission], [75, 25, 60, 15]);
  const full = ef.computeEarlyFinish(efOrder(), { servedHours: 2, companionShareRate: 80 });
  assert.deepEqual([full.settleAmount, full.refundAmount], [100, 0]);
  assert.throws(() => ef.computeEarlyFinish(efOrder(), { servedHours: 3 }), /不能超过预约时长/);
  assert.throws(() => ef.computeEarlyFinish(efOrder(), { servedHours: -1 }), /实际服务时长/);
  assert.throws(() => ef.computeEarlyFinish(efOrder({ hours: 0 }), { servedHours: 1 }), /缺少预约时长/);
  const marked = ef.withEarlyFinishMarker("备注]]x", { status: "done", reason: "a]]b\nc" });
  assert.equal(ef.readEarlyFinish({ note: marked }).reason, "a]]b\nc");
  assert.equal(ef.withEarlyFinishMarker(marked, { status: "done", reason: "z" }).match(/EARLY_FINISH:/g).length, 1);
  const { sanitizeOrderText } = await import("../server/api/_output-sanitize.js");
  assert.equal(sanitizeOrderText(marked).includes("EARLY_FINISH"), false);
});
await test("#35B single order: settles once, refunds remainder once (partial stays completed), repeat clicks are no-ops", async () => {
  const ef = await import("../server/api/_order-early-finish.js");
  const st = efDb([efOrder()]);
  const msgs = [];
  const opts = { servedHours: 1.5, reason: "老板临时有事", initiator: "boss", operator: CS_OP, addSystemMessage: async (o, a, m) => msgs.push(m) };
  await withFetch(st.fetch, async () => {
    const a = await ef.executeEarlyFinish(st.orders[0], opts);
    assert.equal(a.ok, true, JSON.stringify(a.results));
    const b = await ef.executeEarlyFinish(st.orders[0], opts);
    assert.equal(b.results[0].duplicate, true);
    const c = await ef.executeEarlyFinish({ ...st.orders[0] }, { ...opts, servedHours: 0.5 });
    assert.equal(c.results[0].duplicate, true);
  });
  const o = st.orders[0];
  assert.equal(o.status, "completed", "partial refund must keep the order completed, not refunded");
  assert.equal(st.refunds.length, 1);
  assert.equal(st.refunds[0].amount_rm, 25);
  assert.match(st.refunds[0].reason, /^\[提前结束退款\]/);
  assert.equal(st.credits.length, 1);
  assert.equal(st.credits[0].p_amount, 25);
  assert.equal(st.credits[0].p_idempotency_key, "refund-meow:rf-1");
  assert.equal(st.tx.filter((t) => t.transaction_type === "companion_income").length, 1, "one companion_income row");
  const done = ef.readEarlyFinish(o);
  assert.equal(done.status, "done");
  assert.deepEqual([done.settleAmount, done.refundAmount, done.companionIncome, done.platformCommission], [75, 25, 60, 15]);
  assert.equal(done.initiator.label, "老板要求");
  assert.equal(done.confirmedByName, "小美");
  assert.ok(msgs.some((m) => /实际服务 1\.5 小时 \/ 预约 2 小时/.test(m)));
});
await test("#35B blocked: completed / cancelled / not started; concurrent claim loses cleanly", async () => {
  const ef = await import("../server/api/_order-early-finish.js");
  for (const [status, re] of [["completed", /已完成/], ["cancelled", /已取消/], ["claimed", /仅服务中/]]) {
    const st = efDb([efOrder({ status })]);
    const out = await withFetch(st.fetch, () => ef.executeEarlyFinish(st.orders[0], { servedHours: 1, reason: "x", operator: CS_OP }));
    assert.equal(out.ok, false);
    assert.match(out.results[0].message, re);
    assert.equal(st.refunds.length + st.credits.length, 0);
  }
  const st = efDb([efOrder({ note: `[[EARLY_FINISH:${encodeURIComponent(JSON.stringify({ status: "processing", claimedAt: new Date().toISOString() }))}]]` })]);
  const out = await withFetch(st.fetch, () => ef.executeEarlyFinish(st.orders[0], { servedHours: 1, reason: "x", operator: CS_OP }));
  assert.equal(out.results[0].code, "EARLY_FINISH_IN_PROGRESS");
  assert.equal(st.orders[0].status, "in_progress");
  const st2 = efDb([efOrder()]);
  const out2 = await withFetch(st2.fetch, () => ef.executeEarlyFinish(st2.orders[0], { servedHours: 1, reason: "", operator: CS_OP }).catch((e) => e));
  assert.match(out2.message, /请填写提前结束原因/);
});
await test("#35B multi: one child ends without touching siblings; whole-order ends every live child; parent never refunded", async () => {
  const ef = await import("../server/api/_order-early-finish.js");
  const parent = efOrder({ id: "88888888-8888-4888-8888-888888888888", order_no: "MCJ-EFP", order_type: "multi_group", companion_id: null, total_amount: 200, paid_cat_food: 200 });
  const kid = (n) => efOrder({ id: `9999999${n}-9999-4999-8999-99999999999${n}`, order_no: `MCJ-EFP-${n}`, parent_order_id: parent.id, paid_cat_food: 0, total_amount: 100, companion_id: `6666666${n}-6666-4666-8666-66666666666${n}` });
  const st = efDb([parent, kid(1), kid(2)]);
  await withFetch(st.fetch, async () => {
    const one = await ef.executeEarlyFinish(st.orders[0], { servedHours: 1, reason: "一位陪玩掉线", childIds: [st.orders[1].id], operator: CS_OP });
    assert.equal(one.ok, true, JSON.stringify(one.results));
  });
  assert.equal(st.orders[1].status, "completed");
  assert.equal(st.orders[2].status, "in_progress", "sibling keeps serving");
  assert.equal(st.refunds.length, 1);
  assert.equal(st.refunds[0].order_id, st.orders[1].id);
  assert.equal(st.refunds[0].amount_rm, 50);
  await withFetch(st.fetch, async () => {
    const all = await ef.executeEarlyFinish(st.orders[0], { servedHours: 2, reason: "整单结束", operator: CS_OP });
    assert.equal(all.ok, true, JSON.stringify(all.results));
    assert.equal(all.results.length, 1, "already-finished child is not processed again");
  });
  assert.equal(st.orders[2].status, "completed");
  assert.equal(st.refunds.length, 1, "served = booked → no refund for child 2");
  assert.ok(!st.refunds.some((r) => r.order_id === parent.id));
  assert.equal(st.credits.length, 1);
});
await test("#35B CS reject keeps the order running and records the reason; UI wires confirm/reject + four-end views", async () => {
  const ef = await import("../server/api/_order-early-finish.js");
  const st = efDb([efOrder({ note: "[[COMPLETION_PENDING]]\n[[COMPLETION_REQUESTED_AT]] 2026-10-06T03:00:00Z" })]);
  await withFetch(st.fetch, async () => {
    const out = await ef.rejectEarlyFinish(st.orders[0], { reason: "老板还要继续玩", operator: CS_OP });
    assert.equal(out.ok, true);
  });
  assert.equal(st.orders[0].status, "in_progress");
  assert.equal(st.orders[0].note.includes("[[COMPLETION_PENDING]]"), false);
  assert.equal(ef.readEarlyFinishReject(st.orders[0]).reason, "老板还要继续玩");
  const cs = read("src/customer-service-v2.js");
  assert.match(cs, /if\(completeOrder\)\{openEarlyFinish\(completeOrder\.dataset\.completeOrder\);return\}/);
  assert.match(cs, /api\('early_finish_order'/);
  assert.match(cs, /api\('reject_early_finish'/);
  assert.match(cs, /efState\.busy=true;btn\.disabled=true/);
  assert.match(read("server/api/customer-service.js"), /earlyFinish: readEarlyFinish\(row\)/);
  assert.match(read("server/api/admin/orders.js"), /earlyFinish: readEarlyFinish\(row\)/);
  assert.match(read("server/api/companion.js"), /earlyFinish: companionEarlyFinishView\(row\)/);
  assert.match(read("src/admin-final-v1.js"), /earlyFinishSection\(o\)\+/);
  assert.match(read("src/companion-workbench.js"), /function earlyFinishMetaHtml\(o\)/);
});

await test("#31 multi review: picker per child, parent review rejected, dedupe, admin parent detail lists child reviews", () => {
  const boss = read("orders.html");
  assert.match(boss, /function openMultiReviewPicker\(parent\)/);
  assert.match(boss, /data-review-child="'\+esc\(ch\.id\)\+'"/);
  assert.match(boss, /if\(isMultiParent\(o\)\)\{openMultiReviewPicker\(o\);return\}/);
  const ordersApi = read("server/api/orders.js");
  assert.match(ordersApi, /MULTI_PARENT_REVIEW/);
  assert.match(ordersApi, /该订单已评价/);
  const adminApi = read("server/api/admin/orders.js");
  assert.match(adminApi, /viewed\.childReviews = /);
  assert.match(adminApi, /parent_order_id=eq\.\$\{encodeURIComponent\(id\)\}/);
  assert.match(adminApi, /images: normalizeReviewImages\(r\.image_urls\),\r?\n\s+createdAt/);
  const admin = read("src/admin-final-v1.js");
  assert.match(admin, /data-admin-child-review=/);
  assert.match(admin, /reviewImagesHtml\(k\.images\)/);
});

await test("#30 CS→companion reply: push only for companion rooms, one tag per message, deep link + companion-portal routing", async () => {
  const { notifyCompanionCsReply } = await import(pathToFileURL(path.join(root, "server/api/_companion-inbox.js")).href);
  const boss = await notifyCompanionCsReply({ id: "c1", boss_id: "b1", companion_id: "", conversation_type: "order_support" }, { messageId: "m1", content: "hi" });
  assert.equal(boss.skipped, "not_companion_cs");
  const sys = await notifyCompanionCsReply({ id: "c2", companion_id: "p1", conversation_type: "companion_support" }, { messageId: "m2", messageType: "system" });
  assert.equal(sys.skipped, "system");
  const inbox = read("server/api/_companion-inbox.js");
  assert.match(inbox, /url: `\/companion\/messages\?conversation=\$\{encodeURIComponent\(cid\)\}`/);
  assert.match(inbox, /tag: `cs-msg-\$\{String\(messageId \|\| cid\)/);
  assert.match(inbox, /preferRole: "companion"/);
  assert.match(read("server/api/_web-push.js"), /const rows = roleRows\.length \? roleRows : allRows;/);
  assert.match(read("server/api/customer-service.js"), /conversation\.companion_id && !conversation\.boss_id && messageType !== "system"[\s\S]{0,200}notifyCompanionCsReply/);
  const wb = read("src/companion-workbench.js");
  assert.match(wb, /function onCompanionCsMessage\(row\)/);
  assert.match(wb, /if\(seen\[row\.id\]\)return;/);
  assert.match(wb, /String\(row\.sender_role\|\|''\)!=='customer_service'/);
  assert.match(wb, /RT\.subscribeConversations\(token,\{/);
  assert.match(wb, /var cid=String\(q\.get\('conversation'\)\|\|''\)\.trim\(\);/);
  assert.match(wb, /applyFocusOrderFromQuery\(\);\r?\n\s+applyConversationFromQuery\(\);/);
  assert.doesNotMatch(wb, /state\.data\.summary\.unreadMessages=num\(state\.data\.summary\.unreadMessages\)\+1/);
});

await test("#18 gifts: income only after the gift record wins, replay repairs missing income once, reject notifies boss, stable client keys", () => {
  const cat = read("server/api/_send-catfood-gift.js");
  const insertAt = cat.indexOf('companionDb("gift_transactions", "", {');
  const incomeAt = cat.indexOf("incomeTx = await creditCompanionIncome(companion, companionIncome, giftNote);");
  assert.ok(insertAt > 0 && incomeAt > insertAt, "income must be credited after the gift_transactions insert");
  assert.match(cat, /settlement_transaction_id: null,/);
  assert.match(cat, /sender_boss_id=eq\.\$\{encodeURIComponent\(boss\)\}/);
  const go = read("server/api/_gift-orders.js");
  assert.match(go, /const needsIncomeRepair =/);
  assert.match(go, /note=like\.\$\{encodeURIComponent\(`\*"giftOrderId":"\$\{working\.id\}"\*`\)\}/);
  assert.match(go, /GIFT_INCOME_PENDING/);
  assert.match(go, /"礼物订单未通过审核"/);
  assert.match(go, /assertNotSelfTrade\(boss, companionRow\.user_id \|\| companion, "送礼给自己"\)/);
  const mall = read("src/gifts-mall.js");
  assert.match(mall, /batchKey\("external", state\.selectedGift\.id, companion\.id, state\.quantity\)/);
  assert.match(mall, /state\.proofQueue\.shift\(\)/);
  assert.doesNotMatch(mall, /idempotencyKey:\s*idem\(\)/);
  const pd = read("src/profile-detail.js");
  assert.doesNotMatch(pd, /idempotencyKey:\s*idem\(\)/);
  assert.match(pd, /clearKey\("tip\|"/);
});

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
