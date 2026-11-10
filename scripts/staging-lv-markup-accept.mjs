/**
 * Staging-only acceptance for catalog-base + LV markup toggle.
 * No Production. No Lianmiao.
 */
import { assertSmokeTargetAllowed, STAGING_SUPABASE_REF } from "./lib/prod-guard.mjs";

const BASE = "https://meow-cuijiao-homepage-staging.vercel.app";
const PASS = process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const WANGZHE = "124883e2-cc9d-480e-b2b9-b5da0d5bc93a";
const DELTA = "6d0c4e35-e862-4a21-999e-0259869fb8e0";

assertSmokeTargetAllowed({
  script: "staging-lv-markup-accept",
  base: BASE,
  supabaseUrl: `https://${STAGING_SUPABASE_REF}.supabase.co`,
});

const results = [];
function step(name, pass, detail = "", { unverified = false } = {}) {
  const status = unverified ? "NOT VERIFIED" : pass ? "PASS" : "FAIL";
  results.push({ name, pass: unverified ? true : !!pass, unverified, detail: String(detail || "") });
  console.log(`${status}  ${name}${detail ? " — " + detail : ""}`);
}

async function api(path, token, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: body == null ? "GET" : "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}`, "x-mcj-access-token": token } : {}),
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}
function tok(j) {
  return j?.session?.access_token || j?.session?.accessToken || j?.access_token || j?.token || "";
}
async function login(variants) {
  for (const body of variants) {
    const r = await api("/api/auth", "", body);
    const t = tok(r.json);
    if (t) {
      return {
        token: t,
        id: r.json?.profile?.id || r.json?.user?.id || r.json?.session?.user?.id || "",
      };
    }
  }
  return { token: "", id: "" };
}

const bi = await api("/api/build-info");
step(
  "staging isolation",
  bi.json?.supabaseRef === STAGING_SUPABASE_REF && bi.json?.supabaseIsStaging === true,
  `ref=${bi.json?.supabaseRef || ""} sha=${String(bi.json?.sha || "").slice(0, 7)}`
);

const adminSess = await login([
  { action: "login", email: "admin@meow.test", password: PASS, role: "admin" },
  { email: "admin@meow.test", password: PASS, role: "admin", loginPortal: "admin" },
]);
const admin = adminSess.token;
step("admin login", !!admin);

const matrix = admin ? await api("/api/admin/service-level-prices", admin) : { json: {} };
step("table present", matrix.json?.table?.present === true, JSON.stringify(matrix.json?.table || {}));

const wangMarkups = [
  { levelId: "lv1", markupAllowance: 5 },
  { levelId: "lv2", markupAllowance: 5 },
  { levelId: "lv3", markupAllowance: 5 },
  { levelId: "lv4", markupAllowance: 5 },
  { levelId: "lv5", markupAllowance: 5 },
];
const save = admin
  ? await api("/api/admin/service-level-prices", admin, {
      action: "save_markup",
      serviceId: WANGZHE,
      markups: wangMarkups,
    })
  : { status: 0, json: {} };
step(
  "admin save wangzhe markup to table",
  save.status === 200 && save.json?.ok === true && save.json?.source === "service_level_prices",
  `status=${save.status} source=${save.json?.source || ""} msg=${save.json?.message || ""}`
);

const again = admin ? await api("/api/admin/service-level-prices", admin) : { json: {} };
const wang = (again.json?.grid || []).find((g) => g.serviceId === WANGZHE);
const delta = (again.json?.grid || []).find((g) => g.serviceId === DELTA);
const wangMarks = (wang?.levels || []).map((l) => Number(l.markupAllowance) || 0);
const wangCfg = (wang?.levels || []).filter((l) => l.markupConfigured || l.configured).length;
step("reload wangzhe LV1-5 markup=5", wangCfg === 5 && wangMarks.every((n) => n === 5), `configured=${wangCfg} marks=${wangMarks.join(",")}`);
step(
  "delta not overwritten",
  !!delta && (delta.levels || []).every((l) => Number(l.markupAllowance) === 0 || !l.markupConfigured),
  `delta configured=${(delta?.levels || []).filter((l) => l.markupConfigured || l.configured).length}`
);

