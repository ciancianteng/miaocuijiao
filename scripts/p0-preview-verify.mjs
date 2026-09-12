import fs from "node:fs";

const BASE =
  process.env.PREVIEW_URL ||
  "https://meow-cuijiao-homepage-b1vkjh5rv-ciancianteng-4581s-projects.vercel.app";
const PASS = process.env.TEST_PASS || "McjTest@12345678";

function loadEnv() {
  try {
    for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
      if (!line || line.startsWith("#") || !line.includes("=")) continue;
      const i = line.indexOf("=");
      const k = line.slice(0, i).trim();
      const v = line
        .slice(i + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
      if (k && v && !process.env[k]) process.env[k] = v;
    }
  } catch {}
}

async function supabaseLogin(email) {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  const r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASS }),
  });
  const b = await r.json();
  if (!b.access_token) throw new Error(`${email} auth failed: ${JSON.stringify(b)}`);
  return { token: b.access_token, userId: b.user?.id };
}

async function api(path, token, { method = "GET", body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { res, data, ok: res.ok && data.ok !== false };
}

async function main() {
  loadEnv();
  const steps = [];
  const log = (step, ok, detail) => {
    steps.push({ step, ok, detail });
    console.log(`${ok ? "OK" : "FAIL"} ${step}`, detail);
  };

  const boss = await supabaseLogin("boss@meow.test");
  log("boss-login", true, boss.userId);
  const csLogin = await api("/api/customer-service", null, {
    method: "POST",
    body: { action: "login", account: "service@meow.test", password: PASS },
  });
  // login endpoints don't need auth header
  const csRes = await fetch(`${BASE}/api/customer-service`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ action: "login", account: "service@meow.test", password: PASS }),
  });
  const csBody = await csRes.json();
  if (!csBody.session?.token) throw new Error("cs login failed " + JSON.stringify(csBody));
  const csToken = csBody.session.token;
  log("cs-login", true, "ok");

  const cA = await fetch(`${BASE}/api/companion`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "login", account: "companion@meow.test", password: PASS }),
  }).then((r) => r.json());
  if (!cA.session?.token) throw new Error("companion A login failed " + JSON.stringify(cA));
  const aToken = cA.session.token;
  const aId = cA.session.user?.id || cA.session.user?.userId;
  log("companion-a-login", true, aId);

  // Companion B: try existing or register
  let bToken = "";
  let bId = "";
  const bEmail = "companion-b@meow.test";
  const bLogin = await fetch(`${BASE}/api/companion`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "login", account: bEmail, password: PASS }),
  }).then((r) => r.json());
  if (bLogin.session?.token) {
    bToken = bLogin.session.token;
    bId = bLogin.session.user?.id;
  } else {
    const reg = await fetch(`${BASE}/api/companion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "register",
        email: bEmail,
        password: PASS,
        nickname: "陪玩B验收",
        remember: true,
      }),
    }).then((r) => r.json());
    if (!reg.session?.token) {
      log("companion-b-register", false, reg);
    } else {
      bToken = reg.session.token;
      bId = reg.session.user?.id;
      log("companion-b-register", true, bId);
    }
  }
  if (bToken) log("companion-b-login", true, bId);

  // Approve companion B for grab hall (verification_status=approved + online).
  if (bId) {
    try {
      const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      await fetch(`${url}/rest/v1/companion_profiles?user_id=eq.${encodeURIComponent(bId)}`, {
        method: "PATCH",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          verification_status: "approved",
          online_status: "online",
          updated_at: new Date().toISOString(),
        }),
      });
      log("companion-b-approve", true, "approved");
    } catch (e) {
      log("companion-b-approve", false, String(e.message || e));
    }
  }

  const create = await api("/api/orders", boss.token, {
    method: "POST",
    body: {
      action: "create",
      game: "P0抢单验收",
      title: "P0公开抢单测试",
      description: "自动化验收公开抢单订单",
      hours: 1,
      unit_price: 30,
      total_amount: 30,
      order_type: "custom",
      paymentMethod: "preview_test",
    },
  });
  const order = create.data?.order;
  if (!order?.id) {
    log("create-order", false, create.data);
    process.exit(1);
  }
  log("create-order", true, { id: order.id, no: order.orderNo, status: order.status });

  const csBoot = await api("/api/customer-service?action=bootstrap", csToken);
  const convs = csBoot.data?.data?.conversations || [];
  const related = convs.find((c) => c.orderId === order.id);
  log("cs-order-conversation", !!related, related?.id || "missing");

  const pay = await api("/api/orders", boss.token, {
    method: "POST",
    body: { action: "pay_order", id: order.id, paymentMethod: "preview_test", preview_test: "1" },
  });
  log("pay-order", pay.ok, { status: pay.data?.order?.status, msg: pay.data?.message });

  await api("/api/companion", aToken, {
    method: "POST",
    body: { action: "set_online_status", online_status: "online" },
  });
  if (bToken) {
    await api("/api/companion", bToken, {
      method: "POST",
      body: { action: "set_online_status", online_status: "online" },
    });
  }

  const grabA = await api("/api/companion", aToken, {
    method: "POST",
    body: { action: "accept_order", id: order.id },
  });
  log("grab-a", grabA.ok, grabA.data?.message);

  let grabB = { ok: false, data: { message: "no B" } };
  if (bToken) {
    grabB = await api("/api/companion", bToken, {
      method: "POST",
      body: { action: "accept_order", id: order.id },
    });
    log("grab-b", grabB.ok, grabB.data?.message);
  }

  const grabs = await api("/api/orders", boss.token, {
    method: "POST",
    body: { action: "list_grabs", id: order.id },
  });
  const grabCount = (grabs.data?.grabs || []).length;
  log("list-grabs", grabs.ok && grabCount >= 1, { count: grabCount });

  const select = await api("/api/orders", boss.token, {
    method: "POST",
    body: { action: "confirm_companion", id: order.id, companion_id: aId || grabs.data?.grabs?.[0]?.companionId },
  });
  log("boss-select-a", select.ok, { status: select.data?.order?.status, msg: select.data?.message });

  const start = await api("/api/companion", aToken, {
    method: "POST",
    body: { action: "start_order", id: order.id },
  });
  log("start-order", start.ok, { status: start.data?.order?.status, msg: start.data?.message });

  const complete = await api("/api/companion", aToken, {
    method: "POST",
    body: { action: "complete_order", id: order.id },
  });
  log("complete-request", complete.ok, {
    awaiting: complete.data?.awaitingBossConfirm,
    status: complete.data?.order?.status,
    msg: complete.data?.message,
  });

  const done = await api("/api/orders", boss.token, {
    method: "POST",
    body: { action: "confirm_completion", id: order.id },
  });
  log("boss-confirm-complete", done.ok, { status: done.data?.order?.status, msg: done.data?.message });

  const pass = steps.every((s) => s.ok);
  console.log(
    JSON.stringify(
      {
        pass,
        preview: BASE,
        orderId: order.id,
        orderNo: order.orderNo,
        companionA: "companion@meow.test",
        companionB: bToken ? bEmail : "(unavailable)",
        steps,
      },
      null,
      2
    )
  );
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
