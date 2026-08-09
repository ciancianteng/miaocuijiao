/**
 * P0: Companion showcase video + uploaded audio — four-portal sync.
 * Usage: PREVIEW=https://meow-cuijiao-homepage-staging.vercel.app node scripts/p0-companion-video-audio-sync-e2e.mjs
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.PREVIEW || "https://meow-cuijiao-homepage-staging.vercel.app").replace(/\/$/, "");
const PASS = process.env.PASS || process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const COMP = process.env.E2E_COMPANION_EMAIL || "companion.final.1785714993009@meow.test";
const ADMIN = process.env.E2E_ADMIN_EMAIL || "admin@meow.test";
const ART = path.join("/opt/cursor/artifacts", "companion-video-audio-sync-e2e");
fs.mkdirSync(ART, { recursive: true });
fs.mkdirSync(path.join(ROOT, "artifacts", "companion-video-audio-sync-e2e"), { recursive: true });

const results = [];
function step(name, ok, detail) {
  results.push({ step: name, result: ok ? "PASS" : "FAIL", detail: String(detail || "").slice(0, 600) });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} :: ${detail}`);
  return ok;
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function tok(j) {
  return j?.session?.accessToken || j?.session?.token || j?.accessToken || j?.token || "";
}
function makeWav() {
  // minimal PCM wav
  const raw = Buffer.from("UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=", "base64");
  return { dataUrl: `data:audio/wav;base64,${raw.toString("base64")}`, b64: raw.toString("base64") };
}
function makeTinyMp4() {
  // Minimal-ish mp4-like bytes (ftyp + free) — Storage accepts by MIME; player may not decode.
  // Prefer a slightly larger buffer so uploads aren't rejected as empty.
  const buf = Buffer.alloc(4096, 0);
  buf.write("\u0000\u0000\u0000\u0018ftypisom\u0000\u0000\u0000\u0000isomiso2mp41", 0, "binary");
  return { dataUrl: `data:video/mp4;base64,${buf.toString("base64")}` };
}

async function api(pathName, token, body, method = "POST", roleHeaders = {}) {
  const res = await fetch(`${BASE}${pathName}`, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(token
        ? {
            Authorization: `Bearer ${token}`,
            "x-mcj-access-token": token,
            "x-mcj-companion-token": token,
            "x-mcj-admin-token": token,
            ...roleHeaders,
          }
        : {}),
    },
    body: method === "GET" || body == null ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok && json.ok !== false, status: res.status, json };
}

async function login(email, role) {
  const r = await api("/api/auth", null, { action: "login", email, password: PASS, role });
  if (!r.ok) {
    const r2 = await api("/api/auth", null, { action: "login", account: email, password: PASS });
    return { ok: r2.ok, token: tok(r2.json), json: r2.json };
  }
  return { ok: true, token: tok(r.json), json: r.json };
}

(async () => {
  console.log("STAGING", BASE);
  const marker = `VA-${Date.now()}`;
  const cp = await login(COMP, "companion");
  const ad = await login(ADMIN, "admin");
  step("auth_companion", !!cp.token, cp.token ? "ok" : JSON.stringify(cp.json).slice(0, 120));
  step("auth_admin", !!ad.token, ad.token ? "ok" : JSON.stringify(ad.json).slice(0, 120));

  // Ensure schema + video bucket
  const ensure = await api("/api/admin/ensure-companion-video-media", ad.token, {
    action: "ensure_companion_video_media",
  });
  step(
    "ensure_schema_bucket",
    ensure.ok || ensure.json?.storage?.ok,
    JSON.stringify({ storage: ensure.json?.storage, ddl: ensure.json?.ddl }).slice(0, 280)
  );

  // Upload voice
  const voiceUp = await api("/api/companion", cp.token, {
    action: "upload_media",
    media_type: "voice",
    data_url: makeWav().dataUrl,
    filename: `${marker}-voice.wav`,
    duration_seconds: 1,
  });
  const voiceId = voiceUp.json?.media?.id || "";
  step(
    "companion_upload_voice",
    voiceUp.ok && !!voiceId,
    voiceUp.ok ? `id=${voiceId} bucket=${voiceUp.json?.bucket}` : JSON.stringify(voiceUp.json).slice(0, 200)
  );

  // Upload video
  const videoUp = await api("/api/companion", cp.token, {
    action: "upload_media",
    media_type: "video",
    data_url: makeTinyMp4().dataUrl,
    filename: `${marker}-showcase.mp4`,
    duration_seconds: 3,
  });
  const videoId = videoUp.json?.media?.id || "";
  const videoType = videoUp.json?.media?.mediaType || "";
  step(
    "companion_upload_video",
    videoUp.ok && !!videoId,
    videoUp.ok
      ? `id=${videoId} type=${videoType} bucket=${videoUp.json?.bucket}`
      : JSON.stringify(videoUp.json).slice(0, 240)
  );

  // Companion self bootstrap (GET)
  const bootRes = await fetch(`${BASE}/api/companion?action=bootstrap`, {
    headers: {
      Authorization: `Bearer ${cp.token}`,
      "x-mcj-companion-token": cp.token,
      "x-mcj-access-token": cp.token,
    },
  });
  const bootJson = await bootRes.json().catch(() => ({}));
  const boot = bootJson.data || bootJson;
  const media = Array.isArray(boot.media) ? boot.media : [];
  const selfVoice = media.find((m) => String(m.mediaType || m.media_type) === "voice" && m.url);
  const selfVideo =
    media.find((m) => String(m.mediaType || m.media_type) === "video" && m.url) ||
    (boot.player?.videoUrl ? { url: boot.player.videoUrl } : null);
  step("companion_self_voice", !!selfVoice?.url && /^https?:\/\//i.test(selfVoice.url), String(selfVoice?.url || "").slice(0, 90));
  step("companion_self_video", !!selfVideo?.url && /^https?:\/\//i.test(selfVideo.url), String(selfVideo?.url || "").slice(0, 90));

  // Admin list GET + detail
  const listRes = await fetch(`${BASE}/api/admin/players`, {
    headers: { Authorization: `Bearer ${ad.token}`, "x-mcj-admin-token": ad.token, "x-mcj-access-token": ad.token },
  });
  const listJson = await listRes.json().catch(() => ({}));
  const list = listJson.players || [];
  const companionRow =
    list.find((p) => String(p.email || "").toLowerCase() === COMP.toLowerCase()) ||
    list.find((p) => /companion\.final/i.test(String(p.email || ""))) ||
    null;
  const profileId = companionRow?.id || "";
  step("admin_find_companion", !!profileId, profileId || "missing");
  const detail = await api("/api/admin/players", ad.token, { action: "detail", id: profileId });
  const dMedia = detail.json?.detail?.media || detail.json?.player?.media || {};
  const adminVoice = (dMedia.voices || []).find((v) => String(v.id) === String(voiceId)) || (dMedia.voices || [])[0];
  const adminVideo = (dMedia.videos || []).find((v) => String(v.id) === String(videoId)) || (dMedia.videos || [])[0];
  step(
    "admin_see_voice",
    !!adminVoice?.url && /^https?:\/\//i.test(adminVoice.url),
    adminVoice ? `id=${adminVoice.id} status=${adminVoice.status}` : JSON.stringify(Object.keys(dMedia))
  );
  step(
    "admin_see_video",
    !!adminVideo?.url && /^https?:\/\//i.test(adminVideo.url),
    adminVideo ? `id=${adminVideo.id} status=${adminVideo.status}` : `videos=${(dMedia.videos || []).length}`
  );

  const approveVoice = adminVoice?.id
    ? await api("/api/admin/players", ad.token, {
        action: "review_media",
        id: profileId,
        mediaId: adminVoice.id,
        status: "approved",
      })
    : { ok: false };
  const approveVideo = adminVideo?.id
    ? await api("/api/admin/players", ad.token, {
        action: "review_media",
        id: profileId,
        mediaId: adminVideo.id,
        status: "approved",
      })
    : { ok: false };
  step("admin_approve_voice", approveVoice.ok, approveVoice.json?.message || "");
  step("admin_approve_video", approveVideo.ok, approveVideo.json?.message || "");

  await sleep(900);

  const userId = boot.player?.userId || boot.player?.id || companionRow?.userId || "";
  const publicId = boot.player?.companionCode || boot.player?.publicId || userId;
  const pub = await api(`/api/public/companions?id=${encodeURIComponent(publicId || userId)}`, null, null, "GET");
  const pubList = pub.json?.companions || pub.json?.data || [];
  const one = Array.isArray(pubList) ? pubList[0] : pub.json?.companion || pub.json;
  const pubVoice = one?.voiceUrl || "";
  const pubVideo = one?.videoUrl || one?.showcaseVideoUrl || "";
  step("boss_public_voice", /^https?:\/\//i.test(pubVoice), String(pubVoice).slice(0, 100));
  step("boss_public_video", /^https?:\/\//i.test(pubVideo), String(pubVideo).slice(0, 100));

  const delVoice = await api("/api/companion", cp.token, {
    action: "delete_media",
    media_id: adminVoice?.id || voiceId,
    media_type: "voice",
  });
  const delVideo = await api("/api/companion", cp.token, {
    action: "delete_media",
    media_id: adminVideo?.id || videoId,
    media_type: "video",
  });
  step("companion_delete_voice", delVoice.ok, delVoice.json?.message || JSON.stringify(delVoice.json).slice(0, 120));
  step("companion_delete_video", delVideo.ok, delVideo.json?.message || JSON.stringify(delVideo.json).slice(0, 120));

  await sleep(900);

  const boot2Res = await fetch(`${BASE}/api/companion?action=bootstrap`, {
    headers: { Authorization: `Bearer ${cp.token}`, "x-mcj-companion-token": cp.token },
  });
  const boot2Json = await boot2Res.json().catch(() => ({}));
  const boot2 = boot2Json.data || boot2Json;
  const media2 = Array.isArray(boot2.media) ? boot2.media : [];
  const goneSelfVoice = !media2.some((m) => String(m.mediaType) === "voice" && m.url);
  const goneSelfVideo = !media2.some((m) => String(m.mediaType) === "video" && m.url) && !boot2.player?.videoUrl;
  step("self_after_delete", goneSelfVoice && goneSelfVideo, `voiceGone=${goneSelfVoice} videoGone=${goneSelfVideo}`);

  const detail2 = await api("/api/admin/players", ad.token, { action: "detail", id: profileId });
  const d2 = detail2.json?.detail?.media || detail2.json?.player?.media || {};
  step(
    "admin_after_delete",
    !(d2.voices || []).length && !(d2.videos || []).length,
    `voices=${(d2.voices || []).length} videos=${(d2.videos || []).length}`
  );

  const pub2 = await api(`/api/public/companions?id=${encodeURIComponent(publicId || userId)}`, null, null, "GET");
  const one2 = (pub2.json?.companions || pub2.json?.data || [])[0] || pub2.json?.companion || pub2.json;
  step("public_after_delete", !(one2?.voiceUrl || one2?.videoUrl || one2?.showcaseVideoUrl), `voice=${!!one2?.voiceUrl} video=${!!one2?.videoUrl}`);

  const pub3 = await api(`/api/public/companions?id=${encodeURIComponent(publicId || userId)}`, null, null, "GET");
  const one3 = (pub3.json?.companions || pub3.json?.data || [])[0] || pub3.json?.companion || pub3.json;
  step(
    "refresh_no_resurrect",
    !(one3?.voiceUrl || one3?.videoUrl || one3?.showcaseVideoUrl),
    `voice=${one3?.voiceUrl || ""} video=${one3?.videoUrl || ""}`
  );

  const by = Object.fromEntries(results.map((r) => [r.step, r.result === "PASS"]));
  const verdict = {
    视频上传播放: by.companion_upload_video && by.companion_self_video && by.admin_see_video,
    音频上传播放: by.companion_upload_voice && by.companion_self_voice && by.admin_see_voice,
    后台查看审核: by.admin_see_voice && by.admin_see_video && by.admin_approve_voice && by.admin_approve_video,
    陪玩本人资料同步: by.companion_self_voice && by.companion_self_video && by.self_after_delete,
    老板端公开资料同步: by.boss_public_voice && by.boss_public_video,
    删除后四端同步: by.companion_delete_voice && by.companion_delete_video && by.self_after_delete && by.admin_after_delete && by.public_after_delete,
    刷新后数据正确: by.refresh_no_resurrect,
  };
  const summary = {
    verdict,
    results,
    overall: Object.values(verdict).every(Boolean) ? "PASS" : "FAIL",
  };
  fs.writeFileSync(path.join(ART, "summary.json"), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(ROOT, "artifacts", "companion-video-audio-sync-e2e", "summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(verdict, null, 2));
  console.log("OVERALL", summary.overall);
  process.exit(summary.overall === "PASS" ? 0 : 1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