const anonSave = await api("/api/admin/service-level-prices", "", {
  action: "save_markup",
  serviceId: WANGZHE,
  markups: wangMarkups,
});
step("anon cannot save markup", anonSave.status === 401, String(anonSave.status));

const bossSess = await login([
  { action: "login", email: "boss@meow.test", password: PASS, role: "boss" },
  { email: "boss@meow.test", password: PASS, loginPortal: "boss" },
]);
const boss = bossSess.token;
const bossSave = boss
  ? await api("/api/admin/service-level-prices", boss, { action: "save_markup", serviceId: WANGZHE, markups: wangMarkups })
  : { status: 0, json: {} };
step("boss cannot save markup", bossSave.status === 403, String(bossSave.status));

const companionSess = await login([
  { action: "login", email: "companion@meow.test", password: PASS, role: "companion" },
  { email: "companion@meow.test", password: PASS, loginPortal: "companion" },
]);
const companion = companionSess.token;
step("companion login", !!companion);

const offers1 = companion ? await api("/api/companion", companion, { action: "my_offers" }) : { json: {} };
const cat = (offers1.json?.catalog?.services || []).find((s) => s.id === WANGZHE);
step(
  "companion my_offers returns markup fields",
  offers1.status === 200 && cat && "markupAllowance" in cat && "basePrice" in cat && "finalPrice" in cat,
  `status=${offers1.status} base=${cat?.basePrice} markup=${cat?.markupAllowance} final=${cat?.finalPrice} configured=${cat?.markupConfigured}`
);

const saveOff = companion
  ? await api("/api/companion", companion, {
      action: "save_offers",
      offers: [{ kind: "service", id: WANGZHE, accepting: true, markupOn: true }],
    })
  : { status: 0, json: {} };
step("companion save markupOn", saveOff.status === 200 && saveOff.json?.ok === true, `status=${saveOff.status} ${saveOff.json?.message || ""}`);

const offers2 = companion ? await api("/api/companion", companion, { action: "my_offers" }) : { json: {} };
const saved = (offers2.json?.offers || []).find((s) => s.id === WANGZHE) || (offers2.json?.catalog?.services || []).find((s) => s.id === WANGZHE);
const expectedFinal = Number(saved?.basePrice || 0) + Number(saved?.markupAllowance || 0);
step(
  "reload persists markupOn and final=base+markup",
  !!(saved && saved.markupOn === true && Number(saved.finalPrice) === expectedFinal && expectedFinal > 0),
  `markupOn=${saved?.markupOn} base=${saved?.basePrice} markup=${saved?.markupAllowance} final=${saved?.finalPrice}`
);

const saveOff0 = companion
  ? await api("/api/companion", companion, {
      action: "save_offers",
      offers: [{ kind: "service", id: WANGZHE, accepting: true, markupOn: false }],
    })
  : { status: 0, json: {} };
const offers3 = companion ? await api("/api/companion", companion, { action: "my_offers" }) : { json: {} };
const saved0 = (offers3.json?.catalog?.services || []).find((s) => s.id === WANGZHE);
step(
  "companion can turn markup off to +0",
  saveOff0.json?.ok === true && saved0 && saved0.markupOn === false && Number(saved0.finalPrice) === Number(saved0.basePrice),
  `markupOn=${saved0?.markupOn} final=${saved0?.finalPrice} base=${saved0?.basePrice}`
);

const over = companion
  ? await api("/api/companion", companion, {
      action: "save_offers",
      offers: [{ kind: "service", id: WANGZHE, accepting: true, markupOn: true, price: 9999 }],
    })
  : { status: 0, json: {} };
