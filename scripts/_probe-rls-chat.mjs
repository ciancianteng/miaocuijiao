import fs from "node:fs";
import path from "node:path";
import pg from "pg";

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

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();
try {
  const policies = await client.query(
    `select tablename, policyname, cmd, qual from pg_policies where tablename in ('messages','conversations') order by tablename, policyname`
  );
  console.log("policies", JSON.stringify(policies.rows, null, 2));
  const enumVals = await client.query(
    `select e.enumlabel from pg_type t join pg_enum e on t.oid=e.enumtypid where t.typname='mcj_user_role' order by e.enumsortorder`
  );
  console.log("roles", enumVals.rows.map((r) => r.enumlabel));
  const pub = await client.query(
    `select tablename from pg_publication_tables where pubname='supabase_realtime' and tablename in ('messages','conversations')`
  );
  console.log("realtime", pub.rows);
  // Can CS JWT see companion message via PostgREST-style (simulate with set role)?
  const URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const ANON = process.env.SUPABASE_ANON_KEY || "";
  const PASS = "McjTest@12345678";
  const CS = "service.final.1785714993009@meow.test";
  const COMP = "companion.idcard.1785715257525@meow.test";
  async function login(email) {
    const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: ANON, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: PASS }),
    });
    return r.json();
  }
  const cs = await login(CS);
  const comp = await login(COMP);
  const convId = "5fad0389-b21c-4429-9cb0-a28fbdba86dd";
  async function asUser(token, table, qs) {
    const r = await fetch(`${URL}/rest/v1/${table}${qs}`, {
      headers: {
        apikey: ANON,
        Authorization: `Bearer ${token}`,
      },
    });
    return { status: r.status, body: await r.json() };
  }
  const csMsgs = await asUser(
    cs.access_token,
    "messages",
    `?conversation_id=eq.${convId}&order=created_at.desc&limit=5&select=id,sender_role,content`
  );
  const compMsgs = await asUser(
    comp.access_token,
    "messages",
    `?conversation_id=eq.${convId}&order=created_at.desc&limit=5&select=id,sender_role,content`
  );
  const csConv = await asUser(cs.access_token, "conversations", `?id=eq.${convId}&select=id,companion_id,customer_service_id,conversation_type`);
  const compConv = await asUser(comp.access_token, "conversations", `?id=eq.${convId}&select=id,companion_id,customer_service_id,conversation_type`);
  console.log("cs_jwt_msgs", csMsgs);
  console.log("comp_jwt_msgs", compMsgs);
  console.log("cs_jwt_conv", csConv);
  console.log("comp_jwt_conv", compConv);
} finally {
  await client.end();
}
