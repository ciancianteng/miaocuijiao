#!/usr/bin/env node
/**
 * Reproducible full-site perf baseline against a deployed origin (prod or Preview).
 * Usage: node scripts/perf-fullsite-baseline.mjs [origin]
 */
import fs from "node:fs";
import path from "node:path";

const origin = String(process.argv[2] || "https://www.meowcuijiao.com").replace(/\/$/, "");
const pages = [
  "/",
  "/companion-center.html",
  "/mine.html",
  "/orders.html",
  "/messages.html",
  "/support.html",
  "/recharge.html",
  "/login.html",
  "/companion/index.html",
  "/admin/index.html",
];
const apis = ["/api/home/daily-stats", "/api/public/companions", "/api/platform/services"];

async function timed(url, { method = "GET" } = {}) {
  const t0 = Date.now();
  const res = await fetch(url, {
    method,
    headers: { "user-agent": "mcj-perf-fullsite-baseline/1", accept: "*/*" },
    redirect: "follow",
  });
  const buf = Buffer.from(await res.arrayBuffer());
  const t1 = Date.now();
  return {
    http: res.status,
    ms: t1 - t0,
    bytes: buf.length,
    cacheControl: res.headers.get("cache-control") || "",
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
  html: [],
  apis: [],
};

for (const p of pages) {
  const r = await timed(origin + p);
  out.html.push({ path: p, http: r.http, ms: r.ms, bytes: r.bytes, cacheControl: r.cacheControl });
  process.stdout.write(`HTML ${p} ${r.ms}ms ${r.bytes}b\n`);
}

for (const a of apis) {
  const samples = [];
  let last = null;
  for (let i = 0; i < 3; i++) {
    const r = await timed(origin + a);
    samples.push({ ms: r.ms, bytes: r.bytes, http: r.http });
    last = r;
  }
  let companionCount = null;
  try {
    const j = JSON.parse(last.body.toString("utf8"));
    if (Array.isArray(j.companions)) companionCount = j.companions.length;
  } catch {
    /* ignore */
  }
  out.apis.push({
    path: a,
    samples,
    p50_ms: median(samples.map((s) => s.ms)),
    bytes: samples[0]?.bytes,
    cacheControl: last?.cacheControl || "",
    companionCount,
  });
  process.stdout.write(`API ${a} p50=${median(samples.map((s) => s.ms))}ms cache=${last?.cacheControl}\n`);
}

const dir = path.resolve("docs/perf-fullsite");
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `baseline-${origin.replace(/^https?:\/\//, "").replace(/\W+/g, "_")}-${Date.now()}.json`);
fs.writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
process.stdout.write(`Wrote ${file}\n`);
