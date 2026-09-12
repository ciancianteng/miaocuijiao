/**
 * BUG-001 regression: CS create_order must use real UUIDs, never blow up on numeric IDs.
 * Usage: node scripts/bug001-cs-create-order.mjs [BASE_URL]
 */
const BASE = process.argv[2] || process.env.PREVIEW_URL || "http://127.0.0.1:5173";
const PASS = "McjTest@12345678";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let pass = 0;
let fail = 0;
function ok(name, cond, detail) {
  if (cond) {
    pass += 1;
    console.log("PASS", name);
  } else {
    fail += 1;
    console.log("FAIL", name, detail || "");
  }
}

async function api(action, body, token) {
  const res = await fetch(`${BASE}/api/customer-service`, {
    method: "POST",
    headers: Object.assign(
      { "Content-Type": "application/json", Accept: "application/json" },
      token ? { Authorization: `Bearer ${token}` } : {}
    ),
    body: JSON.stringify(Object.assign({ action }, body || {})),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json, text };
}

async function main() {
  console.log("BASE", BASE);
  const login = await api("login", { account: "service@meow.test", password: PASS });
  ok("cs login", login.json?.ok && login.json?.session?.token, login.text?.slice(0, 200));
  const token = login.json?.session?.token;
  if (!token) {
    console.log(`PASS=${pass} FAIL=${fail}`);
    process.exit(1);
  }

  const boot = await fetch(`${BASE}/api/customer-service`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const bootJson = await boot.json();
  const bosses = bootJson?.data?.bosses || [];
  const companions = bootJson?.data?.companions || [];
  const boss = bosses[0];
  const companion = companions[0];
  ok("bootstrap bosses", bosses.length > 0, `count=${bosses.length}`);
  ok("boss id is uuid", UUID_RE.test(String(boss?.id || "")), boss?.id);
  ok(
    "companion ids are uuid",
    companions.every((c) => UUID_RE.test(String(c.id || ""))),
    companions.slice(0, 2).map((c) => c.id)
  );

  const numeric = await api(
    "create_order",
    {
      order: {
        boss_id: "100001",
        game: "VALORANT",
        description: "numeric-id probe",
        hours: 1,
        unit_price: 35,
        total_amount: 35,
      },
    },
    token
  );
  ok(
    "numeric boss_id no uuid syntax crash",
    numeric.status !== 500 && !/invalid input syntax for type uuid/i.test(numeric.text || ""),
    numeric.text?.slice(0, 240)
  );

  const badComp = await api(
    "create_order",
    {
      order: {
        boss_id: boss.id,
        companion_id: "12345",
        game: "VALORANT",
        description: "bad companion probe",
        hours: 1,
        unit_price: 35,
        total_amount: 35,
      },
    },
    token
  );
  ok(
    "numeric companion_id no uuid syntax crash",
    badComp.status !== 500 && !/invalid input syntax for type uuid/i.test(badComp.text || ""),
    badComp.text?.slice(0, 240)
  );

  const create = await api(
    "create_order",
    {
      order: {
        boss_id: boss.id,
        companion_id: companion?.id || null,
        game: "VALORANT",
        description: "uuid create regression " + Date.now(),
        hours: 1,
        unit_price: 35,
        total_amount: 35,
      },
    },
    token
  );
  ok("create_order with uuid succeeds", create.status === 200 && create.json?.ok, create.text?.slice(0, 300));
  ok(
    "created order has uuid ids",
    UUID_RE.test(String(create.json?.order?.id || "")) &&
      UUID_RE.test(String(create.json?.order?.boss_id || "")),
    create.json?.order
  );
  if (companion?.id) {
    ok(
      "created companion_id is uuid",
      !create.json?.order?.companion_id || UUID_RE.test(String(create.json.order.companion_id)),
      create.json?.order?.companion_id
    );
  }

  console.log(`PASS=${pass} FAIL=${fail}`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
