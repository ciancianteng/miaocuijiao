/**
 * P0-3 Preview E2E (uses README_DEPLOY §6 boss@meow.test).
 * Usage: node scripts/p03-e2e.mjs <preview-base-url>
 */
const BASE = (process.argv[2] || "").replace(/\/$/, "");
if (!BASE) {
  console.error("Usage: node scripts/p03-e2e.mjs <preview-url>");
  process.exit(2);
}
const EMAIL = "boss@meow.test";
const PASS = "McjTest@12345678";
const results = [];
function step(name, ok, detail) {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "") });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
}
async function jfetch(path, init = {}) {
  const res = await fetch(BASE + path, init);
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  return { res, body, text };
}

(async () => {
  const home = await fetch(BASE + "/");
  const homeHtml = await home.text();
  step("1 Home open", home.ok, `status=${home.status}`);
  step(
    "1b Home entries / no apply·功能开发中",
    /更多玩法/.test(homeHtml) && /组队大厅/.test(homeHtml) && !/申请成为陪玩 · 功能开发中/.test(homeHtml),
    "entries checked"
  );

  const { body: companions } = await jfetch("/api/public/companions");
  const comp = (companions.companions || []).find((c) => /TEST|验收/.test(c.name || ""));
  step(
    "2 Hall TEST companion",
    !!(comp && comp.priceValue > 0 && comp.availabilityStatus === "online"),
    `id=${comp?.id} name=${comp?.name} price=${comp?.priceValue} game=${comp?.game}`
  );

  const profile = await fetch(BASE + `/profile.html?player=${encodeURIComponent(comp?.id || "")}`);
  step("3 Profile detail", profile.ok, `status=${profile.status}`);

  const { body: gp } = await jfetch("/api/platform/gameplay-products");
  step("4 More gameplays", !!(gp.ok && (gp.products || []).length), `count=${(gp.products || []).length} name=${gp.products?.[0]?.name}`);

  const { body: team } = await jfetch("/api/platform/content?types=team_lobby_channels");
  const ch = (team.byType?.team_lobby_channels || [])[0];
  const url = ch?.draft?.discordUrl || ch?.published?.discordUrl;
  step("5 Team lobby clickable", !!(ch && url), `name=${ch?.name} url=${url}`);

  const hall = await fetch(BASE + "/companion-center.html");
  const hallHtml = await hall.text();
  step("6 No 申请成为陪玩·功能开发中", hall.ok && !/申请成为陪玩 · 功能开发中/.test(hallHtml), "hall html");

  const payPage = await fetch(BASE + "/payment-confirm.html");
  step("7 payment-confirm page", payPage.ok, `status=${payPage.status}`);

  const { body: auth } = await jfetch("/api/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "login", email: EMAIL, password: PASS, loginPortal: "boss" }),
  });
  const token = auth?.session?.accessToken || auth?.accessToken || "";
  step("8 Boss login", !!(auth?.ok && token), `ok=${auth?.ok}`);

  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" };
  const { body: list0 } = await jfetch("/api/orders", { headers });
  step("9 Orders list API", list0?.ok === true && Array.isArray(list0.orders), `count=${(list0.orders || []).length}`);

  const { body: orderRes, res: orderHttp } = await jfetch("/api/orders", {
    method: "POST",
    headers,
    body: JSON.stringify({
      action: "place_order",
      companionId: comp.id,
      companionName: comp.name,
      serviceType: "陪玩",
      service: "陪玩",
      game: "VALORANT",
      unitPrice: Number(comp.priceValue),
      hours: 1,
      quantity: 1,
      totalAmount: Number(comp.priceValue),
      gameId: "P03-E2E-GID",
      paymentMethod: "tng",
      notes: "P0-3 E2E",
      idempotencyKey: "p03e2e-" + Date.now(),
    }),
  });
  const oid = orderRes?.order?.id;
  step("10 place_order create", !!(orderRes?.ok && oid), `http=${orderHttp.status} id=${oid} status=${orderRes?.order?.status}`);

  const { body: one } = await jfetch("/api/orders?id=" + encodeURIComponent(oid || ""), { headers });
  const ord = (one.orders || [])[0];
  let gid = ord?.gameId || "";
  if (!gid && /游戏ID[：:]\s*([^\n]+)/.test(ord?.description || "")) gid = RegExp.$1.trim();
  step(
    "11 payment-confirm fields",
    !!(ord && ord.hours === 1 && gid === "P03-E2E-GID" && ord.totalAmount > 0),
    `companion=${ord?.companionName}; service=${ord?.serviceType}; hours=${ord?.hours}; gameId=${gid}; amount=${ord?.totalAmount}`
  );

  const { body: list1 } = await jfetch("/api/orders", { headers });
  const found = (list1.orders || []).some((o) => o.id === oid);
  step("12 New order in list", found, `orders=${(list1.orders || []).length}`);

  const { body: custom } = await jfetch("/api/orders", {
    method: "POST",
    headers,
    body: JSON.stringify({
      action: "create",
      order: {
        title: "P0-3自定义验收",
        game: "VALORANT",
        game_id: "CUSTOM-GID",
        description: "自定义需求\n游戏ID：CUSTOM-GID",
        hours: 1,
        unit_price: 20,
        total_amount: 20,
        order_type: "custom",
      },
    }),
  });
  step("13 Custom order create", !!(custom?.ok && custom?.order?.id), `id=${custom?.order?.id}`);

  console.log("\n=== P0-3 E2E SUMMARY ===");
  for (const r of results) console.log(`${r.result}\t${r.step}\t${r.detail}`);
  const fail = results.filter((r) => r.result === "FAIL").length;
  const pass = results.filter((r) => r.result === "PASS").length;
  console.log(`PASS=${pass} FAIL=${fail}`);
  console.log(`PREVIEW=${BASE}`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
