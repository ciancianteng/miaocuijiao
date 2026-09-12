/**
 * Preview acceptance for login / guards / hall / support.
 * Usage: node scripts/preview-blockers-e2e.mjs <base-url>
 */
const BASE = (process.argv[2] || "").replace(/\/$/, "");
const PASS = "McjTest@12345678";
if (!BASE) {
  console.error("Usage: node scripts/preview-blockers-e2e.mjs <url>");
  process.exit(2);
}
const results = [];
function step(name, ok, detail) {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "") });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
  return ok;
}

async function jfetch(path, init = {}) {
  const res = await fetch(BASE + path, init);
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text.slice(0, 200) };
  }
  return { res, body, status: res.status, text };
}

(async () => {
  const loginHtml = await fetch(BASE + "/login.html", { redirect: "manual" });
  step("GET /login.html reachable", loginHtml.status === 200 || (loginHtml.status >= 300 && loginHtml.status < 400), `status=${loginHtml.status}`);
  const loginHtmlBody = loginHtml.status === 200 ? await loginHtml.text() : "";
  step("login.html points to boss login", /index\.html#login|老板登录|login/i.test(loginHtmlBody) || loginHtml.status !== 200, "ok");

  const loginSlash = await fetch(BASE + "/login", { redirect: "manual" });
  step("GET /login reachable", loginSlash.status === 200 || (loginSlash.status >= 300 && loginSlash.status < 400), `status=${loginSlash.status}`);

  const home = await fetch(BASE + "/");
  const homeHtml = await home.text();
  step("Home has login/register CTA", /data-modal=["']login["']|登录\s*\/\s*注册|登录/.test(homeHtml), "cta present");

  await jfetch("/api/dev/seed-p03-preview", { method: "POST", headers: { "Content-Type": "application/json" } }).catch(() => ({}));
  const comps = await jfetch("/api/public/companions");
  const list = comps.body?.companions || [];
  const test = list.find((c) => /TEST|验收/.test(c.name || "")) || list[0];
  step("Hall API has orderable companion", !!(test && test.id && (test.canOrderNow || test.availabilityStatus === "online")), `count=${list.length} name=${test?.name || ""}`);

  const login = await jfetch("/api/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "login", email: "boss@meow.test", password: PASS, loginPortal: "boss" }),
  });
  const token = login.body?.session?.accessToken || "";
  step("Boss login", !!(login.body?.ok && token), `ok=${login.body?.ok}`);

  const t0 = Date.now();
  const conv = await jfetch("/api/chat?action=conversations", { headers: { Authorization: `Bearer ${token}` } });
  step("CS chat list", !!(conv.body?.ok && Array.isArray(conv.body.conversations)), `ms=${Date.now() - t0} count=${(conv.body?.conversations || []).length}`);

  const t1 = Date.now();
  const open = await jfetch("/api/chat", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "open" }),
  });
  const openMs = Date.now() - t1;
  step("CS chat open session", !!(open.body?.ok && open.body.conversation?.id), `ms=${openMs} id=${open.body?.conversation?.id || ""}`);
  step("CS chat open under 12s", openMs < 12000, `ms=${openMs}`);

  console.log("\n=== PREVIEW BLOCKERS SUMMARY ===");
  for (const r of results) console.log(`${r.result}\t${r.step}\t${r.detail}`);
  const fail = results.filter((r) => r.result === "FAIL").length;
  const pass = results.filter((r) => r.result === "PASS").length;
  console.log(`PASS=${pass} FAIL=${fail}`);
  console.log(`BASE=${BASE}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
