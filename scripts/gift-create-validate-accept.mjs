/**
 * Gift admin create validation accept.
 * Tests: empty name, duplicate name, successful create (enabled default on, featured default off).
 * Usage: PREVIEW=https://meow-cuijiao-homepage-staging.vercel.app node scripts/gift-create-validate-accept.mjs
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
const MARKER = `GIFT-VAL-${Date.now()}`;
const ART = path.join("/opt/cursor/artifacts", "gift-create-validate");
const ART_REPO = path.join(ROOT, "artifacts", "gift-create-validate");
fs.mkdirSync(ART, { recursive: true });
fs.mkdirSync(ART_REPO, { recursive: true });

const results = [];
function step(name, ok, detail) {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "").slice(0, 800) });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
  return ok;
}

async function api(pathname, token, body) {
  const res = await fetch(`${BASE}${pathname}`, {
    method: body == null ? "GET" : "POST",
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

async function main() {
  const login = await api("/api/auth", null, {
    action: "login",
    email: "admin@meow.test",
    password: PASS,
    loginPortal: "admin",
  });
  const token = login.json?.session?.accessToken || "";
  if (!step("admin login", !!token, `tok=${!!token}`)) process.exit(1);

  // 1) Empty name
  const empty = await api("/api/admin/gifts", token, {
    action: "save",
    name: "   ",
    catFoodPrice: 10,
  });
  step(
    "empty name rejected",
    !empty.ok && /礼物名称不能为空|名称/.test(String(empty.json?.message || "")),
    `status=${empty.status} msg=${empty.json?.message || ""}`
  );

  // 2) Successful create — defaults
  const name = `验收礼物 ${MARKER}`;
  const created = await api("/api/admin/gifts", token, {
    action: "save",
    name,
    catFoodPrice: 12,
    sortOrder: 50,
    // omit featured/enabled → server defaults
  });
  const gift = created.json?.gift || {};
  step(
    "create succeeds",
    created.ok && !!gift.id,
    `msg=${created.json?.message || ""} id=${gift.id || ""}`
  );
  step(
    "default status enabled",
    gift.enabled === true,
    `enabled=${gift.enabled} msg=${created.json?.message || ""}`
  );
  step(
    "default featured off",
    gift.featured === false,
    `featured=${gift.featured}`
  );
  step(
    "create message states defaults",
    /启用/.test(String(created.json?.message || "")) && /推荐：否/.test(String(created.json?.message || "")),
    `msg=${created.json?.message || ""}`
  );

  // 3) Duplicate name
  const dup = await api("/api/admin/gifts", token, {
    action: "save",
    name,
    catFoodPrice: 15,
  });
  step(
    "duplicate name rejected",
    !dup.ok && /已存在|重复/.test(String(dup.json?.message || "")),
    `status=${dup.status} msg=${dup.json?.message || ""}`
  );

  // Case-insensitive duplicate
  const dupCase = await api("/api/admin/gifts", token, {
    action: "save",
    name: name.toUpperCase(),
    catFoodPrice: 15,
  });
  step(
    "duplicate name case-insensitive",
    !dupCase.ok && /已存在|重复/.test(String(dupCase.json?.message || "")),
    `status=${dupCase.status} msg=${dupCase.json?.message || ""}`
  );

  // Cleanup soft-delete
  if (gift.id) {
    await api("/api/admin/gifts", token, { action: "soft_delete", id: gift.id });
  }

  const failCount = results.filter((r) => r.result === "FAIL").length;
  const summary = {
    base: BASE,
    marker: MARKER,
    ALL_PASS: failCount === 0,
    failCount,
    results,
  };
  for (const dir of [ART, ART_REPO]) {
    fs.writeFileSync(path.join(dir, "results.json"), JSON.stringify(summary, null, 2));
    fs.writeFileSync(
      path.join(dir, "summary.txt"),
      (summary.ALL_PASS ? "GIFT_CREATE_VALIDATE_PASS" : `GIFT_CREATE_VALIDATE_FAIL ${failCount}`) +
        "\n" +
        results.map((r) => `${r.result}\t${r.step}\t${r.detail}`).join("\n")
    );
  }
  console.log(summary.ALL_PASS ? "GIFT_CREATE_VALIDATE_PASS" : `GIFT_CREATE_VALIDATE_FAIL ${failCount}`);
  process.exit(failCount ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
