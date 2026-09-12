/**
 * Verify conversation lock scope: order/consult scoped, not permanent account lock.
 * Usage: node scripts/verify-conversation-lock-scope.mjs
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
for (const f of [".env.local", ".env"]) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m || process.env[m[1]]) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const BASE = process.env.STAGING_BASE || "https://meow-cuijiao-homepage-staging.vercel.app";
const PASSWORD = "McjTest@12345678";
const BOSS = "boss.final.1785714993009@meow.test";
const COMPANION = "companion.idcard.1785715257525@meow.test";
const CS_A = "service.final.1785714993009@meow.test";

async function login(email, password, roleHint) {
  const url =
    roleHint === "cs"
      ? `${BASE}/api/customer-service`
      : roleHint === "companion"
        ? `${BASE}/api/companion`
        : `${BASE}/api/auth`;
  const body =
    roleHint === "cs"
      ? { action: "login", email, password }
      : roleHint === "companion"
        ? { action: "login", email, password }
        : { action: "login", email, password };
  // Try CS login first shape
  if (roleHint === "cs") {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await res.json();
    if (!j.ok) throw new Error(`CS login fail: ${j.message}`);
    return { token: j.session.token, profile: j.session.user };
  }
  if (roleHint === "companion") {
    const res = await fetch(`${BASE}/api/companion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "login", email, password }),
    });
    const j = await res.json();
    if (!j.ok) throw new Error(`Companion login fail: ${j.message}`);
    return { token: j.session?.token || j.token, profile: j.session?.user || j.profile };
  }
  // boss via supabase password through /api/chat identity — use auth endpoint if present
  const res = await fetch(`${BASE}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "login", email, password }),
  });
  const j = await res.json().catch(() => ({}));
  if (j.ok && (j.session?.token || j.token)) {
    return { token: j.session?.token || j.token, profile: j.session?.user || j.user };
  }
  // Fallback: supabase anon password grant
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  const auth = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const a = await auth.json();
  if (!a.access_token) throw new Error(`Boss login fail: ${a.error_description || a.msg || auth.status}`);
  return { token: a.access_token, profile: a.user };
}

async function findSecondCs(csAToken, csAId) {
  const res = await fetch(`${BASE}/api/customer-service`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${csAToken}` },
    body: JSON.stringify({ action: "bootstrap" }),
  });
  const j = await res.json();
  // Look for another CS via admin is hard; try known pattern emails via supabase list is not available.
  // Probe common second account.
  const candidates = [
    "service.final.1785714993010@meow.test",
    "service.second.1785714993009@meow.test",
    "cs.second@meow.test",
    "service2@meow.test",
  ];
  for (const email of candidates) {
    try {
      const s = await login(email, PASSWORD, "cs");
      if (s.profile?.id && s.profile.id !== csAId) return { email, ...s };
    } catch (_) {}
  }
  return null;
}

async function bossOpen(token, { orderId = "", consultType = "other", forceNew = false } = {}) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      action: forceNew ? "reopen" : "open",
      forceNew,
      order_id: orderId || undefined,
      consult_type: consultType,
    }),
  });
  const j = await res.json();
  if (!j.ok) throw new Error(`boss open: ${j.message}`);
  return j.conversation;
}

async function csTake(token, conversationId) {
  const res = await fetch(`${BASE}/api/customer-service`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action: "take_conversation", id: conversationId }),
  });
  return res.json();
}

async function companionSend(token, { content, consultType, forceNew, orderId } = {}) {
  const res = await fetch(`${BASE}/api/companion`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      action: "send_cs_message",
      content: content || `lock-verify ${Date.now()}`,
      consult_type: consultType || "other",
      forceNew: !!forceNew,
      order_id: orderId || undefined,
    }),
  });
  return res.json();
}

async function csRelease(token, conversationId) {
  const res = await fetch(`${BASE}/api/customer-service`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action: "release_conversation", id: conversationId }),
  });
  return res.json();
}

async function csClockOut(token) {
  const res = await fetch(`${BASE}/api/customer-service`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action: "clock_out" }),
  });
  return res.json();
}

async function csClockIn(token) {
  const res = await fetch(`${BASE}/api/customer-service`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action: "clock_in" }),
  });
  return res.json();
}

const out = { base: BASE, cases: {} };

try {
  const boss = await login(BOSS, PASSWORD, "boss");
  const companion = await login(COMPANION, PASSWORD, "companion");
  const csA = await login(CS_A, PASSWORD, "cs");
  await csClockIn(csA.token).catch(() => null);
  let csB = await findSecondCs(csA.token, csA.profile.id);
  if (!csB) {
    // Create synthetic second CS path: use force via same account won't work.
    // Fall back: release to pool and re-take as "CSB simulation" using another login attempt from admin list.
    console.warn("No second CS account found; Case1/2 will verify NEW conversation goes to waiting pool (claimable).");
  } else {
    await csClockIn(csB.token).catch(() => null);
  }

  // Case 1: Boss OrderA → CSA; Boss OrderB/consult B → CSB can accept (or waiting pool)
  const convA = await bossOpen(boss.token, { consultType: "recharge", forceNew: true });
  const takeA = await csTake(csA.token, convA.id);
  const convB = await bossOpen(boss.token, { consultType: "refund", forceNew: true });
  const sameId = String(convA.id) === String(convB.id);
  let takeB;
  if (csB) {
    takeB = await csTake(csB.token, convB.id);
  } else {
    // Same CSA should NOT be required — pool should allow claim because different conversation
    takeB = await csTake(csA.token, convB.id);
    // Then verify they are different conversations (lock not shared)
  }
  out.cases.case1 = {
    pass: !sameId && takeA.ok && takeB.ok && String(convA.id) !== String(convB.id),
    convA: convA.id,
    convB: convB.id,
    sameConversation: sameId,
    takeA: takeA.ok ? "ok" : takeA.message,
    takeB: takeB.ok ? "ok" : takeB.message,
    note: "Boss different consult_type → different conversation_id; both claimable",
  };

  // Case 2: Companion OrderA/consult → CSA; new consult → new waiting → CSB
  const send1 = await companionSend(companion.token, {
    content: `case2-a ${Date.now()}`,
    consultType: "order_dock",
    forceNew: true,
  });
  const cid1 = send1.conversationId;
  const takeC1 = cid1 ? await csTake(csA.token, cid1) : { ok: false, message: "no cid1" };
  const send2 = await companionSend(companion.token, {
    content: `case2-b ${Date.now()}`,
    consultType: "withdraw",
    forceNew: true,
  });
  const cid2 = send2.conversationId;
  const sameComp = String(cid1) === String(cid2);
  let takeC2;
  if (csB) takeC2 = await csTake(csB.token, cid2);
  else takeC2 = await csTake(csA.token, cid2);
  out.cases.case2 = {
    pass: !!cid1 && !!cid2 && !sameComp && takeC1.ok && takeC2.ok,
    cid1,
    cid2,
    sameConversation: sameComp,
    takeC1: takeC1.ok ? "ok" : takeC1.message,
    takeC2: takeC2.ok ? "ok" : takeC2.message,
    note: "Companion different consult_type → new conversation in pool",
  };

  // Case 3: CSA off-duty / release → pending_transfer → CSB take over
  const convT = await bossOpen(boss.token, { consultType: "other", forceNew: true });
  await csTake(csA.token, convT.id);
  const released = await csRelease(csA.token, convT.id);
  let takeOver;
  if (csB) takeOver = await csTake(csB.token, convT.id);
  else {
    // Re-clock: release then same CS can re-take from pool (proves unlock)
    takeOver = await csTake(csA.token, convT.id);
  }
  out.cases.case3 = {
    pass: released.ok && takeOver.ok,
    conversationId: convT.id,
    released: released.ok ? "ok" : released.message,
    userTip: released.userTip || "",
    takeOver: takeOver.ok ? "ok" : takeOver.message,
    note: "Release → pending_transfer/waiting → other (or same) CS can accept; history preserved on same id",
  };

  // End owned sessions to avoid leaving test noise locked
  for (const id of [convA.id, convB.id, cid1, cid2, convT.id].filter(Boolean)) {
    try {
      await fetch(`${BASE}/api/customer-service`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${csA.token}` },
        body: JSON.stringify({ action: "end_conversation", id }),
      });
    } catch (_) {}
    if (csB) {
      try {
        await fetch(`${BASE}/api/customer-service`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${csB.token}` },
          body: JSON.stringify({ action: "end_conversation", id }),
        });
      } catch (_) {}
    }
  }
} catch (err) {
  out.error = String(err?.message || err);
}

console.log(JSON.stringify(out, null, 2));
fs.writeFileSync(path.join(ROOT, "scripts/verify-conversation-lock-scope-results.json"), JSON.stringify(out, null, 2));
const allPass = out.cases?.case1?.pass && out.cases?.case2?.pass && out.cases?.case3?.pass;
process.exit(allPass ? 0 : 1);
