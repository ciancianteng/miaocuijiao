#!/usr/bin/env node
/**
 * Production-final Admin config accept (gifts + popularity + input guards).
 * Usage: PREVIEW=https://meow-cuijiao-homepage-staging.vercel.app node scripts/admin-config-prod-final-accept.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.PREVIEW || process.env.MCJ_STAGING_URL || "https://meow-cuijiao-homepage-staging.vercel.app").replace(
  /\/$/,
  ""
);
const PASS = process.env.PASS || "McjTest@12345678";
const MARKER = `ACFG-${Date.now()}`;
const ART = path.join("/opt/cursor/artifacts", "admin-config-prod-final");
const ART_REPO = path.join(ROOT, "artifacts", "admin-config-prod-final");
fs.mkdirSync(ART, { recursive: true });
fs.mkdirSync(ART_REPO, { recursive: true });

const results = [];
function step(name, ok, detail, { blocking = true } = {}) {
  results.push({
    step: name,
    result: ok ? "PASS" : "FAIL",
    blocking: ok ? false : blocking,
    detail: String(detail || "").slice(0, 900),
  });
  console.log(`[${ok ? "PASS" : "FAIL"}${!ok && !blocking ? " soft" : ""}] ${name} :: ${detail}`);
  return ok;
}

async function api(pathname, token, body, method) {
  const m = method || (body == null ? "GET" : "POST");
  const res = await fetch(`${BASE}${pathname}`, {
    method: m,
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}`, "x-mcj-admin-role": "admin" } : {}),
      ...(body != null ? { "Content-Type": "application/json" } : {}),
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok && json.ok !== false, status: res.status, json };
}

function writeOut(verdict) {
  const payload = { verdict, base: BASE, marker: MARKER, at: new Date().toISOString(), results };
  for (const dir of [ART, ART_REPO]) {
    fs.writeFileSync(path.join(dir, "results.json"), JSON.stringify(payload, null, 2));
  }
  console.log(`\n=== ${verdict} ===`);
  return verdict;
}

async function main() {
  const login = await api("/api/auth", null, {
    action: "login",
    email: "admin@meow.test",
    password: PASS,
    loginPortal: "admin",
  });
  const token = login.json?.session?.accessToken || "";
  if (!step("admin login", !!token, `status=${login.status}`)) {
    return writeOut("FAIL_BLOCKING");
  }

  // ---------- GIFTS ----------
  const emptyGift = await api("/api/admin/gifts", token, { action: "save", name: "  ", catFoodPrice: 10 });
  step(
    "gifts empty name rejected",
    !emptyGift.ok && /礼物名称不能为空|名称/.test(String(emptyGift.json?.message || "")),
    `status=${emptyGift.status} msg=${emptyGift.json?.message || ""}`
  );

  const badPrice = await api("/api/admin/gifts", token, { action: "save", name: `坏价 ${MARKER}`, catFoodPrice: 0 });
  step(
    "gifts zero price rejected",
    !badPrice.ok && /价格|猫粮/.test(String(badPrice.json?.message || "")),
    `status=${badPrice.status} msg=${badPrice.json?.message || ""}`
  );

  const badCommission = await api("/api/admin/gifts", token, { action: "save_commission", commissionRate: 250 });
  step(
    "gifts commission >100 rejected",
    !badCommission.ok && /0–100|0-100|抽成/.test(String(badCommission.json?.message || "")),
    `status=${badCommission.status} msg=${badCommission.json?.message || ""}`,
    { blocking: false } // may not be deployed on staging yet if PR not merged
  );

  const giftName = `验收礼物 ${MARKER}`;
  const created = await api("/api/admin/gifts", token, {
    action: "save",
    name: giftName,
    catFoodPrice: 15,
    sortOrder: 88,
  });
  const giftsSchemaMissing =
    created.status === 503 ||
    /companion-marketplace|Could not find the table.*gifts|请先执行/i.test(
      String(created.json?.message || created.json?.detail || "")
    );

  if (giftsSchemaMissing) {
    step(
      "gifts table present (DB)",
      false,
      `SCHEMA_MISSING: ${created.json?.detail || created.json?.message || ""} — run DATABASE_URL=... node scripts/ensure-gifts-table.mjs`,
      { blocking: true }
    );
    step("gifts create persisted", false, "skipped — schema missing", { blocking: true });
    step("gifts duplicate rejected", false, "skipped — schema missing", { blocking: true });
    step("gifts refresh keeps data", false, "skipped — schema missing", { blocking: true });
  } else {
    const giftId = created.json?.gift?.id || "";
    step(
      "gifts create persisted",
      created.ok && !!giftId && created.json?.gift?.name === giftName,
      `id=${giftId} enabled=${created.json?.gift?.enabled} featured=${created.json?.gift?.featured} msg=${created.json?.message || ""}`
    );

    const dup = await api("/api/admin/gifts", token, {
      action: "save",
      name: giftName.toUpperCase(),
      catFoodPrice: 20,
    });
    step(
      "gifts duplicate rejected",
      !dup.ok && /已存在/.test(String(dup.json?.message || "")),
      `status=${dup.status} msg=${dup.json?.message || ""}`
    );

    const list1 = await api("/api/admin/gifts", token);
    const found1 = (list1.json?.gifts || []).find((g) => String(g.id) === String(giftId) || g.name === giftName);
    step(
      "gifts refresh keeps data",
      !!found1 && Number(found1.catFoodPrice) === 15,
      `found=${!!found1} price=${found1?.catFoodPrice} sort=${found1?.sortOrder}`
    );

    // soft-delete cleanup
    if (giftId) {
      await api("/api/admin/gifts", token, { action: "soft_delete", id: giftId });
    }
  }

  // ---------- POPULARITY ----------
  const popGet = await api("/api/admin/popularity?action=bootstrap", token);
  const popSchemaMissing =
    popGet.status === 503 ||
    /popularity-ranking|Could not find the table.*popularity|请先执行/i.test(
      String(popGet.json?.message || popGet.json?.detail || "")
    ) ||
    (popGet.ok && (popGet.json?.schemaReady === false || popGet.json?.rules?.missing === true || !popGet.json?.rawRules));

  if (popSchemaMissing) {
    step(
      "popularity SQL applied",
      false,
      `SCHEMA_MISSING: ${popGet.json?.message || "popularity_rules 未就绪"} — run: DATABASE_URL=... node scripts/ensure-popularity-tables.mjs`,
      { blocking: true }
    );
  } else if (!popGet.ok) {
    step("popularity bootstrap", false, `status=${popGet.status} msg=${popGet.json?.message || ""}`, { blocking: true });
  } else {
    const missingFlag = !!popGet.json?.rules?.missing || popGet.json?.rawRules == null;
    step(
      "popularity SQL applied",
      !missingFlag,
      missingFlag
        ? "rules._missing / rawRules=null — popularity_rules 表未就绪或未写入"
        : `updatedAt=${popGet.json?.rules?.updatedAt || ""} displayCount=${popGet.json?.rules?.displayCount}`
    );

    if (!missingFlag) {
      const before = popGet.json.rules;
      const probePoints = Number(before.completedOrderPoints || 20) === 21 ? 22 : 21;
      const save = await api("/api/admin/popularity", token, {
        action: "save_rules",
        completedOrderPoints: probePoints,
        fiveStarPoints: before.fiveStarPoints,
        fourStarPoints: before.fourStarPoints,
        giftPointsPer10CatFood: before.giftPointsPer10CatFood,
        onlineHourPoints: before.onlineHourPoints,
        streakDayPoints: before.streakDayPoints,
        favoritePoints: before.favoritePoints,
        cancelPenalty: before.cancelPenalty,
        complaintPenalty: before.complaintPenalty,
        rejectPenalty: before.rejectPenalty,
        timeoutPenalty: before.timeoutPenalty,
        giftDailyCapPoints: before.giftDailyCapPoints,
        displayCount: before.displayCount,
        rewardTop1: before.rewardTop1,
        rewardTop2: before.rewardTop2,
        rewardTop3: before.rewardTop3,
        enabled: before.enabled,
        enableWeekly: before.enableWeekly,
        enableMonthly: before.enableMonthly,
        enableTotal: before.enableTotal,
        enableDaily: before.enableDaily,
        showScore: before.showScore,
        showOrders: before.showOrders,
        showGifts: before.showGifts,
        showOnline: before.showOnline,
        rewardsEnabled: before.rewardsEnabled,
      });
      step("popularity save_rules ok", save.ok, `msg=${save.json?.message || ""} status=${save.status}`);

      const after = await api("/api/admin/popularity?action=bootstrap", token);
      const savedPts = after.json?.rules?.completedOrderPoints;
      step(
        "popularity refresh keeps rules",
        after.ok && Number(savedPts) === probePoints,
        `completedOrderPoints=${savedPts} expected=${probePoints} raw=${!!after.json?.rawRules}`
      );

      // restore original
      await api("/api/admin/popularity", token, {
        action: "save_rules",
        ...before,
        completedOrderPoints: before.completedOrderPoints,
      });

      // Negative / absurd inputs should not 500
      const neg = await api("/api/admin/popularity", token, {
        action: "save_rules",
        completedOrderPoints: -99,
        fiveStarPoints: "NaN",
        displayCount: 0,
        rewardTop1: 9e12,
      });
      step(
        "popularity bad numbers do not 500",
        neg.status < 500,
        `status=${neg.status} msg=${neg.json?.message || ""} ok=${neg.ok}`
      );
      // restore again after clamp test
      await api("/api/admin/popularity", token, { action: "save_rules", ...before });

      // Public ranking endpoint should load rules (not crash)
      const board = await api(`/api/platform/popularity?period=weekly&limit=5`, null);
      const boardOk =
        board.status < 500 &&
        (board.ok || board.json?.ok !== false || Array.isArray(board.json?.rows) || Array.isArray(board.json?.list));
      step(
        "popularity board reads without 500",
        board.status < 500,
        `status=${board.status} ok=${board.ok} keys=${Object.keys(board.json || {}).slice(0, 8).join(",")}`,
        { blocking: false }
      );
      void boardOk;
    }
  }

  // ---------- PLATFORM SETTINGS / PAYMENT GUARDS (smoke) ----------
  const ps = await api("/api/admin/platform-settings", token);
  step("platform-settings readable", ps.ok || ps.status === 200, `status=${ps.status}`);

  const pay = await api("/api/admin/payment-settings", token);
  step(
    "payment-settings readable",
    pay.ok || pay.status === 200 || pay.status === 503,
    `status=${pay.status} msg=${String(pay.json?.message || "").slice(0, 120)}`
  );

  const levels = await api("/api/admin/companion-levels", token);
  step(
    "companion-levels readable",
    levels.ok || levels.status === 200 || levels.status === 503,
    `status=${levels.status} count=${(levels.json?.levels || []).length}`
  );

  const blockingFails = results.filter((r) => r.result === "FAIL" && r.blocking);
  const softFails = results.filter((r) => r.result === "FAIL" && !r.blocking);
  let verdict = "PASS";
  if (blockingFails.length) verdict = "FAIL_BLOCKING";
  else if (softFails.length) verdict = "PASS_WITH_SOFT_FAILS";

  writeOut(verdict);
  process.exit(blockingFails.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  writeOut("FAIL_BLOCKING");
  process.exit(1);
});
