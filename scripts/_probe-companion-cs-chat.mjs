/**
 * Probe companion → CS chat on Staging + Supabase.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
function loadEnv() {
  for (const f of [".env.local", ".env"]) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!m || process.env[m[1]]) continue;
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}
loadEnv();

const STAGING = "https://meow-cuijiao-homepage-staging.vercel.app";
const PASS = "McjTest@12345678";
const COMP = "companion.idcard.1785715257525@meow.test";
const CS = "service.final.1785714993009@meow.test";
const URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const ANON = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

async function login(email) {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASS }),
  });
  const body = await r.json();
  if (!r.ok) throw new Error(`login ${email} ${JSON.stringify(body)}`);
  return body;
}

async function rest(table, qs) {
  const r = await fetch(`${URL}/rest/v1/${table}${qs}`, {
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  });
  return r.json();
}

async function post(pathName, token, body) {
  const r = await fetch(`${STAGING}${pathName}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let json = null;
  try {
    json = await r.json();
  } catch {
    json = { raw: "non-json" };
  }
  return { status: r.status, json };
}

async function get(pathName, token) {
  const r = await fetch(`${STAGING}${pathName}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: r.status, json: await r.json() };
}

async function main() {
  const marker = `COMP-CS-PROBE-${Date.now()}`;
  const comp = await login(COMP);
  const cs = await login(CS);
  const out = {
    marker,
    compUid: comp.user?.id,
    csUid: cs.user?.id,
  };

  const send = await post("/api/companion", comp.access_token, {
    action: "send_cs_message",
    content: marker,
  });
  out.send = {
    status: send.status,
    ok: send.json?.ok,
    message: send.json?.message,
    messageRow: send.json?.messageRow || null,
    error: send.json?.error || send.json?.message || null,
  };

  const inboxPost = await post("/api/companion", comp.access_token, { action: "inbox" });
  const inboxGet = await get("/api/companion?action=inbox", comp.access_token);
  const inboxData =
    inboxPost.json?.data ||
    inboxPost.json?.inbox ||
    inboxGet.json?.data ||
    inboxGet.json?.inbox ||
    {};
  out.inbox = {
    postStatus: inboxPost.status,
    getStatus: inboxGet.status,
    csConversationId: inboxData.csConversationId || "",
    hasMarker: (inboxData.messages || []).some((m) => String(m.content || "").includes(marker)),
    conversations: (inboxData.conversations || []).map((c) => ({
      id: c.id,
      key: c.key,
      type: c.type,
      unread: c.unread,
      assignedServiceId: c.assignedServiceId,
      lastMessage: c.lastMessage,
    })),
  };

  const convId =
    inboxData.csConversationId ||
    send.json?.messageRow?.conversationId ||
    send.json?.messageRow?.conversation_id ||
    "";
  out.convId = convId;

  if (convId) {
    out.dbConv = (await rest("conversations", `?id=eq.${encodeURIComponent(convId)}&select=*`))?.[0] || null;
    out.dbMsgs = await rest(
      "messages",
      `?conversation_id=eq.${encodeURIComponent(convId)}&content=eq.${encodeURIComponent(marker)}&select=id,sender_id,sender_role,content,created_at,message_type,read_at`
    );
  }

  // Also search by companion_id for open companion_support convs
  out.dbCompanionConvs = await rest(
    "conversations",
    `?companion_id=eq.${encodeURIComponent(comp.user.id)}&order=updated_at.desc&limit=5&select=id,boss_id,companion_id,customer_service_id,conversation_type,status,updated_at,last_message_at`
  );

  const boot = await post("/api/customer-service", cs.access_token, { action: "bootstrap" });
  const convs = boot.json?.data?.conversations || [];
  const msgs = boot.json?.data?.messages || [];
  const found = convs.find((c) => c.id === convId);
  out.csBoot = {
    status: boot.status,
    ok: boot.json?.ok,
    convCount: convs.length,
    foundConv: found
      ? {
          id: found.id,
          bossName: found.bossName,
          companionId: found.companionId,
          conversationType: found.conversationType,
          currentServiceId: found.currentServiceId,
          status: found.status,
          lastMessage: found.lastMessage,
          unread: found.unread,
          lockedByOther: found.lockedByOther,
        }
      : null,
    foundMsg: msgs.find((m) => String(m.content || "").includes(marker)) || null,
    companionSupportCount: convs.filter((c) => c.conversationType === "companion_support").length,
    sampleCompanionSupport: convs
      .filter((c) => c.conversationType === "companion_support" || c.companionId)
      .slice(0, 5)
      .map((c) => ({
        id: c.id,
        name: c.bossName,
        companionId: c.companionId,
        type: c.conversationType,
        service: c.currentServiceId,
        status: c.status,
        last: String(c.lastMessage || "").slice(0, 60),
      })),
  };

  if (convId) {
    const list = await post("/api/customer-service", cs.access_token, {
      action: "list_messages",
      id: convId,
      conversation_id: convId,
    });
    out.csList = {
      status: list.status,
      ok: list.json?.ok,
      message: list.json?.message,
      markerMsgs: (list.json?.messages || [])
        .filter((m) => String(m.content || "").includes(marker))
        .map((m) => ({ id: m.id, senderRole: m.senderRole, content: m.content })),
      msgCount: (list.json?.messages || []).length,
    };

    const poll = await post("/api/customer-service", cs.access_token, {
      action: "poll_updates",
      conversation_id: convId,
      since: "",
    });
    const pMsgs = poll.json?.data?.messages || [];
    const pConvs = poll.json?.data?.conversations || [];
    out.csPoll = {
      status: poll.status,
      ok: poll.json?.ok,
      hasMsg: pMsgs.some((m) => String(m.content || "").includes(marker)),
      hasConv: !!pConvs.find((c) => c.id === convId),
      conv: pConvs.find((c) => c.id === convId) || null,
    };

    // Try take if unassigned or assigned to us
    if (out.dbConv && (!out.dbConv.customer_service_id || out.dbConv.customer_service_id === cs.user.id)) {
      const take = await post("/api/customer-service", cs.access_token, {
        action: "take_conversation",
        id: convId,
      });
      out.take = { status: take.status, ok: take.json?.ok, message: take.json?.message };
    }
  }

  fs.writeFileSync(path.join(ROOT, "scripts/_probe-companion-cs-chat-results.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