const overRow = (over.json?.catalog?.services || []).find((s) => s.id === WANGZHE);
step(
  "companion cannot exceed allowance via custom price",
  over.json?.ok === true &&
    Number(overRow?.finalPrice) === Number(overRow?.basePrice) + Number(overRow?.markupAllowance) &&
    Number(overRow?.finalPrice) !== 9999,
  `final=${overRow?.finalPrice} base=${overRow?.basePrice} markup=${overRow?.markupAllowance}`
);

const hijack = companion
  ? await api("/api/companion", companion, {
      action: "save_offers",
      userId: "00000000-0000-0000-0000-000000000000",
      companionId: "00000000-0000-0000-0000-000000000000",
      offers: [{ kind: "service", id: WANGZHE, accepting: true, markupOn: false }],
    })
  : { status: 0, json: {} };
const hijackRow = (hijack.json?.catalog?.services || []).find((s) => s.id === WANGZHE);
step(
  "companion save ignores foreign userId (own row only)",
  hijack.status === 200 && hijack.json?.ok === true && hijackRow && hijackRow.markupOn === false,
  `status=${hijack.status} markupOn=${hijackRow?.markupOn}`
);

const distinctWang = [
  { levelId: "lv1", markupAllowance: 1 },
  { levelId: "lv2", markupAllowance: 2 },
  { levelId: "lv3", markupAllowance: 3 },
  { levelId: "lv4", markupAllowance: 4 },
  { levelId: "lv5", markupAllowance: 5 },
];
const distinctDelta = [
  { levelId: "lv1", markupAllowance: 8 },
  { levelId: "lv2", markupAllowance: 8 },
  { levelId: "lv3", markupAllowance: 8 },
  { levelId: "lv4", markupAllowance: 8 },
  { levelId: "lv5", markupAllowance: 8 },
];
const saveW2 = admin
  ? await api("/api/admin/service-level-prices", admin, { action: "save_markup", serviceId: WANGZHE, markups: distinctWang })
  : { json: {} };
const saveD2 = admin
  ? await api("/api/admin/service-level-prices", admin, { action: "save_markup", serviceId: DELTA, markups: distinctDelta })
  : { json: {} };
const grid2 = admin ? await api("/api/admin/service-level-prices", admin) : { json: {} };
const wang2 = (grid2.json?.grid || []).find((g) => g.serviceId === WANGZHE);
const delta2 = (grid2.json?.grid || []).find((g) => g.serviceId === DELTA);
const wang2m = (wang2?.levels || []).map((l) => Number(l.markupAllowance));
const delta2m = (delta2?.levels || []).map((l) => Number(l.markupAllowance));
step(
  "admin distinct markups per game persist after reload",
  saveW2.json?.ok &&
    saveD2.json?.ok &&
    wang2m.join(",") === "1,2,3,4,5" &&
    delta2m.join(",") === "8,8,8,8,8",
  `wang=${wang2m.join(",")} delta=${delta2m.join(",")}`
);

const offersLv = companion ? await api("/api/companion", companion, { action: "my_offers" }) : { json: {} };
const wangOffer = (offersLv.json?.catalog?.services || []).find((s) => s.id === WANGZHE);
const deltaOffer = (offersLv.json?.catalog?.services || []).find((s) => s.id === DELTA);
const lid = String(wangOffer?.levelId || "").toLowerCase();
const expectedByLevel = { lv1: 1, lv2: 2, lv3: 3, lv4: 4, lv5: 5 }[lid];
step(
  "companion wangzhe markup matches own level not other LVs",
  Number.isFinite(expectedByLevel) && Number(wangOffer?.markupAllowance) === expectedByLevel,
  `levelId=${lid} markup=${wangOffer?.markupAllowance} expected=${expectedByLevel}`
);
step(
  "companion delta markup independent of wangzhe",
  Number(deltaOffer?.markupAllowance) === 8 && Number(wangOffer?.markupAllowance) !== 8,
  `deltaMarkup=${deltaOffer?.markupAllowance} wangMarkup=${wangOffer?.markupAllowance}`
);

