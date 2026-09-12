/**
 * Prove Supabase Realtime delivers companion→CS message INSERT.
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
for (const f of [".env.local", ".env"]) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m || process.env[m[1]]) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const STAGING = "https://meow-cuijiao-homepage-staging.vercel.app";
const PASS = "McjTest@12345678";
const COMP = "companion.idcard.1785715257525@meow.test";
const CS = "service.final.1785714993009@meow.test";
const URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const ANON = process.env.SUPABASE_ANON_KEY || "";

async function login(email) {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASS }),
  });
  return r.json();
}

async function post(pathName, token, body) {
  const r = await fetch(`${STAGING}${pathName}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}

async function main() {
  const marker = `RTLIVE-${Date.now()}`;
  const comp = await login(COMP);
  const cs = await login(CS);
  const inbox = await fetch(`${STAGING}/api/companion?action=inbox`, {
    headers: { Authorization: `Bearer ${comp.access_token}` },
  }).then((r) => r.json());
  const convId = inbox?.data?.csConversationId || inbox?.inbox?.csConversationId;
  if (!convId) throw new Error("no conv");

  const client = createClient(URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { params: { eventsPerSecond: 10 } },
  });
  client.realtime.setAuth(cs.access_token);

  let got = null;
  const channel = client
    .channel("rt-probe-" + Date.now())
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${convId}` },
      (payload) => {
        const row = payload?.new;
        if (row && String(row.content || "").includes(marker)) got = row;
      }
    );

  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("subscribe timeout")), 15000);
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(t);
        resolve();
      }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        clearTimeout(t);
        reject(new Error("subscribe " + status));
      }
    });
  });

  await post("/api/companion", comp.access_token, {
    action: "send_cs_message",
    content: marker + "-live",
  });

  const deadline = Date.now() + 12000;
  while (!got && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
  }

  // CS reply → companion listen
  const client2 = createClient(URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  client2.realtime.setAuth(comp.access_token);
  let gotCs = null;
  const marker2 = marker + "-csreply";
  const ch2 = client2
    .channel("rt-probe-comp-" + Date.now())
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${convId}` },
      (payload) => {
        const row = payload?.new;
        if (row && String(row.content || "").includes(marker2)) gotCs = row;
      }
    );
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("comp subscribe timeout")), 15000);
    ch2.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(t);
        resolve();
      }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        clearTimeout(t);
        reject(new Error("comp subscribe " + status));
      }
    });
  });

  await post("/api/customer-service", cs.access_token, {
    action: "take_conversation",
    id: convId,
  });
  const reply = await post("/api/customer-service", cs.access_token, {
    action: "send_message",
    conversation_id: convId,
    content: marker2,
  });

  const deadline2 = Date.now() + 12000;
  while (!gotCs && Date.now() < deadline2) {
    await new Promise((r) => setTimeout(r, 250));
  }

  await client.removeChannel(channel);
  await client2.removeChannel(ch2);

  const out = {
    convId,
    companionToCsRealtime: !!(got && got.id),
    companionToCsMsgId: got?.id || null,
    csToCompanionRealtime: !!(gotCs && gotCs.id),
    csToCompanionMsgId: gotCs?.id || reply?.messageRow?.id || null,
    csReplyApiOk: !!reply?.ok,
  };
  out.ok = out.companionToCsRealtime && out.csToCompanionRealtime && out.csReplyApiOk;
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(String(e && e.stack || e));
  process.exit(1);
});
