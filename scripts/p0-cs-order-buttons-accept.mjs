/**
 * Accept: CS order action buttons are status-scoped; illegal jumps blocked.
 * Usage: node scripts/p0-cs-order-buttons-accept.mjs
 */
const BASE = process.env.MCJ_BASE || "https://meow-cuijiao-homepage-staging.vercel.app";
const PASS = process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const CS = process.env.MCJ_CS_EMAIL || "service.final.1785714993009@meow.test";
const BOSS = process.env.MCJ_BOSS_EMAIL || "boss.final.1785714993009@meow.test";

const results = [];
function ok(name, pass, detail = "") {
  results.push({ name, pass: !!pass, detail: String(detail || "") });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

async function api(path, token, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "x-mcj-service-token": token,
      "x-mcj-access-token": token,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok && json.ok !== false, body: json };
}

async function main() {
  console.log("BASE", BASE);
  const csLogin = await api("/api/customer-service", "", {
    action: "login",
    account: CS,
    password: PASS,
  });
  // login uses empty token path - re-call without auth helper
  const loginRes = await fetch(`${BASE}/api/customer-service`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ action: "login", account: CS, password: PASS }),
  }).then((r) => r.json());
  const csT = loginRes.session?.token || "";
  ok("CS login", !!csT, loginRes.message || "");

  const boot = await api("/api/customer-service", csT, { action: "bootstrap" });
  ok("bootstrap has compensationPolicy", !!boot.body.data?.compensationPolicy, JSON.stringify(boot.body.data?.compensationPolicy || {}));
  ok(
    "compensation only for in_progress/completed",
    Array.isArray(boot.body.data?.compensationPolicy?.allowedOrderStatuses) &&
      boot.body.data.compensationPolicy.allowedOrderStatuses.includes("in_progress") &&
      boot.body.data.compensationPolicy.allowedOrderStatuses.includes("completed") &&
      !boot.body.data.compensationPolicy.allowedOrderStatuses.includes("awaiting_payment"),
    JSON.stringify(boot.body.data?.compensationPolicy?.allowedOrderStatuses || [])
  );

  const bossId = boot.body.data?.bosses?.[0]?.id;
  ok("has boss", !!bossId, bossId || "");

  const created = await api("/api/customer-service", csT, {
    action: "create_order",
    boss_id: bossId,
    companion_id: "",
    game: "VALORANT",
    order_type: "open_grab",
    description: `btn accept ${Date.now()}`,
    hours: 1,
    unit_price: 35,
    total_amount: 35,
    send_to_hall: false,
  });
  const oid = created.body.order?.id;
  ok("create awaiting_payment", !!oid && created.body.order?.status === "awaiting_payment", created.body.order?.status);

  const illegal = await api("/api/customer-service", csT, {
    action: "update_order_status",
    id: oid,
    status: "completed",
  });
  ok(
    "block awaiting_payment → completed",
    !illegal.ok && /不允许|不能/.test(String(illegal.body.message || "")),
    illegal.body.message || String(illegal.status)
  );

  const confirm = await api("/api/customer-service", csT, { action: "confirm_payment", id: oid });
  ok(
    "confirm → grab hall pending",
    confirm.ok && confirm.body.order?.status === "pending" && confirm.body.sentToGrabHall === true,
    `${confirm.body.order?.status} / ${confirm.body.message}`
  );

  // Static source checks (deployed bundle may lag; verify repo source for UI contract)
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../src/customer-service-v2.js", import.meta.url), "utf8");
  ok("no always-on 申请补偿 in orderRow", !/actions\.push\('<button class="cs-btn"[^>]*申请补偿/.test(src));
  ok("status switch has awaiting_payment branch", /st==='awaiting_payment'/.test(src));
  ok("status switch has claimed 催单", /催单/.test(src) && /data-urge-companion/.test(src));
  ok("status switch has return grab hall", /返回抢单大厅/.test(src));
  ok("no generic 改状态 always button", !/if\(o\.status!=='claimed'&&!inGrabHall\)actions\.push\('<button class="cs-btn" data-status-order=/.test(src));
  ok("button tones present", /\.cs-btn\.warn/.test(fs.readFileSync(new URL("../src/customer-service-v2.css", import.meta.url), "utf8")));

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
}

main().catch((err) => {
  console.error("FATAL", err.message || err);
  process.exit(1);
});
