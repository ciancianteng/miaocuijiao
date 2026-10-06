/** Read-only Staging probe: admin payment channels / banks vs boss order + recharge method lists. */
import { assertSmokeTargetAllowed } from "../../scripts/lib/prod-guard.mjs";

const BASE = "https://meow-cuijiao-homepage-staging.vercel.app";
assertSmokeTargetAllowed({ base: BASE, script: "pay-channel-alipay-probe" });
const PASS = process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";

function tok(j) {
  return j?.session?.accessToken || j?.session?.token || j?.accessToken || j?.token || "";
}
async function api(path, token, body, method = "POST") {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: method === "GET" || body == null ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

const info = await fetch(`${BASE}/api/build-info`).then((r) => r.json()).catch(() => ({}));
console.log("build-info", JSON.stringify(info).slice(0, 300));

const a = await api("/api/auth", null, { action: "login", email: "admin@meow.test", password: PASS, loginPortal: "admin" });
const at = tok(a.json);
const s = await api("/api/admin/payment-settings", at, null, "GET");
console.log("admin status", s.status);
console.log(
  "channels",
  (s.json.channels || []).map((c) => `${c.channel_id || c.id}:${c.enabled ? "on" : "off"}:${c.config_status}`).join(" | ")
);
console.log(
  "banks",
  (s.json.banks || []).map((b) => `${b.id}:${b.bank_name}:${b.enabled ? "on" : "off"}:${b.usage}:qr=${!!b.qrImageUrl}`).join(" | ")
);
console.log("bossOrderMethods", JSON.stringify(s.json.bossOrderMethods), "bossRechargeMethods", JSON.stringify(s.json.bossRechargeMethods));

const b = await api("/api/auth", null, { action: "login", email: "boss@meow.test", password: PASS });
const bt = tok(b.json);
const r = await api("/api/recharge", bt, null, "GET");
console.log("recharge status", r.status, "methods", (r.json.methods || r.json.paymentMethods || []).map((m) => `${m.code}:${m.name}:${m.open}`).join(" | "));
for (const path of ["/api/orders?action=payment_methods", "/api/orders?view=payment_methods", "/api/payment-methods"]) {
  const o = await api(path, bt, null, "GET");
  const list = o.json.methods || o.json.paymentMethods || [];
  console.log(path, o.status, list.map((m) => `${m.code}:${m.name || m.label}`).join(" | ") || JSON.stringify(o.json).slice(0, 160));
}
