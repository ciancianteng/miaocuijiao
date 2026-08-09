/**
 * Shared companion media URL + public profile field resolution.
 * Keeps homepage / hall / detail / admin / CS on one mapping.
 */

export const DEFAULT_COMPANION_AVATAR = "/default-avatar.png";
export const DEFAULT_COMPANION_COVER = "/default-avatar.png";

export function isUnstableMediaUrl(value) {
  const s = String(value == null ? "" : value).trim();
  if (!s || s === "#" || s === "-" || s === "null" || s === "undefined") return true;
  if (/^(blob:|filesystem:|file:)/i.test(s)) return true;
  if (/^data:/i.test(s)) return true;
  if (/^(https?:\/\/)?(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?\b/i.test(s)) return true;
  if (/meow-cuijiao-brand\.(jpe?g|png|webp)$/i.test(s)) return true;
  if (/^assets\/meow-cuijiao-brand/i.test(s)) return true;
  // Expired / private signed links should not be treated as durable public assets
  if (/\/storage\/v1\/object\/sign\//i.test(s)) return true;
  if (/[?&]token=/i.test(s) && /\/storage\/v1\//i.test(s)) return true;
  // Placeholder defaults are not real uploaded media
  if (/\/default-avatar\.png(?:$|\?)/i.test(s)) return true;
  if (/\/default-companion-avatar\./i.test(s)) return true;
  return false;
}

export function isStableHttpUrl(value) {
  const s = String(value == null ? "" : value).trim();
  if (!s || isUnstableMediaUrl(s)) return false;
  return /^https?:\/\//i.test(s) || s.startsWith("/");
}

export function pickStableMediaUrl(...candidates) {
  for (const candidate of candidates) {
    const s = String(candidate == null ? "" : candidate).trim();
    if (!s || isUnstableMediaUrl(s)) continue;
    if (!isStableHttpUrl(s)) continue;
    return s;
  }
  return "";
}

export function resolveCompanionAvatar(profile = {}, row = {}, extras = {}) {
  const live = String(extras.avatarUrl || extras.mediaAvatarUrl || "").trim();
  if (live && /^https?:\/\//i.test(live) && !/^(blob:|data:)/i.test(live) && !/localhost|127\.0\.0\.1/i.test(live)) {
    return live;
  }
  return (
    pickStableMediaUrl(
      extras.coverUrl,
      profile.avatar_url,
      profile.avatar,
      row.avatar_url,
      row.avatar,
      row.card_image_url,
      row.cover_url,
      row.cover
    ) || DEFAULT_COMPANION_AVATAR
  );
}

export function resolveCompanionCover(profile = {}, row = {}, extras = {}) {
  const liveCover = String(extras.coverUrl || extras.mediaCoverUrl || "").trim();
  if (liveCover && /^https?:\/\//i.test(liveCover) && !/^(blob:|data:)/i.test(liveCover) && !/localhost|127\.0\.0\.1/i.test(liveCover)) {
    return liveCover;
  }
  const liveAvatar = String(extras.avatarUrl || extras.mediaAvatarUrl || "").trim();
  if (liveAvatar && /^https?:\/\//i.test(liveAvatar) && !/^(blob:|data:)/i.test(liveAvatar) && !/localhost|127\.0\.0\.1/i.test(liveAvatar)) {
    return liveAvatar;
  }
  return (
    pickStableMediaUrl(
      row.card_image_url,
      row.cover_url,
      row.cover,
      profile.avatar_url,
      profile.avatar,
      row.avatar_url,
      row.avatar
    ) || DEFAULT_COMPANION_COVER
  );
}

export function availabilityCode(row = {}) {
  const raw = String(row.availability_status || row.online_status || "offline").toLowerCase();
  if (raw === "online") return "online";
  if (raw === "busy") return "busy";
  if (raw === "paused") return "paused";
  return "offline";
}

export function availabilityText(code) {
  return ({ online: "在线可接单", busy: "忙碌中", paused: "暂停接单", offline: "离线" })[code] || "离线";
}

export function isGarbledName(value) {
  const s = String(value == null ? "" : value).trim();
  if (!s) return true;
  const marks = (s.match(/[?\uFFFD？]/g) || []).length;
  if (marks >= 2 && marks >= Math.ceil(s.length * 0.4)) return true;
  if (/^(?:\?|？|\uFFFD){2,}/.test(s)) return true;
  return false;
}

export function resolveCompanionName(row = {}, profile = {}) {
  const candidates = [row.nickname, profile.display_name];
  for (const c of candidates) {
    const s = String(c == null ? "" : c).trim();
    if (!s) continue;
    if (isGarbledName(s)) continue;
    if (/@/.test(s)) continue;
    return s;
  }
  return "";
}

/**
 * Canonical boss-facing companion fields used by home / hall / detail / CS.
 */
export function mapCompanionPublicFields(row = {}, profile = {}, extras = {}) {
  const avail = availabilityCode(row);
  const name = resolveCompanionName(row, profile) || "未命名陪玩";
  const avatar = resolveCompanionAvatar(profile, row, extras);
  const cover = resolveCompanionCover(profile, row, extras);
  let publicId = "";
  try {
    // Dynamic import avoided — inline PW formatting to keep this file dependency-light for browsers if bundled.
    const code = String(row.companion_code || extras.companionCode || extras.publicId || "").trim();
    if (/^PW\d+$/i.test(code)) publicId = code.toUpperCase().replace(/^pw/i, "PW");
    else if (/^P\d+$/i.test(code)) {
      const n = Number(String(code).replace(/^P/i, ""));
      const seq = n >= 100001 ? n - 100000 : n;
      if (seq > 0) publicId = "PW" + String(seq).padStart(5, "0");
    } else if (row.companion_uid) {
      const n = Number(row.companion_uid);
      const seq = n >= 100001 ? n - 100000 : n;
      if (seq > 0) publicId = "PW" + String(seq).padStart(5, "0");
    }
  } catch {
    publicId = row.companion_code || "";
  }
  return {
    id: row.user_id || row.id || extras.id || "",
    uid: row.user_id || row.id || extras.id || "",
    publicId,
    companionCode: publicId,
    companion_code: publicId,
    companionUid: row.companion_uid || null,
    companionProfileId: row.id || extras.companionProfileId || "",
    name,
    nickname: name,
    nameValid: !!resolveCompanionName(row, profile),
    avatar,
    cover,
    cardImageUrl: pickStableMediaUrl(row.card_image_url, cover) || "",
    voiceUrl: pickStableMediaUrl(row.voice_url, extras.voiceUrl) || row.voice_url || "",
    videoUrl: pickStableMediaUrl(extras.videoUrl, extras.showcaseVideoUrl) ||
      (String(extras.videoUrl || extras.showcaseVideoUrl || "").trim().startsWith("http")
        ? String(extras.videoUrl || extras.showcaseVideoUrl).trim()
        : "") ||
      "",
    showcaseVideoUrl: pickStableMediaUrl(extras.videoUrl, extras.showcaseVideoUrl) ||
      (String(extras.videoUrl || extras.showcaseVideoUrl || "").trim().startsWith("http")
        ? String(extras.videoUrl || extras.showcaseVideoUrl).trim()
        : "") ||
      "",
    availabilityStatus: avail,
    availabilityText: availabilityText(avail),
    onlineStatus: availabilityText(avail),
    status: availabilityText(avail),
    verificationStatus: row.verification_status || "",
  };
}
