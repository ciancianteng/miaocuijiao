/**
 * Per-service price range and companion permissions.
 * Stored in platform_settings.data.servicePricePolicy (existing JSON blob).
 * Does not alter services columns, orders, or historical unit_price.
 * Rollback: delete the servicePricePolicy key from platform_settings.data.
 */
import { companionDb } from "./_companion-media-store.js";
import {
  assertLevelMarkupCaps,
  assertPricePolicy,
  normalizeLevelMarkupCaps,
  normalizePricePolicy,
} from "./_service-offer-quote.js";

export { assertLevelMarkupCaps, assertPricePolicy, normalizeLevelMarkupCaps, normalizePricePolicy };

async function readSettingsData() {
  const rows = await companionDb("platform_settings", "?id=eq.global&select=data&limit=1").catch(() => []);
  const data = rows?.[0]?.data;
  return data && typeof data === "object" && !Array.isArray(data) ? data : {};
}

export async function loadAllPricePolicies() {
  const data = await readSettingsData();
  const map = data.servicePricePolicy;
  return map && typeof map === "object" && !Array.isArray(map) ? map : {};
}

export async function loadLevelMarkupCaps() {
  const data = await readSettingsData();
  return normalizeLevelMarkupCaps(data.levelMarkupCaps);
}

export async function saveLevelMarkupCaps(raw) {
  const caps = assertLevelMarkupCaps(raw || {});
  const prev = await readSettingsData();
  const next = { ...prev, levelMarkupCaps: caps };
  await companionDb("platform_settings", "?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ id: "global", data: next, updated_at: new Date().toISOString() }),
  });
  return caps;
}

export async function savePricePolicy(serviceId, raw) {
  const id = String(serviceId || "").trim();
  if (!id) throw Object.assign(new Error("缺少服务 ID"), { status: 400 });
  const policy = normalizePricePolicy(raw || {});
  assertPricePolicy(policy, raw || {});
  const prev = await readSettingsData();
  const next = {
    ...prev,
    servicePricePolicy: { ...(prev.servicePricePolicy || {}), [id]: policy },
  };
  await companionDb("platform_settings", "?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ id: "global", data: next, updated_at: new Date().toISOString() }),
  });
  return policy;
}
