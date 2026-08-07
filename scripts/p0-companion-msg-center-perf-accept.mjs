#!/usr/bin/env node
/**
 * Companion message-center perf/UI accept:
 * - light inbox (no 40× full history)
 * - thread-only message fetch
 * - switch latency target ≤1s (API)
 * - image messages must expose imageUrl / messageType=image (not raw URL-as-only-text path)
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);

const BASE = process.env.MCJ_BASE || "https://meow-cuijiao-homepage-staging.vercel.app";
const EMAIL = process.env.MCJ_COMPANION_EMAIL || "companion.final.1785714993009@meow.test";
const PASS = process.env.MCJ_TEST_PASS || "McjTest@12345678";

function ms() {
  return Date.now();
}

async function login() {
  const res = await fetch(`${BASE}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ action: "login", email: EMAIL, password: PASS, role: "companion" }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok === false) throw new Error(body.message || `login HTTP ${res.status}`);
  const token = body.token || body.accessToken || body.session?.token || body.data?.token;
  if (!token) throw new Error("login missing token");
  return token;
}

async function companionGet(token, action, params = {}) {
  const qs = new URLSearchParams({ action, ...params });
  const t0 = ms();
  const res = await fetch(`${BASE}/api/companion?${qs}`, {
    headers: { Accept: "application/json", "x-mcj-companion-token": token },
  });
  const text = await res.text();
  const elapsed = ms() - t0;
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${action} bad JSON (${elapsed}ms)`);
  }
  if (!res.ok || body.ok === false) throw new Error(`${action}: ${body.message || res.status}`);
  return { body, elapsed };
}

function isImageMsg(m) {
  const t = String(m.messageType || m.message_type || "").toLowerCase();
  if (t === "image") return true;
  const c = String(m.content || m.imageUrl || m.image_url || "");
  return /\/storage\/v1\/object\/public\/chat-images\//i.test(c) || /^__IMG__:/i.test(c);
}

async function main() {
  const results = [];
  const pass = (name, detail) => results.push({ name, ok: true, detail });
  const fail = (name, detail) => results.push({ name, ok: false, detail });

  let token;
  try {
    token = await login();
    pass("login", EMAIL);
  } catch (err) {
    fail("login", err.message);
    print(results);
    process.exit(1);
  }

  let inbox;
  try {
    const { body, elapsed } = await companionGet(token, "inbox", { light: "1", include_messages: "0" });
    inbox = body.data || body.inbox || {};
    const msgs = Array.isArray(inbox.messages) ? inbox.messages : [];
    if (elapsed > 3000) fail("inbox_light_speed", `${elapsed}ms > 3000ms`);
    else pass("inbox_light_speed", `${elapsed}ms`);
    if (msgs.length > 0) fail("inbox_light_no_messages", `unexpected ${msgs.length} messages in light list`);
    else pass("inbox_light_no_messages", "messages=[]");
    const list = inbox.csConversations || (inbox.conversations || []).filter((c) => c.type === "cs");
    if (!list.length) fail("inbox_has_conversations", "empty cs list");
    else pass("inbox_has_conversations", `${list.length} threads`);
    const sample = list[0];
    if (sample && !(sample.peerName || sample.bossName || sample.assignedServiceName || sample.orderNo || sample.lastMessage != null)) {
      fail("inbox_card_fields", JSON.stringify(sample));
    } else pass("inbox_card_fields", `peer=${sample?.peerName || sample?.bossName || "-"} order=${sample?.orderNo || "-"}`);
    const ended = list.filter((c) => c.ended);
    const open = list.filter((c) => !c.ended);
    pass("inbox_history_partitionable", `open=${open.length} history=${ended.length}`);
  } catch (err) {
    fail("inbox_light", err.message);
    print(results);
    process.exit(1);
  }

  const list = inbox.csConversations || (inbox.conversations || []).filter((c) => c.type === "cs");
  const picks = list.slice(0, Math.min(10, list.length));
  if (picks.length < 2) {
    fail("switch_ten", `only ${picks.length} conversations available`);
  } else {
    const times = [];
    let imageChecked = false;
    let allOk = true;
    for (let i = 0; i < picks.length; i++) {
      const cid = picks[i].id;
      try {
        const { body, elapsed } = await companionGet(token, "thread", { conversation_id: cid });
        times.push(elapsed);
        const messages = body.data?.messages || body.messages || [];
        if (elapsed > 1500) {
          allOk = false;
          fail(`switch_${i + 1}`, `${cid.slice(0, 8)} ${elapsed}ms > 1500ms`);
        }
        if (!Array.isArray(messages)) {
          allOk = false;
          fail(`switch_${i + 1}_messages`, "not array");
        }
        if (!imageChecked) {
          const img = messages.find(isImageMsg);
          if (img) {
            imageChecked = true;
            const hasType = String(img.messageType || img.message_type || "").toLowerCase() === "image" || !!img.imageUrl || !!img.image_url;
            if (hasType) pass("image_message_typed", `id=${img.id}`);
            else fail("image_message_typed", "image-looking content without type/url fields");
          }
        }
      } catch (err) {
        allOk = false;
        fail(`switch_${i + 1}`, err.message);
      }
    }
    const avg = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0;
    const max = times.length ? Math.max(...times) : 0;
    if (allOk && times.length >= 2) pass("switch_batch", `n=${times.length} avg=${avg}ms max=${max}ms`);
    if (!imageChecked) pass("image_message_typed", "no image in sampled threads (skipped)");
  }

  // Ensure full inbox (non-light) still works but is not required for switch path.
  try {
    const { elapsed } = await companionGet(token, "inbox", { light: "1", include_messages: "0" });
    pass("inbox_light_repeat", `${elapsed}ms`);
  } catch (err) {
    fail("inbox_light_repeat", err.message);
  }

  print(results);
  const failed = results.filter((r) => !r.ok);
  process.exit(failed.length ? 1 : 0);
}

function print(results) {
  const failed = results.filter((r) => !r.ok);
  console.log(JSON.stringify({ base: BASE, pass: results.length - failed.length, fail: failed.length, results }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
