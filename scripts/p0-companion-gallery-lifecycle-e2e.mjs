/**
 * P0: Companion gallery full lifecycle — append / durable delete / no UUID leak / refresh.
 *
 * Usage:
 *   PREVIEW=https://meow-cuijiao-homepage-staging.vercel.app node scripts/p0-companion-gallery-lifecycle-e2e.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.PREVIEW || "https://meow-cuijiao-homepage-staging.vercel.app").replace(/\/$/, "");
const PASS = process.env.PASS || "McjTest@12345678";
const COMP = process.env.E2E_COMPANION_EMAIL || "companion@meow.test";
const ART = path.join("/opt/cursor/artifacts", "companion-gallery-lifecycle-e2e");
const ART_REPO = path.join(ROOT, "artifacts", "companion-gallery-lifecycle-e2e");
fs.mkdirSync(ART, { recursive: true });
fs.mkdirSync(ART_REPO, { recursive: true });

const report = {
  append_A_B: "FAIL",
  append_A_B_C: "FAIL",
  refresh_keeps_ABC: "FAIL",
  delete_B_durable: "FAIL",
  refresh_no_B_resurrect: "FAIL",
  append_D_after_delete: "FAIL",
  no_uuid_syntax_error: "FAIL",
  ids_are_uuid: "FAIL",
  avatar_upload: "FAIL",
  voice_upload: "FAIL",
  video_upload: "FAIL",
  records_gallery_append: "FAIL",
};

const results = [];
function step(name, ok, detail) {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "").slice(0, 900) });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
  return ok;
}

function tinyPngDataUrl(seed = 0) {
  // Minimal unique-ish 1x1 PNGs by altering a byte in the IDAT-ish payload via different colors is hard;
  // use distinct filenames + same tiny PNG buffer for content — path uniqueness comes from server buildObjectPath.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMsN9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWh6oAAAAASUVORK5CYII=",
    "base64"
  );
  // tweak one byte for uniqueness when seed > 0
  const buf = Buffer.from(png);
  if (seed) buf[buf.length - 8] = (buf[buf.length - 8] + seed) % 256;
  return `data:image/png;base64,${buf.toString("base64")}`;
}

function tinyWavDataUrl() {
  const sampleRate = 8000;
  const n = sampleRate;
  const dataSize = n * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.sin((i / sampleRate) * 440 * Math.PI * 2) * 8000, 44 + i * 2);
  return `data:audio/wav;base64,${buf.toString("base64")}`;
}

function isUuid(id) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id || ""));
}

async function login() {
  const res = await fetch(`${BASE}/api/companion`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ action: "login", account: COMP, email: COMP, password: PASS }),
  });
  const json = await res.json().catch(() => ({}));
  const token = json?.session?.accessToken || json?.session?.token || json?.accessToken || json?.token || "";
  if (!res.ok || !token) throw new Error(`login failed: ${json.message || res.status}`);
  return { token, refreshToken: json?.session?.refreshToken || json?.refreshToken || "", json };
}

async function api(token, body) {
  const res = await fetch(`${BASE}/api/companion`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-mcj-companion-token": token,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok && json.ok !== false, status: res.status, json, rawMessage: json.message || "" };
}

function galleryOf(bootstrap) {
  const media = bootstrap?.media || bootstrap?.data?.media || [];
  return (media || [])
    .filter((m) => String(m.mediaType || m.media_type || "") === "gallery")
    .filter((m) => !/^video\//i.test(String(m.contentType || m.content_type || "")))
    .slice()
    .sort((a, b) => Number(a.sortOrder ?? a.sort_order ?? 0) - Number(b.sortOrder ?? b.sort_order ?? 0));
}

async function bootstrap(token) {
  const res = await fetch(`${BASE}/api/companion?action=bootstrap`, {
    headers: { Accept: "application/json", "x-mcj-companion-token": token, Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  return json?.data || json;
}

async function clearGallery(token) {
  let boot = await bootstrap(token);
  let g = galleryOf(boot);
  for (const item of g) {
    const del = await api(token, { action: "delete_media", media_id: item.id, media_type: "gallery" });
    if (!del.ok) {
      // synthetic id path should still succeed after fix
      console.warn("delete during clear:", del.rawMessage, item.id);
    }
  }
  boot = await bootstrap(token);
  return galleryOf(boot);
}

async function main() {
  const meta = { base: BASE, companion: COMP, galleryIds: [], errors: [] };
  let token = "";
  try {
    const logged = await login();
    token = logged.token;
    step("login", !!token, COMP);
  } catch (e) {
    step("login", false, e.message || e);
    writeOut(meta);
    process.exit(1);
  }

  // Start from clean gallery for deterministic A→B→C.
  const cleared = await clearGallery(token);
  step("clear_gallery", cleared.length === 0, `remaining=${cleared.length}`);

  const paths = {};
  const ids = {};

  // Upload A, B, C
  for (const label of ["A", "B", "C"]) {
    const up = await api(token, {
      action: "upload_media",
      media_type: "gallery",
      data_url: tinyPngDataUrl(label.charCodeAt(0)),
      filename: `gallery-${label.toLowerCase()}.png`,
    });
    const uuidErr = /invalid input syntax for type uuid/i.test(up.rawMessage || JSON.stringify(up.json));
    if (uuidErr) meta.errors.push(up.rawMessage);
    step(`upload_${label}`, up.ok && !uuidErr, up.ok ? up.json?.media?.id || up.json?.path : up.rawMessage);
    if (up.ok) {
      paths[label] = up.json?.path || up.json?.media?.path || "";
      ids[label] = up.json?.media?.id || "";
    }
  }

  let boot = await bootstrap(token);
  let g = galleryOf(boot);
  const hasAB = g.length >= 2;
  report.append_A_B = hasAB ? "PASS" : "FAIL";
  step("append_A_B", hasAB, `count=${g.length} ids=${g.map((x) => x.id).join(",")}`);

  const hasABC = g.length >= 3;
  report.append_A_B_C = hasABC ? "PASS" : "FAIL";
  step("append_A_B_C", hasABC, `count=${g.length}`);

  boot = await bootstrap(token);
  g = galleryOf(boot);
  report.refresh_keeps_ABC = g.length >= 3 ? "PASS" : "FAIL";
  step("refresh_keeps_ABC", g.length >= 3, `count=${g.length}`);

  const allUuid = g.every((x) => isUuid(x.id));
  report.ids_are_uuid = allUuid ? "PASS" : "FAIL";
  step("ids_are_uuid", allUuid, g.map((x) => x.id).join(" | "));
  meta.galleryIds = g.map((x) => x.id);

  // Delete middle item B (by path match if ids remapped)
  let bItem = g.find((x) => String(x.id) === String(ids.B)) || g[1];
  const delB = await api(token, { action: "delete_media", media_id: bItem.id, media_type: "gallery" });
  const uuidOnDelete = /invalid input syntax for type uuid/i.test(delB.rawMessage || "");
  if (uuidOnDelete) meta.errors.push(delB.rawMessage);
  step("delete_B", delB.ok && !uuidOnDelete, delB.ok ? bItem.id : delB.rawMessage);

  boot = await bootstrap(token);
  g = galleryOf(boot);
  const bGone = !g.some((x) => String(x.id) === String(bItem.id));
  report.delete_B_durable = bGone && g.length === 2 ? "PASS" : "FAIL";
  step("delete_B_durable", report.delete_B_durable === "PASS", `count=${g.length} ids=${g.map((x) => x.id).join(",")}`);

  boot = await bootstrap(token);
  g = galleryOf(boot);
  const stillGone = !g.some((x) => String(x.id) === String(bItem.id));
  report.refresh_no_B_resurrect = stillGone && g.length === 2 ? "PASS" : "FAIL";
  step("refresh_no_B_resurrect", report.refresh_no_B_resurrect === "PASS", `count=${g.length}`);

  const upD = await api(token, {
    action: "upload_media",
    media_type: "gallery",
    data_url: tinyPngDataUrl(4),
    filename: "gallery-d.png",
  });
  boot = await bootstrap(token);
  g = galleryOf(boot);
  report.append_D_after_delete = upD.ok && g.length === 3 ? "PASS" : "FAIL";
  step("append_D_after_delete", report.append_D_after_delete === "PASS", `count=${g.length} msg=${upD.rawMessage}`);

  report.no_uuid_syntax_error = meta.errors.length === 0 ? "PASS" : "FAIL";
  step("no_uuid_syntax_error", meta.errors.length === 0, meta.errors.join(" | ") || "none");

  // Avatar / voice / video smoke
  const av = await api(token, {
    action: "upload_media",
    media_type: "avatar",
    data_url: tinyPngDataUrl(9),
    filename: "avatar.png",
  });
  report.avatar_upload = av.ok ? "PASS" : "FAIL";
  step("avatar_upload", av.ok, av.rawMessage || av.json?.path || "");

  const voice = await api(token, {
    action: "upload_media",
    media_type: "voice",
    data_url: tinyWavDataUrl(),
    filename: "voice.wav",
  });
  report.voice_upload = voice.ok ? "PASS" : "FAIL";
  step("voice_upload", voice.ok, voice.rawMessage || voice.json?.path || "");

  // Minimal mp4 (ftyp+mdat) — may fail validation; treat soft
  const mp4 = Buffer.from(
    "AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAAu1tZGF0",
    "base64"
  );
  const video = await api(token, {
    action: "upload_media",
    media_type: "video",
    data_url: `data:video/mp4;base64,${mp4.toString("base64")}`,
    filename: "showcase.mp4",
    duration_seconds: 2,
  });
  report.video_upload = video.ok ? "PASS" : "FAIL";
  step("video_upload", video.ok, video.rawMessage || video.json?.path || "video may reject invalid bytes");

  const records = await api(token, {
    action: "upload_media",
    media_type: "gallery",
    data_url: tinyPngDataUrl(11),
    filename: "records.png",
  });
  boot = await bootstrap(token);
  g = galleryOf(boot);
  report.records_gallery_append = records.ok && g.length >= 4 ? "PASS" : "FAIL";
  step("records_gallery_append", report.records_gallery_append === "PASS", `count=${g.length}`);

  writeOut(meta);
  const failed = results.filter((r) => r.result === "FAIL" && !/^video_upload$/.test(r.step));
  // video soft — don't fail whole suite if only video binary invalid
  const hardFail = results.filter(
    (r) =>
      r.result === "FAIL" &&
      ![
        "video_upload",
      ].includes(r.step)
  );
  process.exit(hardFail.length ? 1 : 0);
}

function writeOut(meta) {
  const out = { report, results, meta, at: new Date().toISOString() };
  fs.writeFileSync(path.join(ART, "results.json"), JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(ART_REPO, "results.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
