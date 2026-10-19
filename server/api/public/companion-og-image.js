/**
 * Same-origin avatar for one companion share card.
 * The image is resolved from that PW code only. It never accepts an arbitrary URL.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, normalize } from "node:path";
import { lookupPublicCompanion } from "../_companion-share-lookup.js";
import { normalizeShareCode } from "../_companion-share-meta.js";

const PUBLIC_ROOT = join(process.cwd(), "public");
const BRAND_IMAGE = join(PUBLIC_ROOT, "og", "share-card-square-v2.jpg");
const DEFAULT_AVATAR = join(PUBLIC_ROOT, "default-avatar.png");
const MAX_BYTES = 8 * 1024 * 1024;

function requestCode(req) {
  const fromQuery = req?.query?.code || "";
  if (fromQuery) return normalizeShareCode(fromQuery);
  try {
    const url = new URL(req?.url || "/", "http://localhost");
    return normalizeShareCode(url.searchParams.get("code") || "");
  } catch {
    return "";
  }
}

function sendFile(res, filePath, contentType) {
  const body = readFileSync(filePath);
  res.statusCode = 200;
  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "public, max-age=300");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(body);
}

function sendBrand(res) {
  sendFile(res, BRAND_IMAGE, "image/jpeg");
}

function localPublicFile(urlPath) {
  const rel = String(urlPath || "").replace(/^\/+/, "");
  if (!rel || rel.includes("..") || rel.includes("\\")) return "";
  const file = normalize(join(PUBLIC_ROOT, rel));
  if (!file.startsWith(PUBLIC_ROOT)) return "";
  return existsSync(file) ? file : "";
}

function contentTypeFor(filePath, headerType) {
  const header = String(headerType || "").split(";")[0].trim().toLowerCase();
  if (/^image\/(jpeg|png|webp|gif)$/.test(header)) return header;
  if (/\.png$/i.test(filePath)) return "image/png";
  if (/\.webp$/i.test(filePath)) return "image/webp";
  if (/\.gif$/i.test(filePath)) return "image/gif";
  return "image/jpeg";
}

function allowedAvatarUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase();
  if (host === "www.meowcuijiao.com" || host === "meowcuijiao.com") return url;
  if (host.endsWith(".supabase.co")) return url;
  return null;
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET, HEAD");
    res.end("Method Not Allowed");
    return;
  }
  const code = requestCode(req);
  if (!code) {
    sendBrand(res);
    return;
  }
  try {
    const card = await lookupPublicCompanion(code);
    const avatar = String(card?.avatar || "").trim();
    if (!card || !avatar || /default-avatar\.png/i.test(avatar)) {
      if (existsSync(DEFAULT_AVATAR) && card && /default-avatar\.png/i.test(avatar)) {
        sendFile(res, DEFAULT_AVATAR, "image/png");
        return;
      }
      sendBrand(res);
      return;
    }
    if (avatar.startsWith("/")) {
      const file = localPublicFile(avatar);
      if (!file) {
        sendBrand(res);
        return;
      }
      sendFile(res, file, contentTypeFor(file));
      return;
    }
    const remote = allowedAvatarUrl(avatar);
    if (!remote) {
      sendBrand(res);
      return;
    }
    const upstream = await fetch(remote, { redirect: "manual" });
    const type = contentTypeFor("", upstream.headers.get("content-type"));
    if (!upstream.ok || !/^image\//i.test(upstream.headers.get("content-type") || "")) {
      sendBrand(res);
      return;
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.length < 32 || buf.length > MAX_BYTES) {
      sendBrand(res);
      return;
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", type);
    res.setHeader("Cache-Control", "public, max-age=300");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.end(buf);
  } catch (error) {
    console.warn("[companion-og-image] failed", code, error?.message || error);
    if (!res.headersSent) sendBrand(res);
  }
}