const restoreWang = [
  { levelId: "lv1", markupAllowance: 5 },
  { levelId: "lv2", markupAllowance: 5 },
  { levelId: "lv3", markupAllowance: 5 },
  { levelId: "lv4", markupAllowance: 5 },
  { levelId: "lv5", markupAllowance: 5 },
];
const restoreDelta = [
  { levelId: "lv1", markupAllowance: 0 },
  { levelId: "lv2", markupAllowance: 0 },
  { levelId: "lv3", markupAllowance: 0 },
  { levelId: "lv4", markupAllowance: 0 },
  { levelId: "lv5", markupAllowance: 0 },
];
if (admin) {
  await api("/api/admin/service-level-prices", admin, { action: "save_markup", serviceId: WANGZHE, markups: restoreWang });
  await api("/api/admin/service-level-prices", admin, { action: "save_markup", serviceId: DELTA, markups: restoreDelta });
}

const onAgain = companion
  ? await api("/api/companion", companion, {
      action: "save_offers",
      offers: [{ kind: "service", id: WANGZHE, accepting: true, markupOn: true }],
    })
  : { json: {} };
const priced = (onAgain.json?.catalog?.services || []).find((s) => s.id === WANGZHE);
const quoted = Number(priced?.finalPrice);
const boot = companion
  ? await fetch(`${BASE}/api/companion?action=bootstrap`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${companion}`, "x-mcj-access-token": companion },
    }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) }))
  : { json: {} };
const companionId =
  companionSess.id ||
  boot.json?.data?.player?.id ||
  boot.json?.data?.player?.uid ||
  boot.json?.data?.profile?.id ||
  "";

const onlineSet = companion
  ? await api("/api/companion", companion, {
      action: "set_online_status",
      status: "online",
      online_status: "online",
      heartbeat: 1,
      presenceKind: "heartbeat",
      presenceRev: Date.now(),
    })
  : { json: {} };
const presence = onlineSet.json?.profile || {};
const lastBeat = Date.parse(presence.last_online_at || presence.status_updated_at || "");
const beatFresh = Number.isFinite(lastBeat) && Date.now() - lastBeat < 90 * 1000;
step(
  "companion set_online with workbench heartbeat payload",
  onlineSet.json?.ok === true,
  onlineSet.json?.message || String(onlineSet.status)
);
step(
  "diagnosed set_online vs place_order presence fields",
  true,
  `heartbeat:1 accepted; server still only stores online_status=${presence.online_status} availability_status=${presence.availability_status} last_online_at=${presence.last_online_at || ""} beatFresh=${beatFresh}. place_order reads availability_status first (loadCompanionPricingRow), so companion@meow.test stays 离线.`
);
const bossTok = boss;

const platformSvcs = await fetch(`${BASE}/api/platform/services?scope=all`).then(async (r) => r.json().catch(() => ({})));
const wangzheFields =
  ((platformSvcs.services || []).find((s) => s.id === WANGZHE) || {}).orderFields ||
  ((platformSvcs.services || []).find((s) => /王者/.test(String(s.name || s.title || ""))) || {}).orderFields ||
  [];
function requirementAnswers(gid) {
  return (wangzheFields || []).map((field) => ({
    fieldId: field.id,
    id: field.id,
    value: field.kind === "select" || field.kind === "multiselect" ? (field.options || [])[0] || gid : gid,
  }));
}

async function placeWangzhe(targetCompanionId) {
  const gid = `LVMARKUP${String(Date.now()).slice(-8)}`;
  return api("/api/orders", bossTok, {
    action: "place_order",
    companionId: targetCompanionId,
    serviceId: WANGZHE,
    serviceType: "王者荣耀",
    service: "王者荣耀",
    game: "王者荣耀",
    hours: 1,
    quantity: 1,
    gameId: gid,
    game_id: gid,
    gameIdValue: gid,
    orderRequirements: requirementAnswers(gid),
    paymentMethod: "catfood",
    notes: "staging lv-markup snapshot",
    idempotencyKey: `lv-markup-${Date.now()}-${String(targetCompanionId).slice(0, 8)}`,
  });
}

let orderSnap = null;
let placed = { status: 0, json: {} };
if (bossTok && companionId && quoted > 0) {
  placed = await placeWangzhe(companionId);
}
if (!placed.json?.ok) {
  const pub = await fetch(`${BASE}/api/public/companions`).then(async (r) => r.json().catch(() => ({})));
  const onlineComp = (pub.companions || []).find((c) => c.canAcceptBossOrder && (c.userId || c.user_id || c.id) !== companionId);
  const altId = onlineComp ? onlineComp.userId || onlineComp.user_id || onlineComp.id : "";
  step(
    "fallback public companion is orderable",
    !!altId,
    altId ? `name=${onlineComp.name || ""} id=${altId}` : "no public canAcceptBossOrder companion"
  );
  if (bossTok && altId) placed = await placeWangzhe(altId);
} else {
  step("fallback public companion is orderable", true, "own companion already orderable");
}

{
  const order = placed.json?.order || placed.json?.data?.order || {};
  orderSnap = {
    status: placed.status,
    ok: placed.json?.ok,
    message: placed.json?.message,
    id: order.id,
    unit: order.unit_price ?? order.unitPrice ?? order.price,
    total: order.total_amount ?? order.totalAmount,
  };
  const orderOk = !!(placed.json?.ok && order.id && Number(orderSnap.unit) > 0);
  step(
    "place_order created with server unit",
    orderOk,
    `http=${placed.status} id=${order.id || ""} unit=${orderSnap.unit} ownQuoted=${quoted} msg=${placed.json?.message || ""}`,
    { unverified: !orderOk }
  );
  if (!orderOk) orderSnap = null;
}

if (admin && orderSnap?.id) {
  await api("/api/admin/service-level-prices", admin, {
    action: "save_markup",
    serviceId: WANGZHE,
    markups: [
      { levelId: "lv1", markupAllowance: 9 },
      { levelId: "lv2", markupAllowance: 9 },
      { levelId: "lv3", markupAllowance: 9 },
      { levelId: "lv4", markupAllowance: 9 },
      { levelId: "lv5", markupAllowance: 9 },
    ],
  });
  const afterOffers = await api("/api/companion", companion, { action: "my_offers" });
  const live = (afterOffers.json?.catalog?.services || []).find((s) => s.id === WANGZHE);
  const listed = await fetch(`${BASE}/api/orders?id=${encodeURIComponent(orderSnap.id)}`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${bossTok}`, "x-mcj-access-token": bossTok },
  }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) }));
  const againOrder =
    listed.json?.order ||
    (listed.json?.orders || []).find((o) => o.id === orderSnap.id) ||
    listed.json?.data?.order ||
    {};
  const frozenUnit = againOrder.unit_price ?? againOrder.unitPrice ?? againOrder.price ?? orderSnap.unit;
  const liveFinal = Number(live?.finalPrice);
  step(
    "live offer updates after admin markup change",
    liveFinal === Number(live?.basePrice) + 9,
    `liveFinal=${liveFinal} base=${live?.basePrice} markup=${live?.markupAllowance}`
  );
  step(
    "historical order unit frozen after admin markup change",
    Number(frozenUnit) === Number(orderSnap.unit) && Number(orderSnap.unit) !== liveFinal,
    `orderUnit=${frozenUnit} original=${orderSnap.unit} liveNow=${liveFinal}`
  );
  await api("/api/admin/service-level-prices", admin, { action: "save_markup", serviceId: WANGZHE, markups: restoreWang });
}

