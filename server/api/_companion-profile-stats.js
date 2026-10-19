/**
 * Shared profile stats for one companion.
 * Callers pass the viewed companion's user id and profile id.
 * These helpers do not read the signed-in viewer and do not write orders or reviews.
 */

export function companionLookupIds(card = {}) {
  const userId = String(card.id || card.uid || card.userId || card.user_id || "").trim();
  const profileId = String(card.companionProfileId || card.profileId || card.profile_id || "").trim();
  return [...new Set([userId, profileId].filter(Boolean))];
}

/** User id wins when it collides with another companion's profile id. */
export function aliasOwners(companions = []) {
  const map = new Map();
  for (const card of companions || []) {
    const key = String(card?.id || card?.uid || "").trim();
    if (key) map.set(key, key);
  }
  for (const card of companions || []) {
    const key = String(card?.id || card?.uid || "").trim();
    const profileId = String(card?.companionProfileId || card?.profileId || "").trim();
    if (key && profileId && profileId !== key && !map.has(profileId)) map.set(profileId, key);
  }
  return map;
}

export function tallyCompletedOrders(companions = [], orders = []) {
  const owners = aliasOwners(companions);
  const counts = {};
  for (const card of companions || []) {
    const key = String(card?.id || card?.uid || "").trim();
    if (key) counts[key] = 0;
  }
  const seen = new Set();
  for (const row of orders || []) {
    if (String(row?.status || "completed") !== "completed") continue;
    const orderId = String(row.id || "").trim();
    if (orderId && seen.has(orderId)) continue;
    const companionId = String(row.companion_id || row.companionId || "").trim();
    const owner = owners.get(companionId);
    if (!owner || !Object.prototype.hasOwnProperty.call(counts, owner)) continue;
    if (orderId) seen.add(orderId);
    counts[owner] += 1;
  }
  return counts;
}

export function excludeTestBossOrders(orders = [], testBossIds = []) {
  const blocked = new Set((testBossIds || []).map((id) => String(id || "").trim()).filter(Boolean));
  if (!blocked.size) return Array.isArray(orders) ? orders : [];
  return (orders || []).filter((row) => !blocked.has(String(row?.boss_id || row?.bossId || "").trim()));
}

/**
 * One review list per viewed companion.
 * An order may store either the user id or the profile id; both belong to that companion.
 * A review is dropped when its order is assigned to a different companion.
 */
export function reviewsGroupedByCompanion(companions = [], reviews = [], ordersById = null) {
  const owners = aliasOwners(companions);
  const aliasByOwner = new Map();
  for (const card of companions || []) {
    const key = String(card?.id || card?.uid || "").trim();
    if (!key) continue;
    aliasByOwner.set(key, new Set(companionLookupIds(card)));
  }
  const buckets = {};
  const seen = new Set();
  for (const review of reviews || []) {
    const reviewId = String(review?.id || review?.order_id || "").trim();
    if (reviewId && seen.has(reviewId)) continue;
    const companionId = String(review?.companion_id || "").trim();
    const owner = owners.get(companionId);
    if (!owner) continue;
    if (ordersById && review?.order_id && ordersById[review.order_id]) {
      const orderCompanion = String(ordersById[review.order_id].companion_id || "").trim();
      const aliases = aliasByOwner.get(owner) || new Set();
      if (orderCompanion && !aliases.has(orderCompanion)) continue;
    }
    if (reviewId) seen.add(reviewId);
    if (!buckets[owner]) buckets[owner] = [];
    buckets[owner].push(review);
  }
  return buckets;
}

/** Same gift stored under the user id and the profile id keeps the larger quantity. */
export function mergeGiftWalls(groups = []) {
  const byKey = new Map();
  for (const row of (groups || []).flat()) {
    const giftId = String(row?.giftId || row?.gift_id || "").trim();
    const name = String(row?.giftName || row?.gift_name || "").trim();
    const key = name || (giftId ? `id:${giftId}` : "");
    const qty = Number(row?.totalQuantity != null ? row.totalQuantity : row?.total_quantity);
    if (!key || !(qty > 0)) continue;
    const prev = byKey.get(key);
    if (prev && qty <= prev.totalQuantity) continue;
    byKey.set(key, {
      giftId: giftId || prev?.giftId || "",
      giftName: name || prev?.giftName || "礼物",
      giftImage: row?.giftImage || row?.gift_image_url || prev?.giftImage || "",
      totalQuantity: qty,
      lastReceivedAt: row?.lastReceivedAt || row?.last_received_at || prev?.lastReceivedAt || "",
    });
  }
  return [...byKey.values()].sort((a, b) => b.totalQuantity - a.totalQuantity || a.giftName.localeCompare(b.giftName, "zh"));
}

