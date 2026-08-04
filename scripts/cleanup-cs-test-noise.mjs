/**
 * Clean CS/chat test garbage: noise conversations + orphan empty messages.
 * Does NOT delete profiles / auth accounts.
 * Dry-run by default; pass --apply to mutate.
 *
 * Usage:
 *   node scripts/cleanup-cs-test-noise.mjs
 *   node scripts/cleanup-cs-test-noise.mjs --apply
 *
 * Hard-guarded against Production.
 */
import fs from "node:fs";
import path from "node:path";
import { guardAfterEnvLoad } from "./lib/prod-guard.mjs";

const ROOT = process.cwd();
guardAfterEnvLoad("cleanup-cs-test-noise.mjs");

const APPLY = process.argv.includes("--apply");
const URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const NOISE_RE = /\[TEST\]|E2E-MSG|E2E[_-]|CHAT-|CS-LINK|SVC-|MSG-|ORDER-CHAT-|acceptance|自动化测试|Ã.|Â.|ä¸|æ.|å.|ç.|è.|é.|ðŸ|ï¼|ï½/i;

if (!URL || !KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

async function rest(table, qs, init) {
  const r = await fetch(`${URL}/rest/v1/${table}${qs || ""}`, {
    ...init,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      Prefer: (init && init.headers && init.headers.Prefer) || "return=representation",
      "Content-Type": "application/json",
      ...(init && init.headers),
    },
  });
  const text = await r.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!r.ok) throw new Error(`${r.status} ${table}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
  return body;
}

function isNoiseBlob(...parts) {
  return NOISE_RE.test(parts.map((p) => String(p || "")).join("\n"));
}

async function main() {
  const convs = await rest(
    "conversations",
    "?select=id,boss_id,order_id,status,updated_at,created_at&order=updated_at.desc&limit=800"
  );
  const msgs = await rest(
    "messages",
    "?select=id,conversation_id,content,created_at,sender_role&order=created_at.desc&limit=3000"
  );
  const byConv = {};
  (msgs || []).forEach((m) => {
    (byConv[m.conversation_id] = byConv[m.conversation_id] || []).push(m);
  });

  const noiseConvIds = new Set();
  for (const c of convs || []) {
    const list = byConv[c.id] || [];
    const blob = list
      .slice(0, 12)
      .map((m) => m.content)
      .join("\n");
    if (isNoiseBlob(blob, c.order_id)) noiseConvIds.add(c.id);
  }
  // Also mark messages that are pure noise even if conversation otherwise ok — only delete those msgs if conv becomes empty? Keep simple: only whole-noise convs.
  const noiseMsgIds = (msgs || [])
    .filter((m) => noiseConvIds.has(m.conversation_id) || isNoiseBlob(m.content))
    .map((m) => m.id);

  // Orphan orders that look like test noise titles (do not touch real money flows aggressively).
  const orders = await rest(
    "orders",
    "?select=id,order_no,title,description,status,created_at&order=created_at.desc&limit=500"
  );
  const noiseOrders = (orders || []).filter((o) => isNoiseBlob(o.order_no, o.title, o.description));

  const report = {
    apply: APPLY,
    noiseConversations: [...noiseConvIds],
    noiseMessageCount: noiseMsgIds.length,
    noiseOrders: noiseOrders.map((o) => ({ id: o.id, order_no: o.order_no, status: o.status })),
    keptAccounts: true,
  };

  if (!APPLY) {
    console.log(JSON.stringify(report, null, 2));
    console.log("\nDry-run only. Re-run with --apply to delete.");
    fs.writeFileSync(path.join(ROOT, "scripts/cleanup-cs-test-noise-results.json"), JSON.stringify(report, null, 2));
    return;
  }

  // Delete messages first, then conversations. Skip deleting orders that are completed/paid — only cancel-looking test drafts.
  if (noiseMsgIds.length) {
    // Chunk deletes
    for (let i = 0; i < noiseMsgIds.length; i += 80) {
      const chunk = noiseMsgIds.slice(i, i + 80);
      await rest("messages", `?id=in.(${chunk.map(encodeURIComponent).join(",")})`, { method: "DELETE" });
    }
  }
  const convArr = [...noiseConvIds];
  for (let i = 0; i < convArr.length; i += 40) {
    const chunk = convArr.slice(i, i + 40);
    await rest("conversations", `?id=in.(${chunk.map(encodeURIComponent).join(",")})`, { method: "DELETE" });
  }
  const deletableOrders = noiseOrders.filter((o) =>
    /awaiting_payment|pending|cancelled|draft/i.test(String(o.status || ""))
  );
  for (const o of deletableOrders) {
    try {
      await rest("orders", `?id=eq.${encodeURIComponent(o.id)}`, { method: "DELETE" });
    } catch (e) {
      report.orderDeleteErrors = report.orderDeleteErrors || [];
      report.orderDeleteErrors.push({ id: o.id, error: e.message });
    }
  }
  report.deletedOrders = deletableOrders.map((o) => o.id);
  report.deleted = true;
  fs.writeFileSync(path.join(ROOT, "scripts/cleanup-cs-test-noise-results.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
