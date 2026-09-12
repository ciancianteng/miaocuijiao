import fs from "node:fs";

const env = {};
for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (!m) continue;
  env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const BASE = "https://meow-cuijiao-homepage-staging.vercel.app";
const login = await fetch(`${BASE}/api/auth`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    action: "login",
    email: "boss.final.1785714993009@meow.test",
    password: "McjTest@12345678",
    account: "boss.final.1785714993009@meow.test",
  }),
}).then((r) => r.json());

const token = login.session?.accessToken || login.session?.access_token || "";
console.log("login", login.ok, "token", !!token);

const pending = await fetch(`${BASE}/api/auth?action=pending_forced`, {
  headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
}).then((r) => r.json());

console.log(
  JSON.stringify(
    {
      pendingOk: pending.ok,
      count: (pending.pendingForced || []).length,
      items: (pending.pendingForced || []).map((x) => ({
        title: x.title,
        id: x.id,
        version: x.version,
        contentType: x.contentType,
        contentLen: String(x.content || "").length,
        forceConfirm: x.forceConfirm ?? x.force_confirm,
      })),
      message: pending.message,
      keys: Object.keys(pending || {}),
    },
    null,
    2
  )
);

// also me@ / session profile
const me = await fetch(`${BASE}/api/auth?action=me`, {
  headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
}).then((r) => r.json()).catch((e) => ({ err: String(e) }));
console.log("me", { ok: me.ok, role: me.profile?.role || me.role, pending: (me.pendingForced || []).length, keys: Object.keys(me || {}) });
