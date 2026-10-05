#!/usr/bin/env node
/** Offline regression checks for the 9 / 15–35 service batch (no network, no DB). */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");
const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log("PASS", name);
  } catch (e) {
    results.push({ name, ok: false });
    console.error("FAIL", name, "-", e.message || e);
  }
}

function loadBrowserScript(rel, extra = {}) {
  const store = new Map();
  const ctx = {
    window: {},
    Intl,
    Date,
    JSON,
    Promise,
    setTimeout: () => 0,
    setInterval: () => 0,
    sessionStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
    fetch: () => Promise.resolve({ json: () => Promise.resolve({ settings: {} }) }),
    document: {
      readyState: "loading",
      addEventListener() {},
      querySelector: () => null,
      querySelectorAll: () => [],
      head: { appendChild() {} },
      body: {},
      createElement: () => ({ setAttribute() {} }),
    },
    ...extra,
  };
  vm.runInNewContext(read(rel), ctx);
  return ctx.window;
}

// ---------- #20 CS online hours ----------
await test("#20 badge: 10:00 MYT is online, 13:00 MYT is offline (device timezone ignored)", () => {
  const w = loadBrowserScript("src/cs-online-hours.js");
  const api = w.MCJCsOnlineHours;
  assert.equal(api.isOnline(new Date("2026-10-05T02:00:00Z")), true);
  assert.equal(api.isOnline(new Date("2026-10-05T00:59:00Z")), false);
  assert.equal(api.isOnline(new Date("2026-10-05T04:00:00Z")), false);
  assert.equal(api.isOnline(new Date("2026-10-05T05:00:00Z")), false);
});
await test("#20 badge copy matches spec", () => {
  const src = read("src/cs-online-hours.js");
  assert.match(src, /客服在线时间：/);
  assert.match(src, /当前非客服在线时段，可先提交需求，我们会在客服时间处理。/);
  assert.match(src, /非客服在线时段/);
  const w = loadBrowserScript("src/cs-online-hours.js");
  assert.match(w.MCJCsOnlineHours.html("full"), /早上 9:00 – 12:00/);
});
await test("#20 public settings expose hours but never csCommission / SMTP / AI internals", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "x";
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    text: async () =>
      JSON.stringify([{ data: { csCommission: { baseSalary: 1800 }, smtpHost: "smtp.x", aiSystemPrompt: "p", csOnlineHoursStart: "10:00" } }]),
  });
  try {
    const { default: handler } = await import("../server/api/platform/settings.js");
    let out;
    await handler({ method: "GET" }, { setHeader() {}, status: () => ({ json: (d) => (out = d) }) });
    assert.equal(out.settings.csCommission, undefined);
    assert.equal(out.settings.smtpHost, undefined);
    assert.equal(out.settings.aiSystemPrompt, undefined);
    assert.equal(out.settings.csOnlineHoursStart, "10:00");
    assert.equal(out.settings.csOnlineHoursEnd, "12:00");
  } finally {
    globalThis.fetch = realFetch;
  }
});
await test("#20 admin platform settings save keeps keys owned by other modules (csCommission)", () => {
  const src = read("server/api/admin/platform-settings.js");
  assert.match(src, /data: \{ \.\.\.prevData, \.\.\.settings \}/);
  assert.match(src, /csOnlineHoursStart: hhmmOr\(/);
});
await test("#20 support page + boss header render the badge slots", () => {
  assert.match(read("src/support-chat.js"), /data-cs-online-badge="full"/);
  assert.match(read("src/boss-header.js"), /data-cs-online-badge="compact"/);
});

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
