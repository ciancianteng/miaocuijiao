/**
 * Permanent companion gift wall helpers.
 * Prefer companion_gift_wall aggregate table; fall back to gift_transactions.
 */
import { companionDb, isMissingRelation } from "./_companion-media-store.js";

function money(v) {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function mapWallRow(row) {
  return {
    giftId: row.gift_id || null,
    giftName: row.gift_name || "",
    iconUrl: row.icon_url || "",
    rarity: row.rarity || "common",
    effectType: row.effect_type || row.animation_level || "float",
    quantity: Math.max(0, Number(row.quantity) || 0),
    totalValue: money(row.total_value),
    lastReceivedAt: row.last_received_at || row.updated_at || null,
  };
}

/** Upsert permanent wall count after a successful gift send. */
export async function recordGiftWallReceipt({
  companionId,
  giftId,
  giftName,
  iconUrl = "",
  rarity = "common",
  effectType = "float",
  quantity = 1,
  unitValue = 0,
} = {}) {
  const cid = String(companionId || "").trim();
  const gid = String(giftId || "").trim();
  const qty = Math.max(1, Math.floor(Number(quantity) || 1));
  const unit = money(unitValue);
  const addValue = Math.round(unit * qty * 100) / 100;
  if (!cid || !gid) return { ok: false, skipped: true };

  try {
    const existing = await companionDb(
      "companion_gift_wall",
      `?companion_id=eq.${encodeURIComponent(cid)}&gift_id=eq.${encodeURIComponent(gid)}&limit=1`
    );
    const prev = existing?.[0];
    const now = new Date().toISOString();
    if (prev?.id) {
      await companionDb("companion_gift_wall", `?id=eq.${encodeURIComponent(prev.id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          gift_name: giftName || prev.gift_name || "",
          icon_url: iconUrl || prev.icon_url || "",
          rarity: rarity || prev.rarity || "common",
          effect_type: effectType || prev.effect_type || "float",
          quantity: Math.max(0, Number(prev.quantity) || 0) + qty,
          total_value: Math.round((money(prev.total_value) + addValue) * 100) / 100,
          last_received_at: now,
          updated_at: now,
        }),
      });
    } else {
      await companionDb("companion_gift_wall", "", {
        method: "POST",
        body: JSON.stringify({
          companion_id: cid,
          gift_id: gid,
          gift_name: giftName || "",
          icon_url: iconUrl || "",
          rarity: rarity || "common",
          effect_type: effectType || "float",
          quantity: qty,
          total_value: addValue,
          last_received_at: now,
          created_at: now,
          updated_at: now,
        }),
      });
    }
  } catch (err) {
    if (!isMissingRelation(err)) throw err;
    return { ok: false, missingTable: true };
  }

  // Future achievement/badge hook (best-effort).
  try {
    await companionDb("reward_events", "", {
      method: "POST",
      body: JSON.stringify({
        event_type: "gift_received",
        subject_id: cid,
        subject_type: "companion",
        payload: {
          giftId: gid,
          giftName,
          quantity: qty,
          unitValue: unit,
          totalValue: addValue,
          rarity,
          effectType,
        },
        source_table: "gift_transactions",
        created_at: new Date().toISOString(),
      }),
    });
  } catch {
    /* table may be missing until migration */
  }

  return { ok: true };
}

/** Load permanent wall (+ totals). Falls back to aggregating gift_transactions. */
export async function loadCompanionGiftWall(companionId) {
  const cid = String(companionId || "").trim();
  if (!cid) {
    return { items: [], totalCount: 0, totalValue: 0, source: "empty" };
  }

  try {
    const rows = await companionDb(
      "companion_gift_wall",
      `?companion_id=eq.${encodeURIComponent(cid)}&quantity=gt.0&order=quantity.desc&limit=100`
    );
    if (Array.isArray(rows)) {
      const items = rows.map(mapWallRow).filter((x) => x.quantity > 0);
      const totalCount = items.reduce((s, x) => s + x.quantity, 0);
      const totalValue = Math.round(items.reduce((s, x) => s + x.totalValue, 0) * 100) / 100;
      return { items, totalCount, totalValue, source: "companion_gift_wall" };
    }
  } catch (err) {
    if (!isMissingRelation(err)) throw err;
  }

  // Fallback: aggregate immutable gift_transactions (kind=gift only).
  try {
    const txs = await companionDb(
      "gift_transactions",
      `?receiver_companion_id=eq.${encodeURIComponent(cid)}&kind=eq.gift&order=created_at.desc&limit=500`
    );
    const byGift = new Map();
    for (const tx of txs || []) {
      const key = String(tx.gift_id || tx.gift_name || "").trim() || "unknown";
      const prev = byGift.get(key) || {
        gift_id: tx.gift_id || null,
        gift_name: tx.gift_name || "",
        icon_url: "",
        rarity: "common",
        effect_type: "float",
        quantity: 0,
        total_value: 0,
        last_received_at: null,
      };
      prev.quantity += Math.max(1, Number(tx.quantity) || 1);
      prev.total_value = Math.round((money(prev.total_value) + money(tx.gross_cat_food)) * 100) / 100;
      prev.last_received_at = prev.last_received_at || tx.created_at;
      byGift.set(key, prev);
    }
    // Enrich icons from catalog when possible.
    const giftIds = [...byGift.values()].map((x) => x.gift_id).filter(Boolean);
    if (giftIds.length) {
      try {
        const gifts = await companionDb(
          "gifts",
          `?id=in.(${giftIds.map((id) => `"${id}"`).join(",")})&select=id,icon_url,rarity,effect_type,animation_level&limit=100`
        );
        const map = new Map((gifts || []).map((g) => [g.id, g]));
        for (const row of byGift.values()) {
          const g = map.get(row.gift_id);
          if (!g) continue;
          row.icon_url = g.icon_url || "";
          row.rarity = g.rarity || "common";
          row.effect_type = g.effect_type || g.animation_level || "float";
        }
      } catch {
        /* ignore */
      }
    }
    const items = [...byGift.values()].map(mapWallRow).sort((a, b) => b.quantity - a.quantity);
    const totalCount = items.reduce((s, x) => s + x.quantity, 0);
    const totalValue = Math.round(items.reduce((s, x) => s + x.totalValue, 0) * 100) / 100;
    return { items, totalCount, totalValue, source: "gift_transactions" };
  } catch (err) {
    if (!isMissingRelation(err)) throw err;
    return { items: [], totalCount: 0, totalValue: 0, source: "unavailable" };
  }
}
