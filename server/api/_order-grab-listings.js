/**
 * Public grab-hall listing rows (one per order_id).
 * Table: order_grab_listings. Falls back to orders.note marker when table missing.
 */
const LISTING_START = "[[GRAB_LISTING]]";
const LISTING_END = "[[/GRAB_LISTING]]";

function nowIso() {
  return new Date().toISOString();
}

function money(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function parseListingMarker(text = "") {
  const raw = String(text || "");
  const start = raw.indexOf(LISTING_START);
  const end = raw.indexOf(LISTING_END);
  if (start === -1 || end === -1 || end <= start) return { listing: null, rest: raw };
  let listing = null;
  try {
    listing = JSON.parse(raw.slice(start + LISTING_START.length, end).trim());
  } catch {
    listing = null;
  }
  const rest = (raw.slice(0, start) + raw.slice(end + LISTING_END.length)).trim();
  return { listing, rest };
}

function withListingMarker(text = "", listing) {
  const { rest } = parseListingMarker(text);
  if (!listing) return rest;
  const body = `${LISTING_START}${JSON.stringify(listing)}${LISTING_END}`;
  return rest ? `${rest}\n${body}` : body;
}

function listingPayloadFromOrder(order = {}, extras = {}) {
  const hours = money(order.hours);
  const duration =
    extras.duration ||
    order.duration ||
    (hours > 0 ? `${hours} 小时` : String(order.hours || "").trim() || "");
  return {
    order_id: order.id,
    customer_id: order.boss_id || extras.customerId || null,
    service_name: String(order.title || order.service_name || order.game || "").trim() || "",
    game: String(order.game || "").trim() || "",
    duration,
    hours: hours || null,
    amount: money(order.total_amount ?? order.totalAmount),
    requirements: String(order.description || order.note || extras.requirements || "")
      .replace(/\[\[GRAB_LISTING\]\][\s\S]*?\[\[\/GRAB_LISTING\]\]/g, "")
      .replace(/\[\[ORDER_GRABS\]\][\s\S]*?\[\[\/ORDER_GRABS\]\]/g, "")
      .replace(/\[\[BOSS_INTENT\]\][\s\S]*?\[\[\/BOSS_INTENT\]\]/g, "")
      .replace(/\[\[COMPLETION_PENDING\]\]/g, "")
      .trim()
      .slice(0, 2000),
    published_by_cs_id: extras.publishedByCsId || order.customer_service_id || null,
    published_at: extras.publishedAt || nowIso(),
    status: extras.status || "open",
  };
}

export function createGrabListingHelpers({ restUrl, supabaseJson, serviceHeaders }) {
  async function readListingRow(orderId) {
    try {
      const rows = await supabaseJson(
        restUrl("order_grab_listings", `?order_id=eq.${encodeURIComponent(orderId)}&limit=1`),
        { headers: serviceHeaders() }
      );
      return Array.isArray(rows) && rows[0] ? rows[0] : null;
    } catch (err) {
      if (/order_grab_listings|schema cache|PGRST|does not exist/i.test(String(err?.message || err))) {
        return null;
      }
      throw err;
    }
  }

  async function upsertListing(order, extras = {}) {
    if (!order?.id) throw new Error("缺少订单 ID，无法发布抢单大厅。");
    const payload = listingPayloadFromOrder(order, extras);
    const existing = await readListingRow(order.id);
    if (existing) {
      // Idempotent: reopen / refresh metadata, never duplicate order_id.
      const patch = {
        ...payload,
        status: extras.forceClosed ? "closed" : "open",
        closed_at: extras.forceClosed ? nowIso() : null,
        closed_reason: extras.forceClosed ? extras.closedReason || "closed" : null,
        updated_at: nowIso(),
        published_at: existing.published_at || payload.published_at,
        published_by_cs_id: payload.published_by_cs_id || existing.published_by_cs_id,
      };
      try {
        const rows = await supabaseJson(
          restUrl("order_grab_listings", `?order_id=eq.${encodeURIComponent(order.id)}`),
          {
            method: "PATCH",
            headers: { ...serviceHeaders(), Prefer: "return=representation" },
            body: JSON.stringify(patch),
          }
        );
        return {
          ok: true,
          created: false,
          listing: Array.isArray(rows) ? rows[0] : { ...existing, ...patch },
          source: "table",
        };
      } catch (err) {
        if (!/order_grab_listings|schema cache|PGRST|does not exist/i.test(String(err?.message || err))) {
          throw err;
        }
      }
    } else {
      try {
        const rows = await supabaseJson(restUrl("order_grab_listings", ""), {
          method: "POST",
          headers: { ...serviceHeaders(), Prefer: "return=representation" },
          body: JSON.stringify({
            ...payload,
            status: "open",
            created_at: nowIso(),
            updated_at: nowIso(),
          }),
        });
        return {
          ok: true,
          created: true,
          listing: Array.isArray(rows) ? rows[0] : payload,
          source: "table",
        };
      } catch (err) {
        const msg = String(err?.message || err || "");
        // Unique violation → treat as idempotent refresh.
        if (/duplicate|unique|23505/i.test(msg)) {
          const again = await readListingRow(order.id);
          if (again) return { ok: true, created: false, listing: again, source: "table" };
        }
        if (!/order_grab_listings|schema cache|PGRST|does not exist/i.test(msg)) throw err;
      }
    }

    // Marker fallback when table not migrated yet.
    const marker = {
      orderId: order.id,
      customerId: payload.customer_id,
      service: payload.service_name,
      game: payload.game,
      duration: payload.duration,
      amount: payload.amount,
      requirements: payload.requirements,
      publishedByCsId: payload.published_by_cs_id,
      publishedAt: payload.published_at,
      status: "open",
    };
    const nextNote = withListingMarker(order.note || order.description || "", marker);
    const attempts = [{ note: nextNote }, { description: nextNote }];
    let lastErr = null;
    for (const body of attempts) {
      try {
        await supabaseJson(restUrl("orders", `?id=eq.${encodeURIComponent(order.id)}`), {
          method: "PATCH",
          headers: serviceHeaders(),
          body: JSON.stringify(body),
        });
        return { ok: true, created: !parseListingMarker(order.note || "").listing, listing: marker, source: "marker" };
      } catch (err) {
        lastErr = err;
        if (!/column|schema cache|PGRST/i.test(String(err?.message || ""))) throw err;
      }
    }
    throw lastErr || new Error("无法写入抢单大厅记录");
  }

  async function closeListing(orderId, reason = "assigned") {
    if (!orderId) return { ok: false };
    try {
      await supabaseJson(restUrl("order_grab_listings", `?order_id=eq.${encodeURIComponent(orderId)}&status=eq.open`), {
        method: "PATCH",
        headers: serviceHeaders(),
        body: JSON.stringify({
          status: "closed",
          closed_at: nowIso(),
          closed_reason: reason,
          updated_at: nowIso(),
        }),
      });
      return { ok: true, source: "table" };
    } catch (err) {
      if (!/order_grab_listings|schema cache|PGRST|does not exist/i.test(String(err?.message || err))) {
        throw err;
      }
    }
    return { ok: true, source: "skipped" };
  }

  async function listOpenListings(limit = 100) {
    try {
      const rows = await supabaseJson(
        restUrl(
          "order_grab_listings",
          `?status=eq.open&order=published_at.desc&limit=${Math.max(1, Math.min(200, Number(limit) || 100))}`
        ),
        { headers: serviceHeaders() }
      );
      return Array.isArray(rows) ? rows : [];
    } catch (err) {
      if (/order_grab_listings|schema cache|PGRST|does not exist/i.test(String(err?.message || err))) {
        return [];
      }
      throw err;
    }
  }

  return {
    upsertListing,
    closeListing,
    listOpenListings,
    readListingRow,
    listingPayloadFromOrder,
    parseListingMarker,
  };
}

export { LISTING_START, LISTING_END, parseListingMarker, withListingMarker, listingPayloadFromOrder };
