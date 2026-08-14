#!/usr/bin/env node
/**
 * Unit checks for companion apply video upload validation / MIME normalize.
 * Does not hit live Storage unless RUN_LIVE=1.
 */
import {
  assertVideoMeta,
  assertVideoUpload,
  normalizeVideoContentType,
  decodeDataUrl,
  ensureCompanionBuckets,
  createSignedUploadUrl,
  storageObjectInfo,
  deleteStorageObject,
  PRIVATE_BUCKETS,
} from "../server/api/_companion-media-store.js";

function expect(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}

function runUnit() {
  expect(normalizeVideoContentType("video/quicktime", "a.MOV") === "video/quicktime", "mov mime");
  expect(normalizeVideoContentType("video/hevc", "a.mp4") === "video/mp4", "hevc→mp4");
  expect(normalizeVideoContentType("video/hevc", "a.mov") === "video/quicktime", "hevc→qt");
  expect(normalizeVideoContentType("", "clip.mov") === "video/quicktime", "empty+mov");
  expect(normalizeVideoContentType("video/mp4;codecs=avc1.42E01E", "x.mp4") === "video/mp4", "strip codecs");

  try {
    assertVideoMeta({ contentType: "image/png", filename: "x.png", size: 100 });
    throw new Error("expected format reject");
  } catch (e) {
    expect(e.code === "video_format", "format code");
    expect(/格式错误/.test(e.message), "format msg");
  }
  try {
    assertVideoMeta({ contentType: "video/mp4", filename: "x.mp4", size: 50 * 1024 * 1024 });
    throw new Error("expected size reject");
  } catch (e) {
    expect(e.code === "video_too_large", "size code");
    expect(/文件太大/.test(e.message), "size msg");
  }
  try {
    assertVideoMeta({ contentType: "video/mp4", filename: "x.mp4", size: 1000, durationSeconds: 61 });
    throw new Error("expected duration reject");
  } catch (e) {
    expect(e.code === "video_too_long", "duration code");
    expect(/视频太长/.test(e.message), "duration msg");
  }

  const ok = assertVideoMeta({
    contentType: "video/quicktime",
    filename: "IMG_001.MOV",
    size: 12 * 1024 * 1024,
    durationSeconds: 18,
  });
  expect(ok.contentType === "video/quicktime", "iphone ok");

  const decoded = decodeDataUrl("data:video/quicktime;base64,AAAA");
  const checked = assertVideoUpload(decoded, "a.mov");
  expect(checked.contentType === "video/quicktime", "assertVideoUpload");
  console.log("PASS unit: video MIME / format / size / duration");
}

async function runLive() {
  await ensureCompanionBuckets();
  const path = `test-agent/video/unit-${Date.now()}.mov`;
  const signed = await createSignedUploadUrl(PRIVATE_BUCKETS.video, path, { upsert: true });
  expect(!!signed.uploadUrl, "signed url");
  const put = await fetch(signed.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "video/quicktime" },
    body: Buffer.from([0, 0, 0, 0x14, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20]),
  });
  expect(put.ok, `PUT ${put.status}`);
  const info = await storageObjectInfo(PRIVATE_BUCKETS.video, path);
  expect(!!info, "object info");
  await deleteStorageObject(PRIVATE_BUCKETS.video, path);
  console.log("PASS live: companion-video signed upload + MIME allowlist");
}

runUnit();
if (process.env.RUN_LIVE === "1") {
  runLive().catch((err) => {
    console.error("LIVE FAIL", err);
    process.exit(1);
  });
}