function serviceRowOpen(row = {}) {
  if (row.enabled === false || row.enabled === "false" || row.enabled === 0 || row.enabled === "0") return false;
  const status = String(row.review_status || row.reviewStatus || "").trim().toLowerCase();
  return !status || status === "approved" || status === "passed";
}

function matchServiceRow(rows, serviceId, name, used) {
  const byId = (rows || []).find((row) => !used.has(row) && String(row.service_id || row.serviceId || "") === serviceId);
  if (byId) return byId;
  if (!name) return null;
  return (
    (rows || []).find((row) => {
      if (used.has(row)) return false;
      const sid = String(row.service_id || row.serviceId || "").trim();
      if (sid && sid !== serviceId) return false;
      return String(row.service_name || row.serviceName || "").trim() === name;
    }) || null
  );
}

/**
 * Read-time offers for companions who never saved __catalogOffers.
 * An explicit key, including [], is not seeded. Disabled or unapproved rows stay closed
 * and do not fall back to game_prices. Names without a catalog row are ignored.
 */
export function seedLegacyCatalogOffers({ catalogServices = [], serviceRows = [], gamePrices = {} } = {}) {
  const prices = gamePrices && typeof gamePrices === "object" ? gamePrices : {};
  const used = new Set();
  const offers = [];
  for (const service of catalogServices || []) {
    const id = String(service?.id || "").trim();
    const name = String(service?.name || service?.title || "").trim();
    if (!id) continue;
    const row = matchServiceRow(serviceRows, id, name, used);
    if (row) {
      used.add(row);
      const open = serviceRowOpen(row);
      offers.push({
        kind: "service",
        id,
        accepting: open,
        enabled: open,
        price: open ? row.price : null,
      });
      continue;
    }
    if (prices[id] == null && prices[name] == null) continue;
    offers.push({ kind: "service", id, accepting: true, enabled: true, price: null });
  }
  return offers;
}

export function catalogOffersWereSaved(standards = {}, offerKey = "__catalogOffers") {
  return !!(standards && typeof standards === "object" && Object.prototype.hasOwnProperty.call(standards, offerKey));
}

async function collectInChunks(ids, size, load) {
  const all = [];
  for (let i = 0; i < ids.length; i += size) {
    const chunk = ids.slice(i, i + size);
    const page = await load(chunk);
    if (Array.isArray(page)) all.push(...page);
  }
  return all;
}

/**
 * Count status=completed orders for each companion.
 * db(table, query) is the existing REST helper. Cancelled, refunded, and in-progress rows
 * are not requested. Test-account bosses are removed when that lookup succeeds.
 */
export async function loadCompletedOrderCount(db, companions = []) {
  const ids = [...new Set((companions || []).flatMap((card) => companionLookupIds(card)))];
  const counts = tallyCompletedOrders(companions, []);
  if (!ids.length || typeof db !== "function") return counts;
  const pageSize = 1000;
  const rows = [];
  for (let offset = 0; offset < 20000; offset += pageSize) {
    const page = await db(
      "orders",
      `?companion_id=in.(${ids.map(encodeURIComponent).join(",")})&status=eq.completed&select=id,companion_id,boss_id,status&limit=${pageSize}&offset=${offset}`
    );
    const list = Array.isArray(page) ? page : [];
    rows.push(...list);
    if (list.length < pageSize) break;
    if (offset + pageSize >= 20000) {
      console.warn("[companion-stats] completed order read stopped at 20000 rows");
    }
  }
  const bossIds = [...new Set(rows.map((row) => String(row.boss_id || "").trim()).filter(Boolean))];
  let countable = rows;
  if (bossIds.length) {
    try {
      const bosses = await collectInChunks(bossIds, 80, (chunk) =>
        db(
          "profiles",
          `?id=in.(${chunk.map(encodeURIComponent).join(",")})&is_test_account=eq.true&select=id&limit=100`
        )
      );
      countable = excludeTestBossOrders(
        rows,
        (bosses || []).map((row) => row.id)
      );
    } catch (error) {
      console.warn("[companion-stats] test boss lookup failed", error?.message || error);
    }
  }
  return tallyCompletedOrders(companions, countable);
}
