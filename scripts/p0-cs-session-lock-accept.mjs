/**
 * P0 accept: order-scoped CS session lock / transfer / readonly.
 * Usage: node scripts/p0-cs-session-lock-accept.mjs
 */
const BASE = process.env.MCJ_BASE || "https://meow-cuijiao-homepage-staging.vercel.app";
const PASS = process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const CS_A = process.env.MCJ_CS_EMAIL || "service.final.1785714993009@meow.test";
const BOSS = process.env.MCJ_BOSS_EMAIL || "boss.final.1785714993009@meow.test";
const ADMIN = process.env.MCJ_ADMIN_EMAIL || "admin@meow.test";

const results = [];
function ok(name, pass, detail = "") {
  results.push({ name, pass: !!pass, detail: String(detail || "") });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

async function api(path, token, body, headers = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: body == null ? "GET" : "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(token
        ? {
            Authorization: `Bearer ${token}`,
            "x-mcj-access-token": token,
            "x-mcj-service-token": token,
            "x-mcj-admin-token": token,
          }
        : {}),
      ...headers,
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok && json.ok !== false, body: json };
}

async function loginCs(email) {
  const r = await api("/api/customer-service", "", { action: "login", account: email, password: PASS, remember: true });
  const token = r.body.session?.token || r.body.session?.accessToken || "";
  if (!token) throw new Error(`CS login fail ${email}: ${r.body.message || r.status}`);
  return { token, user: r.body.session?.user || {} };
}

async function loginBoss() {
  const r = await api("/api/auth", "", { action: "login", email: BOSS, password: PASS, role: "boss" });
  const token = r.body.session?.accessToken || r.body.session?.token || "";
  if (!token) throw new Error(`Boss login fail: ${r.body.message || r.status}`);
  return { token, user: r.body.session?.user || {} };
}

async function loginAdmin() {
  const r = await api("/api/auth", "", { action: "login", email: ADMIN, password: PASS });
  const token = r.body.session?.accessToken || r.body.session?.token || "";
  if (!token) throw new Error(`Admin login fail: ${r.body.message || r.status}`);
  return { token, user: r.body.session?.user || {} };
}

