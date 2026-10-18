import assert from "node:assert/strict";

process.env.SUPABASE_URL = "http://127.0.0.1:9";
process.env.VITE_SUPABASE_URL = "http://127.0.0.1:9";
process.env.SUPABASE_ANON_KEY = "test-anon";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";

const { default: handler, appointmentRefundBlocked } = await import("../server/api/appointments.js");

const COMP = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const BOSS = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const APPT = "cccccccc-cccc-cccc-cccc-cccccccccccc";

function res() {
  return {
    statusCode: 0,
    body: null,
    setHeader() {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
  };
}

function req(id, action = "accept") {
  return {
    method: "POST",
    headers: { authorization: "Bearer companion-test" },
    body: { action, id },
  };
}

function appointment(status = "pending", extra = {}) {
  return {
    id: APPT,
    boss_id: BOSS,
    companion_id: COMP,
    service_name: "排位",
    unit_price: 10,
    hours: 1,
    total_amount: 10,
    requirements: "",
    status,
    charge_state: "none",
    order_id: null,
    created_at: "2026-10-17T00:00:00.000Z",
    ...extra,
  };
}

function install({ rows, orders, onPatch, onInsert, onCancelOrder, holdFinds = 0, role = "companion" }) {
  let finds = 0;
  let releaseFinds;
  const findsReady = new Promise((resolve) => {
    releaseFinds = resolve;
  });
  const posts = [];
  const cancels = [];
  globalThis.fetch = async (url, init = {}) => {
    const target = new URL(String(url));
    if (target.hostname !== "127.0.0.1") throw new Error("refused non-mock host");
    const method = String(init.method || "GET").toUpperCase();
    const body = init.body ? JSON.parse(init.body) : null;
    const send = (status, payload) => ({
      ok: status < 400,
      status,
      async text() {
        return JSON.stringify(payload);
      },
    });
    if (target.pathname === "/auth/v1/user") return send(200, { id: COMP });
    if (target.pathname === "/rest/v1/profiles") return send(200, [{ id: COMP, role, status: "active" }]);
    if (target.pathname === "/rest/v1/boss_notifications") return send(201, [{ id: "notice" }]);
    if (target.pathname === "/rest/v1/companion_appointments" && method === "GET") return send(200, rows.map((row) => ({ ...row })));
    if (target.pathname === "/rest/v1/orders" && method === "GET") {
      finds += 1;
      if (holdFinds && finds <= holdFinds) {
        if (finds === holdFinds) releaseFinds();
        else await findsReady;
      }
      const key = target.searchParams.get("idempotency_key")?.replace(/^eq\./, "");
      const or = target.searchParams.get("or") || "";
      const found = orders.filter((order) => {
        if (key) return order.idempotency_key === key;
        return or.includes(order.idempotency_key) || or.includes(encodeURIComponent(order.idempotency_key));
      });
      return send(200, found.map((order) => ({ ...order })));
    }
    if (target.pathname === "/rest/v1/orders" && method === "POST") {
      posts.push(body.idempotency_key);
      if (onInsert) {
        const blocked = await onInsert(body);
        if (blocked) return send(blocked.status, blocked.body);
      }
      const duplicate = orders.find((order) => order.idempotency_key === body.idempotency_key);
      if (duplicate) {
        return send(409, { code: "23505", message: "duplicate key value violates unique constraint orders_idempotency_key_uidx" });
      }
      const order = { id: `dddddddd-dddd-dddd-dddd-${String(orders.length + 1).padStart(12, "0")}`, ...body };
      orders.push(order);
      return send(201, [order]);
    }
    if (target.pathname === "/rest/v1/orders" && method === "PATCH") {
      if (onCancelOrder) {
        const blocked = await onCancelOrder();
        if (blocked) return send(blocked.status, blocked.body);
      }
      const id = target.searchParams.get("id")?.replace(/^eq\./, "");
      const status = target.searchParams.get("status")?.replace(/^eq\./, "");
      const orderType = target.searchParams.get("order_type")?.replace(/^eq\./, "");
      const order = orders.find((item) => item.id === id && item.status === status && item.order_type === orderType);
      if (!order || orderType !== "appointment" || status !== "awaiting_payment" || body?.status !== "cancelled") {
        return send(200, []);
      }
      cancels.push({ id, from: status, orderType, to: body.status });
      Object.assign(order, body);
      return send(200, [{ ...order }]);
    }
    if (target.pathname === "/rest/v1/companion_appointments" && method === "PATCH") {
      if (onPatch) {
        const blocked = await onPatch();
        if (blocked) return send(blocked.status, blocked.body);
      }
      const id = target.searchParams.get("id")?.replace(/^eq\./, "");
      const status = target.searchParams.get("status")?.replace(/^eq\./, "");
      const row = rows.find((item) => item.id === id && item.status === status);
      if (!row) return send(200, []);
      Object.assign(row, body);
      return send(200, [{ ...row }]);
    }
    throw new Error(`unexpected ${method} ${target.pathname}`);
  };
  return { posts, cancels };
}

async function accept(id, action = "accept") {
  const out = res();
  await handler(req(id, action), out);
  return out;
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  if (!ok) console.error("FAIL", name, detail);
}

{
  const rows = [appointment()];
  const orders = [];
  const mock = install({ rows, orders });
  const out = await accept(APPT);
  const order = orders[0];
  check(
    "first accept writes order_id",
    out.statusCode === 200 &&
      out.body?.ok === true &&
      out.body?.appointment?.status === "awaiting_payment" &&
      out.body?.appointment?.orderId === order?.id &&
      rows[0].status === "awaiting_payment" &&
      rows[0].order_id === order?.id &&
      order?.idempotency_key === `appt:${APPT}` &&
      order?.order_type === "appointment" &&
      mock.posts.length === 1,
    JSON.stringify({ status: out.statusCode, body: out.body, row: rows[0], posts: mock.posts.length })
  );
  const again = await accept(APPT);
  check(
    "repeat accept does not create a second order",
    again.statusCode === 409 && again.body?.ok === false && orders.length === 1 && mock.posts.length === 1 && rows[0].order_id === order.id,
    JSON.stringify({ status: again.statusCode, body: again.body, orders: orders.length, posts: mock.posts.length })
  );
}

{
  const rows = [appointment()];
  const orders = [];
  let patches = 0;
  const mock = install({
    rows,
    orders,
    onPatch() {
      patches += 1;
      if (patches === 1) return { status: 500, body: { message: "writeback failed" } };
      return null;
    },
  });
  const failed = await accept(APPT);
  check(
    "writeback failure is not accept success",
    failed.body?.ok !== true && rows[0].status === "pending" && rows[0].order_id == null && orders.length === 1 && mock.posts.length === 1,
    JSON.stringify({ status: failed.statusCode, body: failed.body, row: rows[0] })
  );
  const retried = await accept(APPT);
  check(
    "writeback retry reuses the idempotent order",
    retried.statusCode === 200 &&
      retried.body?.ok === true &&
      rows[0].order_id === orders[0].id &&
      rows[0].status === "awaiting_payment" &&
      orders.length === 1 &&
      mock.posts.length === 1,
    JSON.stringify({ status: retried.statusCode, body: retried.body, orders: orders.map((o) => o.id), posts: mock.posts })
  );
}

{
  const rows = [appointment()];
  const orders = [
    {
      id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
      status: "awaiting_payment",
      order_type: "standard",
      idempotency_key: "normal:1",
      companion_id: COMP,
      assignment_type: "public",
    },
  ];
  const mock = install({
    rows,
    orders,
    onInsert() {
      rows[0].status = "cancelled";
      return null;
    },
  });
  const out = await accept(APPT);
  const linked = orders.find((order) => order.idempotency_key === `appt:${APPT}`);
  const normal = orders.find((order) => order.idempotency_key === "normal:1");
  check(
    "concurrent cancel stops the appointment order",
    out.statusCode === 409 &&
      out.body?.ok === false &&
      rows[0].status === "cancelled" &&
      rows[0].order_id == null &&
      linked?.status === "cancelled" &&
      linked?.order_type === "appointment" &&
      normal?.status === "awaiting_payment" &&
      orders.length === 2 &&
      mock.posts.length === 1 &&
      mock.cancels.length === 1 &&
      mock.cancels[0].orderType === "appointment",
    JSON.stringify({ status: out.statusCode, body: out.body, row: rows[0], orders, cancels: mock.cancels })
  );
  const again = await accept(APPT);
  check(
    "accept after cancel does not create another order",
    again.body?.ok === false &&
      orders.filter((order) => order.idempotency_key === `appt:${APPT}`).length === 1 &&
      mock.posts.length === 1 &&
      rows[0].status === "cancelled" &&
      linked.status === "cancelled" &&
      normal.status === "awaiting_payment",
    JSON.stringify({ status: again.statusCode, body: again.body, posts: mock.posts.length, orders })
  );
}

{
  const rows = [appointment()];
  const orders = [];
  let cancelAttempts = 0;
  const mock = install({
    rows,
    orders,
    onInsert() {
      rows[0].status = "cancelled";
      return null;
    },
    onCancelOrder() {
      cancelAttempts += 1;
      if (cancelAttempts === 1) return { status: 200, body: [] };
      return null;
    },
  });
  const failed = await accept(APPT);
  check(
    "order cancel failure is not accept success",
    failed.body?.ok !== true &&
      rows[0].status === "cancelled" &&
      rows[0].order_id == null &&
      orders.length === 1 &&
      orders[0].status === "awaiting_payment" &&
      mock.posts.length === 1,
    JSON.stringify({ status: failed.statusCode, body: failed.body, orders, posts: mock.posts })
  );
  const retried = await accept(APPT);
  check(
    "cancel retry reuses the order and does not accept",
    retried.body?.ok !== true &&
      orders.length === 1 &&
      orders[0].status === "cancelled" &&
      mock.posts.length === 1 &&
      rows[0].status === "cancelled" &&
      rows[0].order_id == null,
    JSON.stringify({ status: retried.statusCode, body: retried.body, orders, posts: mock.posts })
  );
}

{
  const rows = [appointment()];
  const orders = [];
  const mock = install({ rows, orders, holdFinds: 2 });
  const [a, b] = await Promise.all([accept(APPT), accept(APPT)]);
  const linked = rows[0].order_id;
  const successes = [a, b].filter((item) => item.body?.ok === true);
  check(
    "parallel accept keeps one order",
    orders.length === 1 &&
      mock.posts.length === 2 &&
      successes.length === 1 &&
      linked === orders[0].id &&
      rows[0].status === "awaiting_payment" &&
      orders.every((order) => order.idempotency_key === `appt:${APPT}`),
    JSON.stringify({
      statuses: [a.statusCode, b.statusCode],
      oks: [a.body?.ok, b.body?.ok],
      orders: orders.length,
      posts: mock.posts,
      row: rows[0],
    })
  );
}

{
  const rows = [appointment()];
  const orders = [];
  install({
    rows,
    orders,
    onInsert() {
      return { status: 400, body: { code: "23514", message: "new row violates check constraint" } };
    },
  });
  const out = await accept(APPT);
  check(
    "order create failure is not accept success",
    out.body?.ok !== true && rows[0].status === "pending" && rows[0].order_id == null && orders.length === 0,
    JSON.stringify({ status: out.statusCode, body: out.body, row: rows[0] })
  );
}

{
  const rows = [appointment()];
  const orders = [];
  install({ rows, orders });
  const plain = await accept(APPT, "reject");
  check(
    "reject without an order does not create one",
    plain.statusCode === 200 && plain.body?.ok === true && rows[0].status === "rejected" && orders.length === 0,
    JSON.stringify({ status: plain.statusCode, body: plain.body, row: rows[0] })
  );
}

{
  const rows = [appointment()];
  const orders = [
    {
      id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
      status: "awaiting_payment",
      order_type: "standard",
      idempotency_key: "normal:1",
      companion_id: COMP,
      assignment_type: "public",
    },
  ];
  const mock = install({
    rows,
    orders,
    onInsert() {
      rows[0].status = "rejected";
      return null;
    },
  });
  const out = await accept(APPT);
  const linked = orders.find((order) => order.idempotency_key === `appt:${APPT}`);
  const normal = orders.find((order) => order.idempotency_key === "normal:1");
  check(
    "concurrent reject stops the appointment order",
    out.body?.ok !== true &&
      rows[0].status === "rejected" &&
      rows[0].order_id == null &&
      linked?.status === "cancelled" &&
      linked?.order_type === "appointment" &&
      normal?.status === "awaiting_payment" &&
      mock.posts.length === 1 &&
      mock.cancels.length === 1 &&
      mock.cancels[0].id === linked.id,
    JSON.stringify({ status: out.statusCode, body: out.body, row: rows[0], orders, cancels: mock.cancels })
  );
}

{
  const rows = [appointment()];
  const orders = [
    {
      id: "dddddddd-dddd-dddd-dddd-000000000009",
      status: "awaiting_payment",
      order_type: "appointment",
      idempotency_key: `appt:${APPT}`,
      companion_id: COMP,
      assignment_type: "assigned",
    },
    {
      id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
      status: "awaiting_payment",
      order_type: "standard",
      idempotency_key: "normal:1",
      companion_id: COMP,
      assignment_type: "public",
    },
  ];
  let cancelAttempts = 0;
  const mock = install({
    rows,
    orders,
    onCancelOrder() {
      cancelAttempts += 1;
      if (cancelAttempts === 1) return { status: 200, body: [] };
      return null;
    },
  });
  const failedReject = await accept(APPT, "reject");
  check(
    "reject cancel failure is not success",
    failedReject.body?.ok !== true &&
      rows[0].status === "rejected" &&
      orders.find((order) => order.idempotency_key === `appt:${APPT}`)?.status === "awaiting_payment" &&
      orders.find((order) => order.idempotency_key === "normal:1")?.status === "awaiting_payment" &&
      mock.posts.length === 0,
    JSON.stringify({ status: failedReject.statusCode, body: failedReject.body, orders })
  );
  const retried = await accept(APPT, "reject");
  check(
    "reject retry cancels the same order",
    retried.body?.ok !== true &&
      rows[0].status === "rejected" &&
      orders.find((order) => order.idempotency_key === `appt:${APPT}`)?.status === "cancelled" &&
      orders.find((order) => order.idempotency_key === "normal:1")?.status === "awaiting_payment" &&
      orders.filter((order) => order.idempotency_key === `appt:${APPT}`).length === 1 &&
      mock.posts.length === 0,
    JSON.stringify({ status: retried.statusCode, body: retried.body, orders, posts: mock.posts })
  );
}

function pastAppointment(status = "pending", extra = {}) {
  return appointment(status, {
    start_at: "2020-01-01T00:00:00.000Z",
    end_at: "2020-01-01T01:00:00.000Z",
    ...extra,
  });
}

function appointmentOrder(extra = {}) {
  return {
    id: "dddddddd-dddd-dddd-dddd-000000000001",
    status: "awaiting_payment",
    order_type: "appointment",
    idempotency_key: `appt:${APPT}`,
    companion_id: COMP,
    assignment_type: "assigned",
    ...extra,
  };
}

function normalOrder(extra = {}) {
  return {
    id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
    status: "awaiting_payment",
    order_type: "standard",
    idempotency_key: "normal:1",
    companion_id: COMP,
    assignment_type: "public",
    ...extra,
  };
}

async function listStaff() {
  const out = res();
  await handler(
    { method: "GET", headers: { authorization: "Bearer staff-test" }, query: { action: "staff" } },
    out
  );
  return out;
}

{
  const rows = [pastAppointment("pending", { order_id: "dddddddd-dddd-dddd-dddd-000000000001" })];
  const orders = [appointmentOrder(), normalOrder()];
  const mock = install({ rows, orders, role: "admin" });
  const out = await listStaff();
  const linked = orders.find((order) => order.idempotency_key === `appt:${APPT}`);
  const normal = orders.find((order) => order.idempotency_key === "normal:1");
  const shown = out.body?.appointments?.[0];
  check(
    "expire cancels the linked awaiting payment order",
    out.statusCode === 200 &&
      shown?.status === "expired" &&
      shown?.orderStatus === "cancelled" &&
      rows[0].status === "expired" &&
      linked?.status === "cancelled" &&
      linked?.order_type === "appointment" &&
      normal?.status === "awaiting_payment" &&
      mock.cancels.length === 1 &&
      mock.cancels[0].id === linked.id &&
      mock.posts.length === 0,
    JSON.stringify({ status: out.statusCode, body: out.body, row: rows[0], orders, cancels: mock.cancels })
  );
  const again = await listStaff();
  check(
    "repeat expire does not cancel another order",
    again.statusCode === 200 &&
      again.body?.appointments?.[0]?.status === "expired" &&
      rows[0].status === "expired" &&
      linked.status === "cancelled" &&
      normal.status === "awaiting_payment" &&
      orders.length === 2 &&
      mock.cancels.length === 1 &&
      mock.posts.length === 0,
    JSON.stringify({ status: again.statusCode, body: again.body, orders, cancels: mock.cancels })
  );
}

{
  const rows = [pastAppointment("confirmed", { order_id: "dddddddd-dddd-dddd-dddd-000000000001" })];
  const orders = [appointmentOrder(), normalOrder()];
  let cancelAttempts = 0;
  const mock = install({
    rows,
    orders,
    role: "admin",
    onCancelOrder() {
      cancelAttempts += 1;
      if (cancelAttempts === 1) return { status: 200, body: [] };
      return null;
    },
  });
  const failedExpire = await listStaff();
  const linked = orders.find((order) => order.idempotency_key === `appt:${APPT}`);
  const normal = orders.find((order) => order.idempotency_key === "normal:1");
  check(
    "expire cancel failure leaves the appointment unexpired",
    failedExpire.statusCode === 200 &&
      failedExpire.body?.appointments?.[0]?.status === "confirmed" &&
      failedExpire.body?.appointments?.[0]?.orderStatus === "awaiting_payment" &&
      rows[0].status === "confirmed" &&
      linked?.status === "awaiting_payment" &&
      normal?.status === "awaiting_payment" &&
      mock.posts.length === 0 &&
      mock.cancels.length === 0,
    JSON.stringify({ status: failedExpire.statusCode, body: failedExpire.body, row: rows[0], orders })
  );
  const retried = await listStaff();
  check(
    "expire retry cancels the same appointment order",
    retried.body?.appointments?.[0]?.status === "expired" &&
      retried.body?.appointments?.[0]?.orderId === linked.id &&
      rows[0].status === "expired" &&
      linked.status === "cancelled" &&
      normal.status === "awaiting_payment" &&
      orders.length === 2 &&
      mock.cancels.length === 1 &&
      mock.cancels[0].id === linked.id &&
      mock.posts.length === 0,
    JSON.stringify({ status: retried.statusCode, body: retried.body, orders, cancels: mock.cancels })
  );
}

{
  const rows = [pastAppointment("pending", { order_id: "ffffffff-ffff-ffff-ffff-ffffffffffff" })];
  const orders = [appointmentOrder(), normalOrder()];
  const mock = install({ rows, orders, role: "admin" });
  const out = await listStaff();
  check(
    "order link mismatch does not expire or cancel",
    out.body?.appointments?.[0]?.status === "pending" &&
      rows[0].status === "pending" &&
      orders.every((order) => order.status === "awaiting_payment") &&
      mock.cancels.length === 0 &&
      mock.posts.length === 0,
    JSON.stringify({ status: out.statusCode, body: out.body, row: rows[0], orders, cancels: mock.cancels })
  );
}

{
  const rows = [pastAppointment("pending")];
  const orders = [normalOrder()];
  const mock = install({ rows, orders, role: "admin" });
  const out = await listStaff();
  check(
    "expire without an appointment order leaves the normal order payable",
    out.body?.appointments?.[0]?.status === "expired" &&
      rows[0].status === "expired" &&
      orders[0].status === "awaiting_payment" &&
      orders[0].order_type === "standard" &&
      mock.cancels.length === 0 &&
      mock.posts.length === 0,
    JSON.stringify({ status: out.statusCode, body: out.body, orders, cancels: mock.cancels })
  );
}

{
  const rows = [pastAppointment("expired", { order_id: "dddddddd-dddd-dddd-dddd-000000000001" })];
  const orders = [appointmentOrder(), normalOrder()];
  const mock = install({ rows, orders, role: "admin" });
  const out = await listStaff();
  const linked = orders.find((order) => order.idempotency_key === `appt:${APPT}`);
  check(
    "already expired appointment retries the payable order cancel",
    out.body?.appointments?.[0]?.status === "expired" &&
      out.body?.appointments?.[0]?.orderStatus === "cancelled" &&
      rows[0].status === "expired" &&
      linked?.status === "cancelled" &&
      orders.find((order) => order.order_type === "standard")?.status === "awaiting_payment" &&
      mock.cancels.length === 1 &&
      mock.posts.length === 0,
    JSON.stringify({ status: out.statusCode, body: out.body, orders, cancels: mock.cancels })
  );
}

{
  const rows = [pastAppointment("confirmed", { order_id: "dddddddd-dddd-dddd-dddd-000000000001" })];
  const orders = [appointmentOrder({ status: "confirmed" }), normalOrder()];
  const mock = install({ rows, orders, role: "admin" });
  const out = await listStaff();
  check(
    "expire does not cancel an appointment order past awaiting payment",
    out.body?.appointments?.[0]?.status === "expired" &&
      rows[0].status === "expired" &&
      orders[0].status === "confirmed" &&
      orders[1].status === "awaiting_payment" &&
      mock.cancels.length === 0,
    JSON.stringify({ status: out.statusCode, body: out.body, orders, cancels: mock.cancels })
  );
}

{
  const rows = [pastAppointment("pending", { order_id: "dddddddd-dddd-dddd-dddd-000000000001" })];
  const orders = [appointmentOrder(), normalOrder()];
  const mock = install({ rows, orders, role: "admin" });
  await Promise.all([listStaff(), listStaff()]);
  const linked = orders.find((order) => order.idempotency_key === `appt:${APPT}`);
  check(
    "parallel expire cancels one appointment order",
    rows[0].status === "expired" &&
      linked?.status === "cancelled" &&
      orders.find((order) => order.order_type === "standard")?.status === "awaiting_payment" &&
      orders.filter((order) => order.idempotency_key === `appt:${APPT}`).length === 1 &&
      mock.cancels.length === 1 &&
      mock.posts.length === 0,
    JSON.stringify({ row: rows[0], orders, cancels: mock.cancels })
  );
}

check(
  "refund guard ignores a normal order",
  appointmentRefundBlocked({ id: "order", order_type: "standard", status: "refund_requested" }) == null &&
    appointmentRefundBlocked({ id: "order", orderType: "appointment" })?.status === 409,
  ""
);

{
  const CS = "11111111-1111-1111-1111-111111111111";
  const ORDER = "22222222-2222-2222-2222-222222222222";
  const { default: serviceHandler } = await import("../server/api/customer-service.js");
  function installRefund(order) {
    const writes = [];
    globalThis.fetch = async (url, init = {}) => {
      const target = new URL(String(url));
      if (target.hostname !== "127.0.0.1") throw new Error("refused non-mock host");
      const method = String(init.method || "GET").toUpperCase();
      const send = (status, payload) => ({
        ok: status < 400,
        status,
        async text() {
          return JSON.stringify(payload);
        },
      });
      if (method !== "GET") {
        writes.push({ method, path: target.pathname, body: init.body ? JSON.parse(init.body) : null });
        return send(500, { message: "unexpected write" });
      }
      if (target.pathname === "/auth/v1/user") return send(200, { id: CS });
      if (target.pathname === "/rest/v1/profiles") return send(200, [{ id: CS, role: "customer_service", status: "active" }]);
      if (target.pathname === "/rest/v1/orders") return send(200, [{ ...order }]);
      return send(200, []);
    };
    return { writes };
  }
  async function refund(orderId, note) {
    const out = res();
    await serviceHandler(
      {
        method: "POST",
        headers: { authorization: "Bearer service-test" },
        body: { action: "refund_decision", id: orderId, decision: "approve", note },
      },
      out
    );
    return out;
  }
  const appointmentWrites = installRefund({
    id: ORDER,
    status: "refund_requested",
    order_type: "appointment",
    idempotency_key: `appt:${APPT}`,
    boss_id: BOSS,
    companion_id: COMP,
    total_amount: 10,
  });
  const first = await refund(ORDER, "重复退款");
  const second = await refund(ORDER, "重复退款");
  check(
    "repeat appointment refund does not write",
    first.statusCode === 409 &&
      first.body?.ok === false &&
      second.statusCode === 409 &&
      second.body?.ok === false &&
      first.body?.message === second.body?.message &&
      appointmentWrites.writes.length === 0,
    JSON.stringify({ first: first.body, second: second.body, writes: appointmentWrites.writes })
  );
  const normalWrites = installRefund({
    id: ORDER,
    status: "refund_requested",
    order_type: "standard",
    idempotency_key: "normal:1",
    boss_id: BOSS,
    companion_id: COMP,
    total_amount: 10,
  });
  const normal = await refund(ORDER, "");
  check(
    "normal refund request is not blocked as an appointment",
    normal.statusCode === 400 &&
      normal.body?.ok === false &&
      normal.body?.message !== first.body?.message &&
      /备注/.test(String(normal.body?.message || "")) &&
      normalWrites.writes.length === 0,
    JSON.stringify({ status: normal.statusCode, body: normal.body, writes: normalWrites.writes })
  );
}

const failed = results.filter((item) => !item.ok);
console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length, results }, null, 2));
if (failed.length) process.exit(1);
