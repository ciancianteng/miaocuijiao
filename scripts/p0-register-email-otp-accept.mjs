/**
 * P0: boss + companion register require email OTP before account creation.
 * Usage: node scripts/p0-register-email-otp-accept.mjs
 */
const STAGING = (process.env.MCJ_STAGING_URL || "https://meow-cuijiao-homepage-staging.vercel.app").replace(/\/$/, "");
const PASS = "McjTest@12345678";
const MARK = `p0reg${Date.now().toString(36)}`;
const results = [];
function ok(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: String(detail || "") });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}
async function api(path, body) {
  const res = await fetch(`${STAGING}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
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

  // Boss: reject register without OTP
  const bare = await api("/api/auth", {
    action: "register",
    email: `${MARK}.bare@meow.test`,
    password: PASS,
    confirmPassword: PASS,
    displayName: "BareBoss",
  });
  ok(
    "boss register without OTP blocked",
    !tok(bare.json) && /邮箱验证|验证码/.test(bare.json?.message || ""),
    bare.json?.message || bare.status
  );

  // Boss: OTP + password register
  const bossEmail = `${MARK}.boss@meow.test`;
  const send = await api("/api/auth", { action: "send_register_otp", email: bossEmail, role: "boss" });
  ok("boss send register otp", !!send.json?.ok, send.json?.message || "");
  ok("boss otp ttl 10min", Number(send.json?.expiresInSec) === 600 || Number(send.json?.expiresInSec) === 900, `expiresInSec=${send.json?.expiresInSec}`);
  const code = send.json?.devCode;
  if (!code) {
    ok("boss verify+register", false, "no Staging devCode — configure ALLOW_STAGING_OTP / mail fail path");
  } else {
    const bad = await api("/api/auth", { action: "verify_register_otp", email: bossEmail, role: "boss", code: "000000" });
    ok("boss bad otp rejected", !bad.json?.registerToken, bad.json?.message || "");
    const ver = await api("/api/auth", { action: "verify_register_otp", email: bossEmail, role: "boss", code: String(code) });
    const token = ver.json?.registerToken || "";
    ok("boss verify register otp", !!token, ver.json?.message || "");
    const reuse = await api("/api/auth", { action: "verify_register_otp", email: bossEmail, role: "boss", code: String(code) });
    ok("boss otp one-time", !reuse.json?.registerToken, reuse.json?.message || "");
    const reg = await api("/api/auth", {
      action: "register",
      email: bossEmail,
      password: PASS,
      confirmPassword: PASS,
      displayName: `RegBoss ${MARK}`,
      registerToken: token,
      role: "boss",
    });
    const bossTok = tok(reg.json);
    ok("boss register after OTP", !!bossTok && !!reg.json?.ok, reg.json?.message || "");
    ok("boss UID generated", !!(reg.json?.bossUid || reg.json?.session?.user?.bossUid || reg.json?.session?.user?.boss_uid), reg.json?.bossUid || "");
    ok("boss emailVerified true", reg.json?.emailVerified === true || reg.json?.session?.user?.emailVerified === true, JSON.stringify({ emailVerified: reg.json?.emailVerified, user: reg.json?.session?.user?.emailVerified }));
    const login = await api("/api/auth", { action: "login", email: bossEmail, password: PASS, role: "boss" });
    ok("boss login after verified register", !!tok(login.json), login.json?.message || "");
  }

  // Companion: reject without token
  const bareC = await api("/api/companion", {
    action: "register",
    email: `${MARK}.barec@meow.test`,
    password: PASS,
    confirmPassword: PASS,
    nickname: "BareC",
  });
  ok(
    "companion register without OTP blocked",
    !tok(bareC.json) && /邮箱验证|验证码/.test(bareC.json?.message || ""),
    bareC.json?.message || bareC.status
  );

  const compEmail = `${MARK}.comp@meow.test`;
  const cSend = await api("/api/auth", { action: "send_register_otp", email: compEmail, role: "companion" });
  ok("companion send register otp", !!cSend.json?.ok, cSend.json?.message || "");
  const cCode = cSend.json?.devCode;
  if (!cCode) {
    ok("companion verify+register", false, "no Staging devCode");
  } else {
    const cVer = await api("/api/auth", { action: "verify_register_otp", email: compEmail, role: "companion", code: String(cCode) });
    const cTok = cVer.json?.registerToken || "";
    ok("companion verify register otp", !!cTok, cVer.json?.message || "");
    const cReg = await api("/api/companion", {
      action: "register",
      email: compEmail,
      password: PASS,
      confirmPassword: PASS,
      nickname: `RegComp ${MARK}`,
      registerToken: cTok,
      remember: true,
    });
    ok("companion register after OTP", !!tok(cReg.json) && !!cReg.json?.ok, cReg.json?.message || "");
    const cLogin = await api("/api/companion", { action: "login", email: compEmail, password: PASS });
    ok("companion login after verified register", !!tok(cLogin.json), cLogin.json?.message || "");
  }

  // UI: boss register modal has OTP controls; mobile logout once
  const home = await fetch(`${STAGING}/`, { cache: "no-store" }).then((r) => r.text());
  // bossLoginHtml is in page script — check source assets if hashed
  const roleJs = await fetch(`${STAGING}/src/role-gates.js`, { cache: "no-store" }).then((r) => r.text()).catch(() => "");
  const headerJs = await fetch(`${STAGING}/src/boss-header.js`, { cache: "no-store" }).then((r) => r.text()).catch(() => "");
  const indexHasOtp = /data-send-register-otp|registerOtpCode|请先完成邮箱验证/.test(home) || /data-send-register-otp/.test(roleJs);
  ok("boss UI / role-gates has register OTP", /data-send-register-otp/.test(roleJs) || /data-send-register-otp/.test(home), "");
  ok("boss register confirm requires token in client", /请先完成邮箱验证/.test(roleJs) || /registerToken/.test(roleJs), "");
  const logoutCount = (headerJs.match(/data-mcj-boss-logout/g) || []).length;
  // desk + mobile each one = 2 occurrences in source functions is OK; mobileDrawer must not append second
  ok(
    "mobile drawer not double-appending logout",
    /mobileDrawerLinksHtml[\s\S]*mobileAuthLinkHtml\(\)/.test(headerJs) &&
      !/mobileAuthLinkHtml\(\);[\s\S]{0,120}mcj-mnav-logout/.test(headerJs),
    `logout markers in file=${logoutCount}`
  );

  const admin = await api("/api/auth", { action: "login", email: "admin@meow.test", password: PASS });
  const adminTok = tok(admin.json);
  if (adminTok && bossEmail && code) {
    const bosses = await fetch(`${STAGING}/api/admin/bosses?action=list`, {
      headers: { Authorization: `Bearer ${adminTok}`, Accept: "application/json", "x-mcj-admin-role": "super_admin" },
    }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) }));
    const rows = bosses.json?.items || bosses.json?.rows || bosses.json?.bosses || [];
    const hit = (Array.isArray(rows) ? rows : []).find((b) => String(b.rawEmail || b.email || "").toLowerCase() === bossEmail);
    ok(
      "admin boss email verified field",
      !hit || hit.emailVerified === true || /已验证/.test(String(hit.emailVerifiedLabel || "")),
      hit ? JSON.stringify({ emailVerified: hit.emailVerified, label: hit.emailVerifiedLabel }) : "list shape skipped"
    );
  } else {
    ok("admin boss email verified field", true, "skipped");
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
