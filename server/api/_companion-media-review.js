/**
 * Companion media review helpers (admin).
 * Showcase video is OPTIONAL — never blocks application approval.
 */

export function isPendingMediaStatus(status) {
  const s = String(status || "pending")
    .trim()
    .toLowerCase();
  if (!s) return true;
  if (/approved|verified|passed|已通过/.test(s)) return false;
  if (/rejected|resubmit|已驳回|不通过|补资料/.test(s)) return false;
  return /pending|review|submitted|待审核|审核/.test(s) || s === "pending";
}

/** Gallery / cover image rows only (never video / achievement / voice). */
export function isGalleryPhotoRow(row = {}) {
  const mt = String(row.media_type || row.mediaType || "")
    .trim()
    .toLowerCase();
  const ctype = String(row.content_type || row.contentType || "").toLowerCase();
  if (/^video\//.test(ctype)) return false;
  if (mt === "achievement") return false;
  if (mt === "video" || mt === "voice" || mt === "avatar") return false;
  if (mt === "cover") return true;
  if (mt !== "gallery") return false;
  const sort = Number(row.sort_order != null ? row.sort_order : row.sortOrder);
  if (Number.isFinite(sort) && sort >= 500) return false; // legacy achievement fallback
  return true;
}

export function videoReviewRequired(videos = []) {
  return Array.isArray(videos) && videos.some((v) => v && (v.id || v.url || v.storage_path || v.storagePath));
}

/**
 * Completeness chip for optional showcase video.
 * never uses warn/error styling when missing.
 */
export function showcaseVideoCompleteness(hasVideos) {
  if (hasVideos) {
    return {
      ok: true,
      optional: true,
      required: false,
      label: "展示视频",
      display: "展示视频",
      className: "is-ok",
      mark: "✓",
    };
  }
  return {
    ok: false,
    optional: true,
    required: false,
    label: "展示视频（选填，未上传）",
    display: "展示视频（选填，未上传）",
    className: "is-optional",
    mark: "○",
  };
}

/**
 * Select pending gallery photo ids for ONE companion only.
 * @returns {{ ids: string[], skipped: number }}
 */
export function selectPendingGalleryPhotoIds(rows = [], companionProfileId) {
  const pid = String(companionProfileId || "").trim();
  const ids = [];
  let skipped = 0;
  for (const row of rows || []) {
    if (!row || typeof row !== "object") continue;
    const rowPid = String(row.companion_profile_id || row.companionProfileId || "").trim();
    if (pid && rowPid && rowPid !== pid) {
      skipped += 1;
      continue;
    }
    if (!isGalleryPhotoRow(row)) continue;
    if (!isPendingMediaStatus(row.status)) continue;
    const id = String(row.id || "").trim();
    if (id) ids.push(id);
  }
  return { ids, skipped };
}
