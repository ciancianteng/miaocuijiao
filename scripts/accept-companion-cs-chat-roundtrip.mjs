/**
 * Live companion ↔ CS E2E on Staging (API path the CS UI uses).
 * Releases stuck auto-assigned companion_support into 待接待, then proves roundtrip.
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
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

async function login(email) {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASS }),
  });
  const body = await r.json();
  if (!r.ok) throw new Error(`login ${email}: ${JSON.stringify(body)}`);
  return body;
}

async function rest(table, qs, opts = {}) {
  const r = await fetch(`${URL}/rest/v1/${table}${qs}`, {
    method: opts.method || "GET",
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
      Prefer: opts.prefer || "return=representation",
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await r.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!r.ok) throw new Error(`rest ${table} ${r.status} ${text.slice(0, 200)}`);
  return json;
}

async function post(pathName, token, body) {
  const r = await fetch(`${STAGING}${pathName}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json() };
}

async function get(pathName, token) {
  const r = await fetch(`${STAGING}${pathName}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: r.status, json: await r.json() };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const marker = `LIVECOMPCS-${Date.now()}`;
  const out = {
    staging: STAGING,
    marker,
    routes: {},
    steps: {},
  };

  for (const p of ["/customer-service/conversations", "/customer-service/conversations/"]) {
    const r = await fetch(STAGING + p, { redirect: "follow" });
    out.routes[p] = { status: r.status, ok: r.status === 200 };
  }

  const comp = await login(COMP);
  const cs = await login(CS);
  out.compUid = comp.user.id;
  out.csUid = cs.user.id;

  // Release any open companion_support back to waiting pool (undo prior auto-assign).
  const open = await rest(
    "conversations",
    `?companion_id=eq.${encodeURIComponent(comp.user.id)}&conversation_type=eq.companion_support&status=not.in.(closed,ended)&select=id,customer_service_id,status`
  );
  for (const row of open || []) {
    if (row.customer_service_id) {
      await rest(`conversations?id=eq.${encodeURIComponent(row.id)}`, "", {
        method: "PATCH",
        body: {
          customer_service_id: null,
          status: "waiting_service",
          updated_at: new Date().toISOString(),
        },
      });
    }
  }
  out.released = (open || []).map((r) => r.id);

  // CS listens realtime BEFORE companion sends (proves without-refresh).
  const rtClient = createClient(URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  rtClient.realtime.setAuth(cs.access_token);
  let rtGot = null;
  let rtAt = 0;
  const channel = rtClient
    .channel("e2e-comp-cs-" + Date.now())
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
      const row = payload?.new;
      if (row && String(row.content || "").includes(marker) && row.sender_role === "companion") {
        rtGot = row;
        rtAt = Date.now();
      }
    });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("rt subscribe timeout")), 15000);
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(t);
        resolve();
      }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        clearTimeout(t);
        reject(new Error(status));
      }
    });
  });

  const tSend = Date.now();
  const send = await post("/api/companion", comp.access_token, {
    action: "send_cs_message",
    content: marker + "-from-companion",
  });
  out.steps.companionSend = {
    ok: !!send.json?.ok,
    status: send.status,
    msgId: send.json?.messageRow?.id,
    convId: send.json?.messageRow?.conversationId,
  };
  const convId = send.json?.messageRow?.conversationId || "";
  out.convId = convId;

  // Wait realtime <2s
  const deadline = Date.now() + 2000;
  while (!rtGot && Date.now() < deadline) await sleep(50);
  out.steps.realtimeCsSees = {
    ok: !!(rtGot && rtGot.id),
    msgId: rtGot?.id || null,
    latencyMs: rtGot ? rtAt - tSend : null,
  };

  // DB evidence
  const dbMsgs = await rest(
    "messages",
    `?conversation_id=eq.${encodeURIComponent(convId)}&content=ilike.*${encodeURIComponent(marker)}*&select=id,sender_role,content,created_at&order=created_at.asc`
  );
  const dbConv = (
    await rest("conversations", `?id=eq.${encodeURIComponent(convId)}&select=*`)
  )?.[0];
  out.steps.dbInsert = {
    ok: (dbMsgs || []).some((m) => m.sender_role === "companion"),
    roles: [...new Set((dbMsgs || []).map((m) => m.sender_role))],
    msgIds: (dbMsgs || []).map((m) => m.id),
    convType: dbConv?.conversation_type,
    assignedCs: dbConv?.customer_service_id || null,
    status: dbConv?.status,
  };

  // CS bootstrap — must be in waiting (no assignee)
  const boot = await post("/api/customer-service", cs.access_token, { action: "bootstrap" });
  const convs = boot.json?.data?.conversations || [];
  const msgs = boot.json?.data?.messages || [];
  const found = convs.find((c) => c.id === convId);
  out.steps.csBoot = {
    ok: !!found,
    inWaiting: !!(found && !found.currentServiceId),
    status: found?.status,
    lastMessage: found?.lastMessage,
    hasMsg: msgs.some((m) => String(m.content || "").includes(marker)),
    bossName: found?.bossName,
    conversationType: found?.conversationType,
  };

  // Poll path (<2s UI backup)
  const tPoll = Date.now();
  let pollHit = false;
  let pollLatency = null;
  for (let i = 0; i < 4; i++) {
    const poll = await post("/api/customer-service", cs.access_token, {
      action: "poll_updates",
      conversation_id: "",
      since: "",
    });
    const pMsgs = poll.json?.data?.messages || [];
    const pConvs = poll.json?.data?.conversations || [];
    if (
      pMsgs.some((m) => String(m.content || "").includes(marker)) ||
      pConvs.some((c) => c.id === convId && String(c.lastMessage || "").includes(marker))
    ) {
      pollHit = true;
      pollLatency = Date.now() - tPoll;
      break;
    }
    await sleep(400);
  }
  out.steps.csPoll = { ok: pollHit, latencyMs: pollLatency };

  // CS take + reply
  const take = await post("/api/customer-service", cs.access_token, {
    action: "take_conversation",
    id: convId,
  });
  out.steps.csTake = { ok: !!take.json?.ok, message: take.json?.message };

  const replyMarker = marker + "-from-cs";
  const reply = await post("/api/customer-service", cs.access_token, {
    action: "send_message",
    conversation_id: convId,
    content: replyMarker,
  });
  out.steps.csReply = {
    ok: !!reply.json?.ok,
    msgId: reply.json?.messageRow?.id || reply.json?.message?.id,
  };

  // Companion inbox sees CS reply
  let companionSees = false;
  let companionLatency = null;
  const tComp = Date.now();
  for (let i = 0; i < 8; i++) {
    const inbox = await get("/api/companion?action=inbox", comp.access_token);
    const data = inbox.json?.data || inbox.json?.inbox || {};
    const list = data.messages || [];
    if (list.some((m) => String(m.content || "").includes(replyMarker))) {
      companionSees = true;
      companionLatency = Date.now() - tComp;
      break;
    }
    await sleep(250);
  }
  out.steps.companionSeesReply = { ok: companionSees, latencyMs: companionLatency };

  // Refresh history both sides
  const boot2 = await post("/api/customer-service", cs.access_token, { action: "bootstrap" });
  const list2 = await post("/api/customer-service", cs.access_token, {
    action: "list_messages",
    id: convId,
    conversation_id: convId,
  });
  const inbox2 = await get("/api/companion?action=inbox", comp.access_token);
  const inboxData = inbox2.json?.data || inbox2.json?.inbox || {};
  out.steps.refreshHistory = {
    csHasCompanion: (list2.json?.messages || []).some((m) => String(m.content || "").includes(marker + "-from-companion")),
    csHasCs: (list2.json?.messages || []).some((m) => String(m.content || "").includes(replyMarker)),
    companionHasBoth:
      (inboxData.messages || []).some((m) => String(m.content || "").includes(marker + "-from-companion")) &&
      (inboxData.messages || []).some((m) => String(m.content || "").includes(replyMarker)),
    sameConv: inboxData.csConversationId === convId,
    bootStillHasConv: !!(boot2.json?.data?.conversations || []).find((c) => c.id === convId),
  };

  await rtClient.removeChannel(channel);

  out.ok =
    out.routes["/customer-service/conversations"]?.ok &&
    out.routes["/customer-service/conversations/"]?.ok &&
    out.steps.companionSend?.ok &&
    out.steps.dbInsert?.ok &&
    !out.steps.dbInsert?.assignedCs &&
    out.steps.csBoot?.ok &&
    out.steps.csBoot?.inWaiting &&
    out.steps.csBoot?.hasMsg &&
    (out.steps.realtimeCsSees?.ok || (out.steps.csPoll?.ok && out.steps.csPoll.latencyMs <= 2000)) &&
    out.steps.csTake?.ok &&
    out.steps.csReply?.ok &&
    out.steps.companionSeesReply?.ok &&
    out.steps.refreshHistory?.csHasCompanion &&
    out.steps.refreshHistory?.csHasCs &&
    out.steps.refreshHistory?.companionHasBoth &&
    out.steps.refreshHistory?.sameConv;

  fs.writeFileSync(
    path.join(ROOT, "scripts/accept-companion-cs-chat-roundtrip-results.json"),
    JSON.stringify(out, null, 2)
  );
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
