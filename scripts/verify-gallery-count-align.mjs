/**
 * Unit check: FE gallery count rules match backend upload_media semantics.
 * node scripts/verify-gallery-count-align.mjs
 */
function galleryDurableKey(m) {
  if (!m) return "";
  return String(m.storagePath || m.storage_path || m.path || m.id || "").trim();
}
function isCountableGalleryMedia(m) {
  if (!m || String(m.mediaType || m.media_type || "") !== "gallery") return false;
  const ctype = String(m.contentType || m.content_type || "").toLowerCase();
  if (/^video\//.test(ctype)) return false;
  return !!galleryDurableKey(m);
}
function savedGalleryCount(media) {
  const seen = Object.create(null);
  let n = 0;
  for (const m of media || []) {
    if (!isCountableGalleryMedia(m)) continue;
    const key = galleryDurableKey(m);
    if (seen[key]) continue;
    seen[key] = 1;
    n += 1;
  }
  return n;
}

const media = [
  { mediaType: "gallery", id: "a", contentType: "image/jpeg", storagePath: "p/a.jpg" },
  { mediaType: "gallery", id: "b", contentType: "video/mp4", storagePath: "p/b.mp4" }, // exclude video
  { mediaType: "gallery", url: "blob:x" }, // no durable key
  { mediaType: "avatar", id: "c", storagePath: "p/c.jpg" },
  { mediaType: "gallery", id: "a", storagePath: "p/a.jpg" }, // dedupe
  { mediaType: "gallery", id: "d", content_type: "image/png", storage_path: "p/d.png" },
];

const n = savedGalleryCount(media);
const room = Math.max(0, 6 - n);
if (n !== 2) {
  console.error("FAIL expected countable gallery=2, got", n);
  process.exit(1);
}
if (room !== 4) {
  console.error("FAIL expected room=4, got", room);
  process.exit(1);
}

// Mirror backend filter on companion_media rows
const existing = [
  { id: "1", content_type: "image/jpeg", storage_path: "x" },
  { id: "2", content_type: "video/webm", storage_path: "y" },
  { id: "3", content_type: "image/webp", storage_path: "z" },
];
const galleryRows = existing.filter((g) => !/^video\//i.test(String(g.content_type || "")));
if (galleryRows.length !== 2) {
  console.error("FAIL backend-style count expected 2, got", galleryRows.length);
  process.exit(1);
}

console.log("PASS gallery count aligns: durable images only, videos excluded, deduped; room=", room);
