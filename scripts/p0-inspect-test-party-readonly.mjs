#!/usr/bin/env node
/** READ-ONLY: inspect why settle skipped test_customer_service for P0 orders. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFiles, PRODUCTION_SUPABASE_REF, supabaseProjectRef } from "./lib/prod-guard.mjs";
import { isTestAccountRecord } from "../server/api/_test-accounts.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnvFiles(ROOT);
loadEnvFiles(path.resolve(ROOT, "..", "meow-cuijiao-homepage"));

const URL = String(process.env.PROD_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const KEY = String(process.env.PROD_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
if (supabaseProjectRef(URL) !== PRODUCTION_SUPABASE_REF) throw new Error("not prod");

async function get(q) {
  const r = await fetch(`${URL.replace(/\/$/, "")}/rest/v1/${q}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  const b = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(b));
  return b;
}

const nos = ["MCJO000356", "MCJO000357"];
for (const no of nos) {
  const orders = await get(
    `orders?order_no=eq.${encodeURIComponent(no)}&select=id,order_no,boss_id,companion_id,customer_service_id,status,total_amount&limit=1`
  );
  const o = orders[0];
  const ids = [o.boss_id, o.companion_id, o.customer_service_id].filter(Boolean);
  const profiles = await get(
    `profiles?id=in.(${ids.map(encodeURIComponent).join(",")})&select=id,role,email,display_name,is_test_account`
  ).catch(async () =>
    get(`profiles?id=in.(${ids.map(encodeURIComponent).join(",")})&select=id,role,email,display_name`)
  );
  console.log(
    JSON.stringify(
      {
        orderNo: no,
        parties: (profiles || []).map((p) => ({
          idShort: String(p.id).slice(0, 8),
          role: p.role,
          emailDomain: String(p.email || "").split("@")[1] || "",
          display: String(p.display_name || "").slice(0, 20),
          is_test_account: p.is_test_account ?? null,
          isTestAccountRecord: isTestAccountRecord(p),
          which:
            p.id === o.boss_id ? "boss" : p.id === o.companion_id ? "companion" : p.id === o.customer_service_id ? "cs" : "?",
        })),
      },
      null,
      2
    )
  );
}
