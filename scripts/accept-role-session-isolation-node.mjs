/**
 * Node-only selftest of role session isolation helpers (no browser).
 * Also hits /api/auth?action=me for the four P0 accounts.
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

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

const BASE = (process.argv[2] || "https://meow-cuijiao-homepage-staging.vercel.app").replace(/\/$/, "");
const PASS = "McjTest@12345678";
const ACCOUNTS = {
  boss: "boss.final.1785714993009@meow.test",
  customer_service: "service.final.1785714993009@meow.test",
  companion: "companion.idcard.1785715257525@meow.test",
  admin: "admin@meow.test",
};

function makeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(String(k), String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
    _map: map,
  };
}

function loadRoleGate() {
  const code = fs.readFileSync(path.join(ROOT, "src/role-gates.js"), "utf8");
  const localStorage = makeStorage();
  const sessionStorage = makeStorage();
  const location = { pathname: "/index.html", href: BASE + "/index.html", search: "", hash: "" };
  const document = {
    body: { classList: { toggle() {} }, innerHTML: "" },
    documentElement: { setAttribute() {}, style: {} },
    getElementById: () => null,
    querySelector: () => null,
    createElement: () => ({ setAttribute() {}, style: {}, appendChild() {} }),
    head: { appendChild() {} },
    readyState: "complete",
    addEventListener() {},
  };
  const window = {
    location,
    dispatchEvent() {},
    addEventListener() {},
    MCJModal: null,
    MCJBossHeader: null,
    MCJServiceAuth: null,
    MCJCountries: null,
    __MCJBossHeaderScript: true,
    __MCJLaunchFreezeScript: true,
  };
  const ctx = {
    window,
    document,
    localStorage,
    sessionStorage,
    location,
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    Date,
    String,
    JSON,
    Object,
    Array,
    Number,
    Boolean,
    Error,
    console,
    setTimeout,
    clearTimeout,
    CustomEvent: class CustomEvent {
      constructor(type, init) {
        this.type = type;
        this.detail = init && init.detail;
      }
    },
    Event: class Event {
      constructor(type) {
        this.type = type;
      }
    },
  };
  ctx.window.window = window;
  ctx.window.document = document;
  ctx.window.localStorage = localStorage;
  ctx.window.sessionStorage = sessionStorage;
  ctx.window.location = location;
  vm.runInNewContext(code, ctx, { filename: "role-gates.js" });
  return { gate: ctx.window.MCJRoleGate, localStorage, sessionStorage };
}

function dump(store, keys) {
  const out = {};
  for (const k of keys) out[k] = store.getItem(k);
  return out;
}

const KEYS = [
  "customerAuthToken",
  "customerUser",
  "customerServiceAuthToken",
  "customerServiceUser",
  "mcjServiceSession",
  "companionAuthToken",
  "companionUser",
  "mcjCompanionSession",
  "adminAuthToken",
  "adminUser",
  "mcjAuthAccessToken",
  "mcjRole",
];

async function login(email) {
  const res = await fetch(`${BASE}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ action: "login", email, password: PASS }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.ok) throw new Error(`${email}: ${body.message || res.status}`);
  return body.session;
}

async function me(token) {
  const res = await fetch(`${BASE}/api/auth?action=me`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.user) throw new Error(`me: ${body.message || res.status}`);
  return body.user;
}

function norm(r) {
  r = String(r || "").toLowerCase();
  if (r === "customer" || r === "boss") return "boss";
  if (r === "service" || r === "customer_service") return "customer_service";
  if (r === "player" || r === "companion") return "companion";
  if (r === "super_admin" || r === "admin") return "admin";
  return r;
}

const results = { base: BASE, at: new Date().toISOString(), steps: [], ok: true };

try {
  for (const [role, email] of Object.entries(ACCOUNTS)) {
    const session = await login(email);
    const user = await me(session.accessToken);
    const pass = norm(user.role) === norm(role);
    results.steps.push({ step: `api:${role}`, pass, role: user.role, email });
    if (!pass) results.ok = false;
  }

  // Bleed repro: CS session mirrors + stale boss soft session, then boss saveSession
  {
    const { gate, localStorage, sessionStorage } = loadRoleGate();
    const cs = await login(ACCOUNTS.customer_service);
    gate.saveSession(cs, true);
    gate.syncPortalSessions(cs, true);
    // Inject the historical bleed: CS JWT already stored, boss soft left behind
    localStorage.setItem("customerAuthToken", "customer_session_v4_stale");
    localStorage.setItem("customerUser", JSON.stringify({ role: "boss", email: "stale@meow.test" }));
    // Before fix this would be isLogged boss true while JWT is CS.
    const boss = await login(ACCOUNTS.boss);
    gate.saveSession(boss, true);
    const snap = dump(localStorage, KEYS);
    const issues = [];
    if (snap.mcjServiceSession) issues.push("left mcjServiceSession");
    if (snap.customerServiceAuthToken) issues.push("left CS soft token");
    if (!snap.customerAuthToken) issues.push("missing boss soft token");
    if (norm(snap.mcjRole) !== "boss") issues.push(`mcjRole=${snap.mcjRole}`);
    if (!gate.isLogged("boss")) issues.push("isLogged(boss)=false");
    if (gate.isLogged("customer_service")) issues.push("isLogged(cs)=true");
    const user = await me(snap.mcjAuthAccessToken);
    if (norm(user.role) !== "boss") issues.push(`/me=${user.role}`);
    const pass = issues.length === 0;
    results.steps.push({ step: "vm:cs-stale-then-boss", pass, issues, snap });
    if (!pass) results.ok = false;
  }

  // CS login must wipe boss soft session
  {
    const { gate, localStorage } = loadRoleGate();
    const boss = await login(ACCOUNTS.boss);
    gate.saveSession(boss, true);
    const cs = await login(ACCOUNTS.customer_service);
    gate.saveSession(cs, true);
    gate.syncPortalSessions(cs, true);
    const snap = dump(localStorage, KEYS);
    const issues = [];
    if (snap.customerAuthToken) issues.push("CS left boss soft token");
    if (gate.isLogged("boss")) issues.push("isLogged(boss) after CS");
    if (norm(snap.mcjRole) !== "customer_service") issues.push(`mcjRole=${snap.mcjRole}`);
    const user = await me(snap.mcjAuthAccessToken);
    if (norm(user.role) !== "customer_service") issues.push(`/me=${user.role}`);
    const pass = issues.length === 0;
    results.steps.push({ step: "vm:boss-then-cs", pass, issues });
    if (!pass) results.ok = false;
  }

  // Switch through all four — exclusive each time
  {
    const { gate, localStorage } = loadRoleGate();
    for (const role of ["boss", "customer_service", "companion", "admin"]) {
      const session = await login(ACCOUNTS[role]);
      gate.saveSession(session, true);
      gate.syncPortalSessions(session, true);
      const snap = dump(localStorage, KEYS);
      const issues = [];
      const others = {
        boss: ["mcjServiceSession", "customerServiceAuthToken", "mcjCompanionSession", "adminAuthToken"],
        customer_service: ["customerAuthToken", "mcjCompanionSession", "adminAuthToken"],
        companion: ["customerAuthToken", "mcjServiceSession", "adminAuthToken"],
        admin: ["customerAuthToken", "mcjServiceSession", "mcjCompanionSession"],
      }[role];
      for (const k of others) if (snap[k]) issues.push(`left ${k}`);
      if (norm(snap.mcjRole) !== norm(role) && role !== "admin") {
        // admin role may be super_admin
        if (!(role === "admin" && /admin/.test(String(snap.mcjRole || "")))) {
          issues.push(`mcjRole=${snap.mcjRole}`);
        }
      }
      const user = await me(snap.mcjAuthAccessToken);
      if (norm(user.role) !== norm(role)) issues.push(`/me=${user.role}`);
      if (role === "boss" && !gate.isLogged("boss")) issues.push("boss not logged");
      if (role !== "boss" && gate.isLogged("boss")) issues.push("boss still logged");
      const pass = issues.length === 0;
      results.steps.push({ step: `vm:exclusive:${role}`, pass, issues, meRole: user.role });
      if (!pass) results.ok = false;
    }
  }

  // Logout clears that role completely
  {
    const { gate, localStorage } = loadRoleGate();
    const boss = await login(ACCOUNTS.boss);
    gate.saveSession(boss, true);
    gate.logout("boss");
    const snap = dump(localStorage, KEYS);
    const issues = [];
    if (snap.customerAuthToken || snap.mcjAuthAccessToken || snap.mcjRole) issues.push("boss logout incomplete");
    if (gate.isLogged("boss")) issues.push("still logged after logout");
    const pass = issues.length === 0;
    results.steps.push({ step: "vm:logout-boss", pass, issues });
    if (!pass) results.ok = false;
  }
} catch (err) {
  results.ok = false;
  results.error = String(err && err.stack ? err.stack : err);
}

const outPath = path.join(ROOT, "scripts/accept-role-session-isolation-results.json");
fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
console.log(JSON.stringify({ ok: results.ok, outPath, steps: results.steps.length }, null, 2));
for (const s of results.steps) {
  console.log(`${s.pass ? "PASS" : "FAIL"}\t${s.step}${s.issues?.length ? "\t" + s.issues.join("; ") : ""}`);
}
if (results.error) console.error(results.error);
process.exit(results.ok ? 0 : 1);