async function ensureCsB(adminToken) {
  const email = `service.lock.${Date.now()}@meow.test`;
  const created = await api(
    "/api/admin/service-accounts",
    adminToken,
    {
      action: "create",
      email,
      password: PASS,
      display_name: "Lock验收客服B",
      name: "Lock验收客服B",
    },
    { "x-mcj-admin-role": "admin" }
  );
  if (!created.ok) {
    throw new Error(`create CS B failed: ${created.body.message || created.status}`);
  }
  // wait for auth propagation
  for (let i = 0; i < 6; i++) {
    try {
      return { ...(await loginCs(email)), email };
    } catch (_) {
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  return { ...(await loginCs(email)), email };
}

async function main() {
  console.log("BASE", BASE);
  const a = await loginCs(CS_A);
  const boss = await loginBoss();
  let admin;
  try {
    admin = await loginAdmin();
  } catch (err) {
    console.warn("admin login skipped", err.message);
  }
  let b;
  if (admin?.token) {
    try {
      b = await ensureCsB(admin.token);
    } catch (err) {
      console.warn("create CS B failed", err.message);
    }
  }
  if (!b) {
    // Try known second accounts
    for (const email of ["service@meow.test", "service2@meow.test"]) {
      try {
        b = { ...(await loginCs(email)), email };
        if (b.user?.id && b.user.id !== a.user?.id) break;
        b = null;
      } catch (_) {}
    }
  }
  ok("CS A login", !!a.token, a.user?.id || "");
  ok("CS B login", !!b?.token, b?.email || "missing second CS");
  if (!b?.token) {
    console.log("\nCannot continue without CS B");
    process.exit(1);
  }

  // Boss opens a new general consult (force new)
  const open = await api("/api/chat", boss.token, {
    action: "open",
    forceNew: true,
    consult_type: "other",
  });
  const convId = open.body.conversation?.id || open.body.conversationId;
  ok("boss new conversation", !!convId, convId || open.body.message);

  // A claims
  const takeA = await api(
    "/api/customer-service",
    a.token,
    { action: "take_conversation", id: convId },
    { "x-mcj-service-token": a.token }
  );
  ok("A start reception", takeA.ok, takeA.body.message);

  // B cannot send
  const sendB = await api(
    "/api/customer-service",
    b.token,
    { action: "send_message", conversation_id: convId, content: "B should fail" },
    { "x-mcj-service-token": b.token }
  );
  ok(
    "B cannot send (API)",
    !sendB.ok && /没有操作权限|其他客服|负责/.test(String(sendB.body.message || "")),
    sendB.body.message || String(sendB.status)
  );

  // B can list/view messages
  const listB = await api(
    "/api/customer-service",
    b.token,
    { action: "list_messages", id: convId },
    { "x-mcj-service-token": b.token }
  );
  ok("B can view messages", listB.ok === true, listB.body.message || `locked=${listB.body.locked}`);

  // B mark_read must not clear (skipped)
  const readB = await api(
    "/api/customer-service",
    b.token,
    { action: "mark_read", id: convId },
    { "x-mcj-service-token": b.token }
  );
  ok("B mark_read skipped", readB.ok && readB.body.skipped === true, JSON.stringify({ skipped: readB.body.skipped }));

  // A can send
  const sendA = await api(
    "/api/customer-service",
    a.token,
    { action: "send_message", conversation_id: convId, content: `A lock ok ${Date.now()}` },
    { "x-mcj-service-token": a.token }
  );
  ok("A can send", sendA.ok, sendA.body.message);

  // A re-login still owns
  const a2 = await loginCs(CS_A);
  const sendA2 = await api(
    "/api/customer-service",
    a2.token,
    { action: "send_message", conversation_id: convId, content: "A after relogin" },
    { "x-mcj-service-token": a2.token }
  );
  ok("A keeps ownership after relogin", sendA2.ok, sendA2.body.message);

  // Transfer A → B
  const transfer = await api(
    "/api/customer-service",
    a.token,
    { action: "transfer_to_cs", id: convId, target_cs_id: b.user.id },
    { "x-mcj-service-token": a.token }
  );
  ok("A transfer to B", transfer.ok, transfer.body.message);

  const sendAAfter = await api(
    "/api/customer-service",
    a.token,
    { action: "send_message", conversation_id: convId, content: "A after transfer should fail" },
    { "x-mcj-service-token": a.token }
  );
  ok("A readonly after transfer", !sendAAfter.ok, sendAAfter.body.message);

  const sendBAfter = await api(
    "/api/customer-service",
    b.token,
    { action: "send_message", conversation_id: convId, content: "B after transfer ok" },
    { "x-mcj-service-token": b.token }
  );
  ok("B can send after transfer", sendBAfter.ok, sendBAfter.body.message);

  // Admin takeover back to A (if admin API works)
  if (admin?.token) {
    const takeover = await api(
      "/api/admin/messages",
      admin.token,
      { action: "take-over", conversationId: convId, target_cs_id: a.user.id },
      { "x-mcj-admin-role": "admin" }
    );
    ok("admin takeover", takeover.ok, takeover.body.message);
    const sendA3 = await api(
      "/api/customer-service",
      a.token,
      { action: "send_message", conversation_id: convId, content: "A after admin takeover" },
      { "x-mcj-service-token": a.token }
    );
    ok("A can send after admin takeover", sendA3.ok, sendA3.body.message);
    const sendB3 = await api(
      "/api/customer-service",
      b.token,
      { action: "send_message", conversation_id: convId, content: "B blocked after takeover" },
      { "x-mcj-service-token": b.token }
    );
    ok("B blocked after admin takeover", !sendB3.ok, sendB3.body.message);
  } else {
    ok("admin takeover", false, "admin login unavailable");
    ok("A can send after admin takeover", false, "skipped");
    ok("B blocked after admin takeover", false, "skipped");
  }

  // New boss conversation independent lock
  const open2 = await api("/api/chat", boss.token, {
    action: "open",
    forceNew: true,
    consult_type: "recharge",
  });
  const conv2 = open2.body.conversation?.id || open2.body.conversationId;
  ok("boss second conversation", !!conv2 && conv2 !== convId, conv2 || open2.body.message);
  const takeB2 = await api(
    "/api/customer-service",
    b.token,
    { action: "take_conversation", id: conv2 },
    { "x-mcj-service-token": b.token }
  );
  ok("B can claim new conversation while A owns old", takeB2.ok, takeB2.body.message);

  // End conversation → readonly
  const end = await api(
    "/api/customer-service",
    b.token,
    { action: "end_conversation", id: conv2 },
    { "x-mcj-service-token": b.token }
  );
  ok("end conversation", end.ok, end.body.message);
  const sendEnded = await api(
    "/api/customer-service",
    b.token,
    { action: "send_message", conversation_id: conv2, content: "should fail ended" },
    { "x-mcj-service-token": b.token }
  );
  ok("ended is readonly", !sendEnded.ok, sendEnded.body.message);

  // Pool release forbidden for normal CS
  const pool = await api(
    "/api/customer-service",
    a.token,
    { action: "release_conversation", id: convId },
    { "x-mcj-service-token": a.token }
  );
  ok(
    "no unlock-all via pool release",
    !pool.ok && /必须选择目标客服|不允许解除/.test(String(pool.body.message || "")),
    pool.body.message || String(pool.status)
  );

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
}

main().catch((err) => {
  console.error("FATAL", err.message || err);
  process.exit(1);
});
