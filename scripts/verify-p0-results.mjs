import fs from "fs";
const env = Object.fromEntries(
  fs
    .readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).replace(/^['"]|['"]$/g, "")];
    })
);
const URL = (env.SUPABASE_URL || env.VITE_SUPABASE_URL).replace(/\/$/, "");
const ANON = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const BASE = "https://meow-cuijiao-homepage-hneodzxki-ciancianteng-4581s-projects.vercel.app";
const ORDER = "7f5357f4-e9de-46cd-a31c-9230dde05363";
const CONV = "e48c443d-c46f-4167-8eac-7b43b816b3a7";
const COMP = "c776e811-6003-48a4-8f11-ed9eb1b70898";
const PASS = "McjTest@12345678";

async function auth(email) {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASS }),
  });
  return (await r.json()).access_token;
}
async function rest(path) {
  const r = await fetch(`${URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  });
  return r.json();
}

const bossT = await auth("boss@meow.test");
const compT = await auth("companion@meow.test");
const bossO = await fetch(`${BASE}/api/orders?action=list`, { headers: { Authorization: `Bearer ${bossT}` } }).then((r) => r.json());
const bossRow = (bossO.orders || bossO.data?.orders || []).find((o) => o.id === ORDER);
const comp = await fetch(`${BASE}/api/companion?action=bootstrap`, { headers: { Authorization: `Bearer ${compT}` } }).then((r) => r.json());
const compRow = (comp.data?.myOrders || []).find((o) => o.id === ORDER);
const inbox = await fetch(`${BASE}/api/companion?action=inbox`, { headers: { Authorization: `Bearer ${compT}` } }).then((r) => r.json());
const msgs = await rest(`messages?conversation_id=eq.${CONV}&order=created_at.desc&limit=8&select=id,sender_role,content,read_at,created_at`);
const unreadCs = await rest(`messages?conversation_id=eq.${CONV}&sender_role=eq.customer_service&read_at=is.null&select=id`);
const reads = await rest(`companion_notification_reads?companion_id=eq.${COMP}&select=notice_key,read_at&limit=50`);
const income = await rest(`transactions?user_id=eq.${COMP}&order_id=eq.${ORDER}&select=id,amount,status,transaction_type`);
const dbOrder = await rest(`orders?id=eq.${ORDER}&select=id,order_no,status,companion_id,total_amount`);

console.log(
  JSON.stringify(
    {
      dbOrder,
      bossStatus: bossRow && { status: bossRow.status || bossRow.dbStatus, statusText: bossRow.statusText },
      companionStatus: compRow && { status: compRow.status, statusText: compRow.statusText, income: compRow.playerIncome },
      unreadTotal: inbox.data?.unreadTotal,
      unreadCsDb: (unreadCs || []).length,
      readKeys: (reads || []).length,
      recentMsgs: msgs,
      incomeTx: income,
    },
    null,
    2
  )
);
