#!/usr/bin/env node
/**
 * Reproducible full-site perf baseline against a deployed origin (prod or Preview).
 * Usage: node scripts/perf-fullsite-baseline.mjs [origin]
 *
 * Captures HTML TTFB proxy, API cold/warm p50, Cache-Control, x-vercel-cache / age.
 */
import fs from "node:fs";
import path from "node:path";

const origin = String(process.argv[2] || "https://www.meowcuijiao.com").replace(/\/$/, "");
const pages = [
  "/",
  "/companion-center.html",
  "/companion-detail.html",
  "/mine.html",
  "/orders.html",
  "/messages.html",
  "/support.html",
  "/recharge.html",
  "/login.html",
  "/companion/index.html",
  "/companion/dashboard/index.html",
  "/admin/index.html",
];
const apis = ["/api/home/daily-stats", "/api/public/companions", "/api/platform/services"];

async function timed(url, { method = "GET", bust = false } = {}) {
  const target = bust ? `${url}${url.includes("?") ? "&" : "?"}_bust=${Date.now()}` : url;
  const t0 = Date.now();
  const res = await fetch(target, {
    method,
    headers: {
      "user-agent": "mcj-perf-fullsite-baseline/2",
      accept: "*/*",
      ...(bust ? { "cache-control": "no-cache", pragma: "no-cache" } : {}),
    },
    redirect: "follow",
  });
  const buf = Buffer.from(await res.arrayBuffer());
  const t1 = Date.now();
  return {
    http: res.status,
    ms: t1 - t0,
    bytes: buf.length,
    cacheControl: res.headers.get("cache-control") || "",
    cdnCacheControl: res.headers.get("cdn-cache-control") || "",
    xVercelCache: res.headers.get("x-vercel-cache") || "",
    age: res.headers.get("age") || "",
    memCache: res.headers.get("x-mcj-mem-cache") || "",
    body: buf,
  };
}

function median(nums) {
  const a = [...nums].sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)];
}

const out = {
  at: new Date().toISOString(),
  origin,
  note: "Server-side fetch latency (includes network RTT). Not Lab Web Vitals.",
  html: [],
  apis: [],
};

for (const p of pages) {
  const r = await timed(origin + p);
  out.html.push({
    path: p,
    http: r.http,
    ms: r.ms,
    bytes: r.bytes,
    cacheControl: r.cacheControl,
    xVercelCache: r.xVercelCache,
  });
  process.stdout.write(`HTML ${p} ${r.ms}ms ${r.bytes}b xvc=${r.xVercelCache}\n`);
}

for (const a of apis) {
  // cold-ish: cache-bust query (edge may still vary by query string)
  const cold = await timed(origin + a, { bust: true });
  const samples = [];
  let last = cold;
  for (let i = 0; i < 3; i++) {
    const r = await timed(origin + a);
    samples.push({
      ms: r.ms,
      bytes: r.bytes,
      http: r.http,
      xVercelCache: r.xVercelCache,
      age: r.age,
      memCache: r.memCache,
    });
    last = r;
  }
  let companionCount = null;
  let onlineCompanions = null;
  try {
    const j = JSON.parse(last.body.toString("utf8"));
    if (Array.isArray(j.companions)) companionCount = j.companions.length;
    if (j.onlineCompanions != null) onlineCompanions = j.onlineCompanions;
  } catch {
    /* ignore */
  }
  const entry = {
    path: a,
    cold_bust_ms: cold.ms,
    cold_xVercelCache: cold.xVercelCache,
    samples,
    p50_ms: median(samples.map((s) => s.ms)),
    bytes: samples[0]?.bytes,
    cacheControl: last?.cacheControl || "",
    cdnCacheControl: last?.cdnCacheControl || "",
    warm_xVercelCache: last?.xVercelCache || "",
    warm_age: last?.age || "",
    warm_memCache: last?.memCache || "",
    companionCount,
    onlineCompanions,
  };
  out.apis.push(entry);
  process.stdout.write(
    `API ${a} cold=${cold.ms}ms/${cold.xVercelCache} p50=${entry.p50_ms}ms warm=${last?.xVercelCache} mem=${last?.memCache} cache=${last?.cacheControl}\n`
  );
}

const dir = path.resolve("docs/perf-fullsite");
fs.mkdirSync(dir, { recursive: true });
const file = path.join(
  dir,
  `baseline-${origin.replace(/^https?:\/\//, "").replace(/\W+/g, "_")}-${Date.now()}.json`
);
fs.writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
process.stdout.write(`Wrote ${file}\n`);
