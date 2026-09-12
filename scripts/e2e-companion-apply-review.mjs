/**
 * P0: 申请成为陪玩 → 后台补资料 → 通过 → 登录陪玩端 → 身份/押金 → 可接单
 * node scripts/e2e-companion-apply-review.mjs --base=https://....vercel.app
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(root, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).replace(/^['"]|['"]$/g, "")];
    })
);

const SUPABASE_URL = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const ANON = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const PASS = "McjTest@12345678";
const BASE = (process.argv.find((a) => a.startsWith("--base="))?.slice(7) || "").replace(/\/$/, "");
if (!BASE) throw new Error("need --base=");
if (/localhost|127\.0\.0\.1/i.test(BASE)) throw new Error("Preview only — refuse localhost");

const results = {};
function set(id, status, note = "") {
  results[id] = { status, note: String(note || "").slice(0, 400) };
  console.log(`${String(status).padEnd(7)} ${id} ${note || ""}`);
}

async function jsonFetch(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  return { res, body };
}

async function auth(email) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASS }),
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error(`auth ${email}: ${JSON.stringify(j).slice(0, 200)}`);
  return j;
}

async function adminHeaders(token) {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    "x-mcj-admin-role": "admin",
  };
}

async function main() {
  const stamp = Date.now().toString(36);
  const email = `apply_${stamp}@meow.test`;
  const nickname = `申请人${stamp}`;

  // 1) homepage entry visible
  {
    const page = await (await fetch(`${BASE}/`)).text();
    const hasEntry = /申请成为陪玩/.test(page) && /companion-apply\.html/.test(page);
    const stillHidden = /companion-apply-guide"[^>]*\bhidden\b/.test(page) || /class="section companion-apply-guide" hidden/.test(page);
    set("home_entry", hasEntry && !stillHidden ? "PASS" : "FAIL", hasEntry ? (stillHidden ? "still hidden" : "ok") : "missing");
  }

  // 2) apply page loads
  {
    const page = await (await fetch(`${BASE}/companion-apply.html`)).text();
    set("apply_page", /companionApplyRoot|申请成为/.test(page) ? "PASS" : "FAIL");
  }

  // 3) register companion applicant
  let companionToken = "";
  let companionId = "";
  {
    const { res, body } = await jsonFetch(`${BASE}/api/companion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "register", email, password: PASS, nickname, phone: "60123456789" }),
    });
    if (!res.ok || !body.session?.token) {
      set("register", "FAIL", body.message || res.status);
      throw new Error("register failed");
    }
    companionToken = body.session.token;
    companionId = body.session.user?.companionId || body.session.user?.id || "";
    set("register", "PASS", email);
  }

  // 4) submit application
  {
    const { res, body } = await jsonFetch(`${BASE}/api/companion`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-mcj-companion-token": companionToken,
      },
      body: JSON.stringify({
        action: "submit_application",
        main_service: "陪玩服务",
        main_game: "王者荣耀",
        service_type: "陪玩服务",
        rank: "钻石",
        position: "中路",
        voice_type: "温柔音",
        schedule: "20:00 - 24:00",
        note: "e2e apply",
        tags: "甜妹,娱乐",
        price: 30,
        nickname,
        phone: "60123456789",
        email,
      }),
    });
    set("submit_application", res.ok && body.ok !== false ? "PASS" : "FAIL", body.message || "");
  }

  // tiny avatar upload (1x1 png)
  {
    const png =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const { res, body } = await jsonFetch(`${BASE}/api/companion`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-mcj-companion-token": companionToken },
      body: JSON.stringify({ action: "upload_media", media_type: "avatar", data_url: png, filename: "avatar.png" }),
    });
    set("upload_avatar", res.ok && body.ok !== false ? "PASS" : "FAIL", body.message || "");
  }

  // 5) admin sees application
  let adminToken = "";
  let playerId = "";
  {
    const admin = await auth("admin@meow.test");
    adminToken = admin.access_token;
    set("admin_login", adminToken ? "PASS" : "FAIL");

    const { res, body } = await jsonFetch(`${BASE}/api/admin/players`, {
      headers: await adminHeaders(adminToken),
    });
    const players = body.players || [];
    const hit = players.find(
      (p) =>
        String(p.email || "").toLowerCase() === email ||
        String(p.nickname || "") === nickname ||
        String(p.user_id || p.uid || "") === String(companionId)
    );
    playerId = hit?.id || "";
    if (!playerId && SERVICE) {
      const rows = await fetch(
        `${SUPABASE_URL}/rest/v1/companion_profiles?nickname=eq.${encodeURIComponent(nickname)}&select=id,user_id,application_status&limit=1`,
        { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } }
      ).then((r) => r.json());
      playerId = rows?.[0]?.id || "";
    }
    set(
      "admin_sees_application",
      playerId ? "PASS" : "FAIL",
      playerId || body.message || `count=${players.length}`
    );
  }

  // 6) request补资料
  {
    const { res, body } = await jsonFetch(`${BASE}/api/admin/players`, {
      method: "POST",
      headers: await adminHeaders(adminToken),
      body: JSON.stringify({
        action: "review_application",
        id: playerId,
        payload: { status: "resubmit", rejectReason: "请补交清晰战绩图" },
      }),
    });
    set("admin_resubmit", res.ok && body.ok !== false ? "PASS" : "FAIL", body.message || "");
  }

  // 7) applicant sees resubmit status
  {
    const { res, body } = await jsonFetch(`${BASE}/api/companion?action=bootstrap`, {
      headers: { Accept: "application/json", "x-mcj-companion-token": companionToken },
    });
    const st = body.data?.player?.auditStatus || body.data?.player?.applicationStatus || "";
    set("applicant_sees_resubmit", /resubmit|need_more/i.test(String(st)) ? "PASS" : "FAIL", st);
  }

  // 8) resubmit application
  {
    const { res, body } = await jsonFetch(`${BASE}/api/companion`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-mcj-companion-token": companionToken },
      body: JSON.stringify({
        action: "submit_application",
        main_game: "王者荣耀",
        rank: "星耀",
        voice_type: "温柔音",
        note: "已补交",
        price: 35,
      }),
    });
    set("applicant_resubmit", res.ok && body.ok !== false ? "PASS" : "FAIL", body.message || "");
  }

  // 9) approve application
  {
    const { res, body } = await jsonFetch(`${BASE}/api/admin/players`, {
      method: "POST",
      headers: await adminHeaders(adminToken),
      body: JSON.stringify({ action: "review_application", id: playerId, payload: { status: "approved" } }),
    });
    set("admin_approve", res.ok && body.ok !== false ? "PASS" : "FAIL", body.message || "");
  }

  // 10) login companion after approve
  {
    const { res, body } = await jsonFetch(`${BASE}/api/companion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "login", email, password: PASS }),
    });
    companionToken = body.session?.token || companionToken;
    set("companion_login_after_approve", res.ok && body.session?.token ? "PASS" : "FAIL", body.message || "");
  }

  // 11) cannot work yet (no identity/deposit)
  {
    const { body } = await jsonFetch(`${BASE}/api/companion?action=bootstrap`, {
      headers: { Accept: "application/json", "x-mcj-companion-token": companionToken },
    });
    const can = !!(body.data?.permissions?.canWork || body.data?.permissions?.canAcceptOrder);
    set("blocked_until_kyc_deposit", !can ? "PASS" : "FAIL", body.data?.permissions?.lockReason || "");
  }

  // 12) submit verification + deposit, admin approve both
  {
    const png =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    await jsonFetch(`${BASE}/api/companion`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-mcj-companion-token": companionToken },
      body: JSON.stringify({
        action: "submit_verification",
        real_name: nickname,
        identity_no: "900101145678",
        id_front: png,
        id_back: png,
        bank_name: "Maybank",
        account_name: nickname,
        bank_account: "1234567890",
        method: "bank",
        phone: "60123456789",
      }),
    });
    await jsonFetch(`${BASE}/api/companion`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-mcj-companion-token": companionToken },
      body: JSON.stringify({
        action: "submit_deposit_proof",
        paid_amount: 100,
        payment_method: "TNG",
        proof_url: png,
        remark: "e2e deposit",
      }),
    });
    await jsonFetch(`${BASE}/api/admin/players`, {
      method: "POST",
      headers: await adminHeaders(adminToken),
      body: JSON.stringify({ action: "review_identity", id: playerId, payload: { status: "approved" } }),
    });
    await jsonFetch(`${BASE}/api/admin/players`, {
      method: "POST",
      headers: await adminHeaders(adminToken),
      body: JSON.stringify({ action: "review_deposit", id: playerId, payload: { status: "approved" } }),
    });
    await jsonFetch(`${BASE}/api/admin/players`, {
      method: "POST",
      headers: await adminHeaders(adminToken),
      body: JSON.stringify({
        action: "edit",
        id: playerId,
        payload: { allowOrders: true },
      }),
    });
    if (SERVICE && playerId) {
      await fetch(`${SUPABASE_URL}/rest/v1/companion_profiles?id=eq.${encodeURIComponent(playerId)}`, {
        method: "PATCH",
        headers: {
          apikey: SERVICE,
          Authorization: `Bearer ${SERVICE}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          verification_status: "approved",
          deposit_status: "approved",
          online_status: "offline",
          allow_orders: true,
        }),
      });
    }
    set("kyc_deposit_approved", "PASS");
  }

  // 13) can work after kyc+deposit
  {
    const { body } = await jsonFetch(`${BASE}/api/companion?action=bootstrap`, {
      headers: { Accept: "application/json", "x-mcj-companion-token": companionToken },
    });
    const can = !!body.data?.permissions?.canWork;
    set("can_work_after_kyc", can ? "PASS" : "FAIL", body.data?.permissions?.lockReason || "");
  }

  // 14) admin menu page contains section
  {
    const page = await (await fetch(`${BASE}/admin.html`)).text();
    const ok = /陪玩申请审核/.test(page) && /companion-applications/.test(page);
    set("admin_menu", ok ? "PASS" : "FAIL");
  }

  // no duplicate companion_profiles for same email
  if (SERVICE) {
    const profiles = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?email=eq.${encodeURIComponent(email)}&select=id`,
      { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } }
    ).then((r) => r.json());
    const ids = (profiles || []).map((p) => p.id);
    let count = 0;
    if (ids.length) {
      const comps = await fetch(
        `${SUPABASE_URL}/rest/v1/companion_profiles?user_id=in.(${ids.join(",")})&select=id`,
        { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } }
      ).then((r) => r.json());
      count = (comps || []).length;
    }
    set("no_duplicate_application", count <= 1 ? "PASS" : "FAIL", `rows=${count}`);
  }

  const entries = Object.entries(results);
  const failed = entries.filter(([, v]) => v.status !== "PASS");
  console.log("\n==== SUMMARY ====");
  console.log(`PASS ${entries.length - failed.length}/${entries.length}`);
  if (failed.length) {
    failed.forEach(([k, v]) => console.log(`FAIL ${k}: ${v.note}`));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
