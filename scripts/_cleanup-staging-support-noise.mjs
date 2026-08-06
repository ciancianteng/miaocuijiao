/**
 * Soft-clean staging exposure: close orphan/general support threads that have
 * no messages or clearly belong to flow-test noise. Does NOT delete real orders.
 * Usage: node scripts/_cleanup-staging-support-noise.mjs
 */
import fs from "node:fs";
import path from "node:path";

function loadEnv() {
  for (const f of [".env.local", ".env"]) {
    const p = path.resolve(f);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq < 0) continue;
      const k = t.slice(0, eq).trim();
      const v = t.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
      if (k && v && !process.env[k]) process.env[k] = v;
    }
  }
}

loadEnv();
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.log("SKIP cleanup: missing SUPABASE_URL / SERVICE_ROLE_KEY");
  process.exit(0);
}

const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

async function sb(pathname, init = {}) {
  const res = await fetch(`${url}/rest/v1/${pathname}`, { ...init, headers: { ...headers, ...(init.headers || {}) } });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) throw new Error(JSON.stringify(body));
  return body;
}

const convs = await sb("conversations?select=id,boss_id,order_id,status,conversation_type,updated_at&order=updated_at.desc&limit=200");
let closed = 0;
for (const c of convs || []) {
  const msgs = await sb(`messages?conversation_id=eq.${encodeURIComponent(c.id)}&select=id&limit=1`);
  const empty = !Array.isArray(msgs) || msgs.length === 0;
  const general = !c.order_id;
  if (empty && general && String(c.status || "") !== "closed") {
    await sb(`conversations?id=eq.${encodeURIComponent(c.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "closed", updated_at: new Date().toISOString() }),
    });
    closed += 1;
  }
}
console.log(JSON.stringify({ scanned: (convs || []).length, closedEmptyGeneral: closed }, null, 2));
