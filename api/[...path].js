/**
 * Single Vercel serverless entry (Hobby ≤12 functions).
 * Routes /api/* → server/api/*.js
 */
import { existsSync } from "node:fs";
import { join, normalize } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = join(process.cwd(), "server", "api");

function cleanSegments(raw) {
  const parts = Array.isArray(raw) ? raw : String(raw || "").split("/");
  return parts
    .map((p) => String(p || "").trim())
    .filter(Boolean)
    .filter((p) => p !== ".." && p !== "." && !p.includes("\\") && !p.startsWith("_"));
}

function segmentsFromReq(req) {
  const url = new URL(req.url || "/", "http://localhost");

  const viaQuery =
    (req.query && (req.query.__path || req.query.path)) ||
    url.searchParams.get("__path") ||
    url.searchParams.get("path") ||
    "";

  let raw = String(viaQuery || "").trim();
  if (Array.isArray(req.query?.path) && !url.searchParams.get("__path")) {
    const joined = req.query.path.join("/");
    if (joined && joined !== "gateway") raw = joined;
    else if (!raw) raw = joined;
  } else if (!raw && typeof req.query?.path === "string") {
    raw = req.query.path;
  }

  if (!raw && url.pathname.startsWith("/api/")) {
    raw = url.pathname.replace(/^\/api\//, "").replace(/\/+$/, "");
  }

  if (raw === "gateway" || String(raw).startsWith("gateway/")) {
    const stripped = String(raw).replace(/^gateway\/?/, "");
    raw = stripped || url.searchParams.get("__path") || "";
  }

  return cleanSegments(raw);
}

function resolveHandler(segments) {
  if (!segments.length) return null;
  const joined = segments.join("/");
  const candidates = [join(ROOT, `${joined}.js`), join(ROOT, joined, "index.js")].map((p) => normalize(p));
  for (const file of candidates) {
    if (!file.startsWith(ROOT)) continue;
    if (existsSync(file)) return file;
  }
  return null;
}

function resolveFn(mod) {
  let fn = mod && (mod.default || mod.handler);
  if (typeof fn === "function") return fn;
  if (fn && typeof fn.default === "function") return fn.default;
  if (fn && typeof fn.handler === "function") return fn.handler;
  if (mod && typeof mod.handler === "function") return mod.handler;
  return null;
}

export default async function handler(req, res) {
  try {
    const segments = segmentsFromReq(req);
    const file = resolveHandler(segments);
    if (!file) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: false, message: "API not found", path: segments.join("/") }));
      return;
    }
    const mod = await import(pathToFileURL(file).href);
    const fn = resolveFn(mod);
    if (typeof fn !== "function") {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: false, message: "Invalid API handler" }));
      return;
    }
    await fn(req, res);
  } catch (error) {
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: false, message: error.message || "API error" }));
    }
  }
}