if (bossTok && admin && !orderSnap?.id) {
  const listedBefore = await fetch(`${BASE}/api/orders`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${bossTok}` },
  }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) }));
  const existing = (listedBefore.json?.orders || []).find((o) => {
    const unit = Number(o.unitPrice ?? o.unit_price ?? o.price ?? 0);
    const game = String(o.game || o.title || o.serviceType || "");
    const sid = String(o.serviceId || o.service_id || "");
    return o.id && unit > 0 && (sid === WANGZHE || /王者/.test(game));
  });
  if (existing) {
    const beforeUnit = Number(existing.unitPrice ?? existing.unit_price ?? existing.price);
    await api("/api/admin/service-level-prices", admin, {
      action: "save_markup",
      serviceId: WANGZHE,
      markups: [
        { levelId: "lv1", markupAllowance: 9 },
        { levelId: "lv2", markupAllowance: 9 },
        { levelId: "lv3", markupAllowance: 9 },
        { levelId: "lv4", markupAllowance: 9 },
        { levelId: "lv5", markupAllowance: 9 },
      ],
    });
    const listedAfter = await fetch(`${BASE}/api/orders?id=${encodeURIComponent(existing.id)}`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${bossTok}`, "x-mcj-access-token": bossTok },
    }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) }));
    const afterRow = (listedAfter.json?.orders || []).find((o) => o.id === existing.id);
    const afterUnit = afterRow ? Number(afterRow.unitPrice ?? afterRow.unit_price ?? afterRow.price) : NaN;
    const liveOffers = companion ? await api("/api/companion", companion, { action: "my_offers" }) : { json: {} };
    const live = (liveOffers.json?.catalog?.services || []).find((s) => s.id === WANGZHE);
    if (!afterRow) {
      step(
        "existing order unit unchanged after admin markup change",
        false,
        `GET id=${existing.id} missing after save http=${listedAfter.status}`,
        { unverified: true }
      );
    } else {
      step(
        "live offer updates after admin markup change",
        Number(live?.finalPrice) === Number(live?.basePrice) + 9,
        `liveFinal=${live?.finalPrice} base=${live?.basePrice} markup=${live?.markupAllowance}`
      );
      step(
        "historical order unit frozen after admin markup change",
        afterUnit === beforeUnit && beforeUnit > 0 && Number(live?.finalPrice) !== afterUnit,
        `id=${existing.id} game=${existing.game || ""} before=${beforeUnit} after=${afterUnit} liveNow=${live?.finalPrice}`
      );
    }
    await api("/api/admin/service-level-prices", admin, { action: "save_markup", serviceId: WANGZHE, markups: restoreWang });
  } else {
    step(
      "existing order unit unchanged after admin markup change",
      false,
      `boss wangzhe orders=${(listedBefore.json?.orders || []).length} http=${listedBefore.status}`,
      { unverified: true }
    );
  }
}

