/**
 * HTML for /companion/PWxxxx.
 * Injects that companion's Open Graph tags before the browser runs any script.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lookupPublicCompanion } from "./_companion-share-lookup.js";
import {
  applyCompanionShareHtml,
  buildCompanionShareMeta,
  normalizeShareCode,
  shareOrigin,
} from "./_companion-share-meta.js";

let profileTemplate = "";

function readProfileTemplate() {
  if (!profileTemplate) {
    profileTemplate = readFileSync(join(process.cwd(), "profile.html"), "utf8");
  }
  return profileTemplate;
}

function requestCode(req) {
  const fromQuery = req?.query?.code || req?.query?.id || "";
  if (fromQuery) return normalizeShareCode(fromQuery);
  try {
    const url = new URL(req?.url || "/", "http://localhost");
    return normalizeShareCode(url.searchParams.get("code") || url.searchParams.get("id") || "");
  } catch {
    return "";
  }
}

function requestOrigin(req) {
  const headers = req?.headers || {};
  const hinted = String(req?.query?.host || headers["x-mcj-share-host"] || "")
    .split(",")[0]
    .trim();
  if (hinted) return shareOrigin(`https://${hinted}`);
  const host = String(headers["x-forwarded-host"] || headers.host || "")
    .split(",")[0]
    .trim();
  const proto = String(headers["x-forwarded-proto"] || "https")
    .split(",")[0]
    .trim();
  if (!host) return "https://www.meowcuijiao.com";
  return shareOrigin(`${proto}://${host}`);
}

export default async function handler(req, res) {
  const code = requestCode(req);
  const origin = requestOrigin(req);
  let card = null;
  if (code) {
    try {
      card = await lookupPublicCompanion(code);
    } catch (error) {
      console.warn("[companion-share] lookup failed", code, error?.message || error);
    }
  }
  const meta = buildCompanionShareMeta({
    origin,
    publicId: code,
    nickname: card?.name || "",
  });
  const html = applyCompanionShareHtml(readProfileTemplate(), meta);
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(html);
}
