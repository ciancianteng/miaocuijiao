/**
 * P0: boss login/register session survives portal-early-gate on protected pages.
 * Usage: node scripts/p0-boss-session-persist-accept.mjs
 */
const STAGING = (process.env.MCJ_STAGING_URL || "https://meow-cuijiao-homepage-staging.vercel.app").replace(/\/$/, "");
const PASS = "McjTest@12345678";
const MARK = `p0sess${Date.now().toString(36)}`;
const results = [];
function ok(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: String(detail || "") });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}
async function api(path, body, token) {
  const res = await fetch(`${STAGING}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body || {}),
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}
function tok(j) {
  return j?.session?.accessToken || j?.session?.access_token || j?.session?.token || "";
}

(async () => {
  console.log("BASE", STAGING);

  const gateJs = await fetch(`${STAGING}/portal-early-gate.js?v=20260805bossSessionDual1`, { cache: "no-store" }).then((r) =>
    r.text()
  );
  ok(
    "early gate does not delete localStorage boss JWT",
    /bossSessionDual1|NEVER delete localStorage/.test(gateJs) && !/never revive localStorage JWT/.test(gateJs),
    `len=${gateJs.length}`
  );
  ok(
    "early gate reads both stores for bossItem",
    /sessionStorage\.getItem\(key\)\s*\|\|\s*localStorage\.getItem\(key\)/.test(gateJs),
    ""
  );

  const roleJs = await fetch(`${STAGING}/src/role-gates.js`, { cache: "no-store" }).then((r) => r.text());
  ok("role-gates dual-writes session+local", /stores = rememberMe \? \[sessionStorage, localStorage\]/.test(roleJs), "");
  ok("afterAuthSuccess waits for sessionReadable", /sessionReadable\(/.test(roleJs) && /正在登录/.test(roleJs), "");

  const bossAuthJs = await fetch(`${STAGING}/src/boss-auth-session.js?v=20260805bossSessionDual1`, { cache: "no-store" }).then((r) => r.text());
  ok(
    "boss-auth-session dual-write",
    /Dual-write when remember/.test(bossAuthJs) || /stores = persist === false \? \[sessionStorage\] : \[sessionStorage, localStorage\]/.test(bossAuthJs),
    `len=${bossAuthJs.length}`
  );

  // Fresh register → me → protected page gate HTML still loads (not login bounce for API)
  const email = `${MARK}@meow.test`;
  const send = await api("/api/auth", { action: "send_register_otp", email, role: "boss" });
  const code = send.json?.devCode;
  ok("send register otp", !!code || !!send.json?.ok, send.json?.message || "");
  if (!code) {
    console.log("\n0/skipped remaining — no Staging OTP");
    process.exit(1);
  }
  const ver = await api("/api/auth", { action: "verify_register_otp", email, role: "boss", code: String(code) });
  const registerToken = ver.json?.registerToken || "";
  const reg = await api("/api/auth", {
    action: "register",
    email,
    password: PASS,
    confirmPassword: PASS,
    displayName: `SessBoss ${MARK}`,
    registerToken,
    role: "boss",
  });
  const access = tok(reg.json);
  ok("register+auto login session", !!access, reg.json?.message || "");
  ok("boss UID present", !!(reg.json?.bossUid || reg.json?.session?.user?.bossUid), reg.json?.bossUid || "");

  const me = await fetch(`${STAGING}/api/auth?action=me`, {
    headers: { Authorization: `Bearer ${access}`, Accept: "application/json" },
    cache: "no-store",
  }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) }));
  ok("me succeeds with session (profile exists or auto-created)", me.json?.ok === true && !!me.json?.user?.id, me.json?.message || me.status);
  ok("me does not force logout code", me.json?.code !== "EMAIL_NOT_VERIFIED" || me.json?.ok, me.json?.code || "");

  // Protected pages should include early-gate that allows dual-store JWT (static check)
  const mine = await fetch(`${STAGING}/mine.html`, { cache: "no-store", redirect: "manual" }).then(async (r) => ({
    status: r.status,
    loc: r.headers.get("location") || "",
    text: await r.text(),
  }));
  ok("mine.html not server-redirected to login", mine.status < 300 || mine.status === 200, `status=${mine.status} loc=${mine.loc}`);
  ok("mine.html loads new early-gate", /portal-early-gate\.js\?v=20260805bossSessionDual1/.test(mine.text), "");

  // Companion dual-write soft tokens (clearSession may still removeItem — that's OK)
  const pwJs = await fetch(`${STAGING}/src/companion-workbench.js?v=20260806confirmComplete2`, { cache: "no-store" }).then((r) => r.text());
  ok(
    "companion mirrors soft auth into sessionStorage",
    /sessionStorage\.setItem\(['"]companionAuthToken['"]/.test(pwJs) &&
      /sessionStorage\.setItem\(['"]mcjAuthAccessToken['"]/.test(pwJs),
    ""
  );

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