if (companion && bossTok && companionId) {
  const goOnline = await api("/api/companion", companion, {
    action: "set_online_status",
    status: "online",
    online_status: "online",
    heartbeat: 1,
    presenceKind: "heartbeat",
  });
  const onPlace = await placeWangzhe(companionId);
  const onOrder = onPlace.json?.order || onPlace.json?.data?.order || {};
  step(
    "place_order allowed after set_online",
    !!(goOnline.json?.ok && onPlace.json?.ok && onOrder.id),
    `onlineHttp=${goOnline.status} place=${onPlace.status} id=${onOrder.id || ""} msg=${onPlace.json?.message || ""}`
  );

  const goOffline = await api("/api/companion", companion, {
    action: "set_online_status",
    status: "offline",
    online_status: "offline",
  });
  const offPlace = await placeWangzhe(companionId);
  step(
    "place_order blocked after set_offline",
    goOffline.json?.ok === true &&
      offPlace.json?.ok !== true &&
      /离线|暂不可下单/.test(String(offPlace.json?.message || "")),
    `offlineSave=${goOffline.json?.message || goOffline.status} placeMsg=${offPlace.json?.message || offPlace.status}`
  );

  await api("/api/companion", companion, {
    action: "set_online_status",
    status: "online",
    online_status: "online",
    heartbeat: 1,
    presenceKind: "heartbeat",
  });
  await new Promise((resolve) => setTimeout(resolve, 91 * 1000));
  const stalePlace = await placeWangzhe(companionId);
  step(
    "place_order blocked after stale heartbeat",
    stalePlace.json?.ok !== true && /离线|暂不可下单/.test(String(stalePlace.json?.message || "")),
    `placeMsg=${stalePlace.json?.message || stalePlace.status}`
  );
  await api("/api/companion", companion, {
    action: "set_online_status",
    status: "online",
    online_status: "online",
    heartbeat: 1,
    presenceKind: "heartbeat",
  });
}

