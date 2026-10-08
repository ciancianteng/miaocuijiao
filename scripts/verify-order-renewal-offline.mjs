/**
 * Offline checks for boss renewal rules. No network, no database writes.
 */
import {
  RENEWABLE_STATUSES,
  clientAmountMismatch,
  createRenewalOrder,
  normalizeRenewalHours,
  quoteRenewalAmount,
  renewalEligibility,
} from "../server/api/_order-renewal.js";

let failed = 0;
function check(name, ok, detail = "") {
  if (ok) console.log("PASS", name);
  else {
    failed += 1;
    console.log("FAIL", name, detail);
  }
}

const boss = "boss-1";
const other = "boss-2";
const companion = "pw-1";
const source = {
  id: "src-1",
  order_no: "MCJO0000461",
  boss_id: boss,
  companion_id: companion,
  status: "completed",
  game: "CSGO",
  service_name: "CSGO",
  hours: 3,
  unit_price: 10,
  total_amount: 30,
  order_type: "direct_companion",
  payment_method: "duitnow",
  reviewed: true,
};

check("completed is renewable", RENEWABLE_STATUSES.includes("completed") && RENEWABLE_STATUSES.includes("reviewed"));
check("in progress is not renewable", !renewalEligibility({ ...source, status: "in_progress" }, boss).ok);
check("wrong boss rejected", renewalEligibility(source, other).status === 403);
check("missing companion rejected", renewalEligibility({ ...source, companion_id: "" }, boss).status === 409);
check("multi parent rejected", renewalEligibility({ ...source, order_type: "multi_group", companion_id: "" }, boss).status === 409);
check("hours reject fraction", normalizeRenewalHours(3.5) == null);
check("hours reject 0 and 25", normalizeRenewalHours(0) == null && normalizeRenewalHours(25) == null);
check("hours accept 1 and 24", normalizeRenewalHours(1) === 1 && normalizeRenewalHours(24) === 24);

const quote = quoteRenewalAmount(12.5, 4);
check("quote is unit times hours", quote && quote.totalAmount === 50 && quote.unitPrice === 12.5 && quote.hours === 4);
check("quote does not copy source total", quote.totalAmount !== source.total_amount);
check("tampered total flagged", clientAmountMismatch(quote, { unitPrice: 12.5, totalAmount: 1 }) === "total");
check("tampered unit flagged", clientAmountMismatch(quote, { unitPrice: 1, totalAmount: 50 }) === "unit");
check("omitted client amount allowed", clientAmountMismatch(quote, {}) === "");

const writes = [];
const db = {
  restUrl(table, query = "") {
    return String(table || "") + String(query || "");
  },
  serviceHeaders() {
    return {};
  },
  async supabaseJson(_url, opts = {}) {
    if (opts.method === "POST") {
      writes.push(JSON.parse(opts.body));
      if (writes.length === 1 && writes[0].voice_mode) {
        const err = new Error("Could not find the 'voice_mode' column of 'orders' in the schema cache");
        throw err;
      }
      return [{ ...writes[writes.length - 1], id: "new-1" }];
    }
    const q = String(_url || "");
    if (q.includes("renewal_of_order_id")) return [];
    if (q.includes("id=eq.src-1")) return [source];
    return [];
  },
  async nextOrderNo() {
    return "MCJO0000999";
  },
  async assertCompanionOrderable() {
    return { ok: true, cp: { user_id: companion, level_id: "l1", level_name: "L1" } };
  },
  async buildServiceSnapshotForCompanion() {
    return null;
  },
  async resolveCurrentUnitPrice() {
    return 12.5;
  },
};

let tamperThrew = "";
try {
  await createRenewalOrder({
    profile: { id: boss },
    body: { sourceOrderId: source.id, hours: 4, unitPrice: 999, totalAmount: 1 },
    db,
  });
} catch (err) {
  tamperThrew = err.code || "";
}
check("tampered amount rejected before insert", tamperThrew === "PRICE_CHANGED" && writes.length === 0);

const created = await createRenewalOrder({
  profile: { id: boss },
  body: { sourceOrderId: source.id, hours: 4 },
  db,
});

check("server priced from current unit", created.order.unit_price === 12.5 && created.order.total_amount === 50);
check("new order number", created.order.order_no === "MCJO0000999" && created.order.order_no !== source.order_no);
check("linked to source", created.order.renewal_of_order_id === source.id && created.order.is_renewal === true);
check("source order number snapshotted", created.order.renewal_source_order_no === "MCJO0000461");
check("starts awaiting payment", created.order.status === "awaiting_payment");
check("keeps original companion", created.order.companion_id === companion);
check("hours came from request", created.order.hours === 4);
check("optional column retried without voice_mode", writes.length === 2 && !writes[1].voice_mode && writes[1].is_renewal === true);
check("no update was sent to the source", writes.every((row) => row.order_no === "MCJO0000999"));
check("source total unchanged in memory", source.total_amount === 30 && source.hours === 3 && source.status === "completed");

const open = {
  id: "open-1",
  order_no: "MCJO0000888",
  status: "awaiting_payment",
  renewal_of_order_id: source.id,
  is_renewal: true,
  boss_id: boss,
};
let inserts = 0;
const dedupeDb = {
  ...db,
  async supabaseJson(url) {
    if (String(url).includes("renewal_of_order_id")) return [open];
    if (String(url).includes("id=eq.src-1")) return [source];
    inserts += 1;
    return [];
  },
};
const again = await createRenewalOrder({
  profile: { id: boss },
  body: { sourceOrderId: source.id, hours: 2 },
  db: dedupeDb,
});
check("open renewal is reused", again.deduped === true && again.order.id === "open-1" && inserts === 0);

console.log(failed ? `FAILED ${failed}` : "ALL PASS");
process.exit(failed ? 1 : 0);