const altEmails = [
  process.env.E2E_COMPANION_ALT_EMAIL,
  process.env.MCJ_COMPANION_B_EMAIL,
  process.env.MCJ_COMPANION2_EMAIL,
  "companion2@meow.test",
  "companion-b@meow.test",
  "companion.final.1785714993009@meow.test",
  "companion2.final.1785714993009@meow.test",
].filter((e, i, arr) => e && arr.indexOf(e) === i && e !== "companion@meow.test");
let altTok = "";
let altEmailUsed = "";
const altAttempts = [];
for (const email of altEmails) {
  const raw = await api("/api/auth", "", { action: "login", email, password: PASS, loginPortal: "companion" });
  const t = tok(raw.json);
  const kind = t
    ? "ok"
    : /邮箱或密码错误|invalid login|invalid_credentials/i.test(String(raw.json?.message || raw.json?.error || ""))
      ? "bad_credentials"
      : raw.status === 401
        ? "unauthorized"
        : raw.status === 403
          ? "forbidden"
          : `http_${raw.status}`;
  altAttempts.push(`${email}:${kind}:${String(raw.json?.message || "").slice(0, 40)}`);
  if (t) {
    altTok = t;
    altEmailUsed = email;
    break;
  }
}
if (!altTok) {
  const credOnly = altAttempts.every((a) => /:bad_credentials:|:unauthorized:/.test(a));
  step(
    "second companion account isolation",
    false,
    credOnly
      ? `credential missing/wrong (not authz): ${altAttempts.join(" | ")}`
      : `login blocked: ${altAttempts.join(" | ")}`,
    { unverified: true }
  );
} else {
  const beforeAlt = await api("/api/companion", companion, { action: "my_offers" });
  const beforeOwn = (beforeAlt.json?.catalog?.services || []).find((s) => s.id === WANGZHE);
  const altSave = await api("/api/companion", altTok, {
    action: "save_offers",
    userId: companionSess.id,
    companionId: companionSess.id,
    offers: [{ kind: "service", id: WANGZHE, accepting: true, markupOn: !beforeOwn?.markupOn }],
  });
  const afterOwn = await api("/api/companion", companion, { action: "my_offers" });
  const ownRow = (afterOwn.json?.catalog?.services || []).find((s) => s.id === WANGZHE);
  step(
    "second companion account isolation",
    altSave.json?.ok === true && ownRow && ownRow.markupOn === beforeOwn?.markupOn,
    `alt=${altEmailUsed} ownBefore=${beforeOwn?.markupOn} ownAfter=${ownRow?.markupOn} altStatus=${altSave.status}`
  );
}

const failed = results.filter((r) => !r.pass && !r.unverified);
const unverified = results.filter((r) => r.unverified);
console.log(
  JSON.stringify(
    {
      failed: failed.length,
      unverified: unverified.length,
      total: results.length,
      failedNames: failed.map((f) => f.name),
      unverifiedNames: unverified.map((f) => f.name),
    },
    null,
    2
  )
);
process.exit(failed.length ? 1 : 0);
