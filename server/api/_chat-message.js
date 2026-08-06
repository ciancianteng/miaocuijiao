/**
 * Shared chat message helpers — single source of truth for image URLs.
 * Prefer: message_type=image + content=<public https URL> (+ optional image_url).
 * Legacy fallback: content=__IMG__:<url> when enum lacks "image".
 */

export const IMG_TAG = "__IMG__:";

export function stripImageTag(raw) {
  let s = String(raw || "").trim();
  if (!s) return "";
  if (s.indexOf(IMG_TAG) === 0) s = s.slice(IMG_TAG.length).trim();
  // Repair legacy client bug: slice(7) left a leading ":" on __IMG__:https://...
  if (s.charAt(0) === ":" && /^:https?:\/\//i.test(s)) s = s.slice(1);
  return s.trim();
}

export function normalizeImageUrl(raw) {
  const s = stripImageTag(raw);
  if (!s) return "";
  if (/^(blob:|data:)/i.test(s)) return "";
  if (!/^https?:\/\//i.test(s)) return "";
  return s;
}

export function looksLikeImageMessage({ messageType, content, imageUrl, image_url, mediaUrl, media_url } = {}) {
  const t = String(messageType || "").toLowerCase();
  if (t === "image") return true;
  const c = String(content || "");
  if (c.indexOf(IMG_TAG) === 0) return true;
  if (normalizeImageUrl(imageUrl || image_url || mediaUrl || media_url)) return true;
  if (normalizeImageUrl(c)) {
    if (/\.(jpg|jpeg|png|webp)(\?|#|$)/i.test(c)) return true;
    if (/\/storage\/v1\/object\/public\/chat-images\//i.test(c)) return true;
  }
  return false;
}

/** Canonical fields to persist for an image send. content is always the bare public URL. */
export function imageInsertFields(url) {
  const imageUrl = normalizeImageUrl(url);
  if (!imageUrl) {
    throw Object.assign(new Error("图片消息内容无效"), { status: 400 });
  }
  return {
    message_type: "image",
    content: imageUrl,
    image_url: imageUrl,
  };
}

export function taggedImageContent(url) {
  const imageUrl = normalizeImageUrl(url);
  if (!imageUrl) return "";
  return `${IMG_TAG}${imageUrl}`;
}

export function isImageEnumError(err) {
  return /enum|invalid input|message_type/i.test(String(err?.message || err || ""));
}

export function isMissingImageUrlColumnError(err) {
  return /image_url|column|schema|PGRST204|42703/i.test(String(err?.message || err || ""));
}

/**
 * Decorate a DB message row for API clients.
 * Always expose imageUrl (bare https) for image messages; never leak blob/data.
 */
export function decorateChatMessage(row = {}, extras = {}) {
  const contentRaw = String(row.content || "");
  const imageUrl = normalizeImageUrl(
    row.image_url || row.imageUrl || row.media_url || row.mediaUrl || contentRaw
  );
  const isImage = looksLikeImageMessage({
    messageType: row.message_type || row.messageType || extras.messageType,
    content: contentRaw,
    imageUrl,
  });
  const messageType = isImage
    ? "image"
    : String(row.message_type || row.messageType || extras.messageType || "text");
  const content = isImage ? imageUrl || stripImageTag(contentRaw) : contentRaw;
  return {
    id: row.id || "",
    conversation_id: row.conversation_id || extras.conversationId || "",
    conversationId: row.conversation_id || extras.conversationId || "",
    sender_id: row.sender_id || extras.senderId || "",
    senderId: row.sender_id || extras.senderId || "",
    sender_role: row.sender_role || extras.senderRole || "",
    senderRole: row.sender_role || extras.senderRole || "",
    message_type: messageType,
    messageType,
    content,
    image_url: isImage ? imageUrl : "",
    imageUrl: isImage ? imageUrl : "",
    order_id: row.order_id || extras.orderId || null,
    orderId: row.order_id || extras.orderId || "",
    created_at: row.created_at || extras.createdAt || "",
    createdAt: row.created_at || extras.createdAt || "",
    read_at: row.read_at || extras.readAt || "",
    readAt: row.read_at || extras.readAt || "",
    sender_name: extras.senderName || row.sender_name || "",
    senderName: extras.senderName || row.sender_name || "",
  };
}

export function messagePreviewText(rowOrContent, messageType) {
  if (rowOrContent && typeof rowOrContent === "object") {
    if (
      looksLikeImageMessage(rowOrContent) ||
      looksLikeImageMessage({
        messageType: rowOrContent.message_type || rowOrContent.messageType,
        content: rowOrContent.content,
        imageUrl: rowOrContent.image_url || rowOrContent.imageUrl,
      })
    ) {
      return "[图片]";
    }
    return String(rowOrContent.content || "");
  }
  if (looksLikeImageMessage({ messageType, content: rowOrContent })) return "[图片]";
  return String(rowOrContent || "");
}

/**
 * Persist one image message: single Storage URL in content (+ image_url when column exists).
 * Falls back to __IMG__: tag when message_type enum lacks "image".
 * @param {(payload: object) => Promise<any>} insertFn
 * @param {object} basePayload fields besides message_type/content/image_url
 * @param {string} url public https Storage URL
 */
export async function persistImageMessage(insertFn, basePayload, url) {
  const imageUrl = normalizeImageUrl(url);
  if (!imageUrl) {
    throw Object.assign(new Error("图片消息内容无效"), { status: 400 });
  }
  const attempts = [
    { ...basePayload, message_type: "image", content: imageUrl, image_url: imageUrl },
    { ...basePayload, message_type: "image", content: imageUrl },
    {
      ...basePayload,
      message_type: "text",
      content: taggedImageContent(imageUrl),
      image_url: imageUrl,
    },
    { ...basePayload, message_type: "text", content: taggedImageContent(imageUrl) },
  ];
  let lastErr = null;
  for (const payload of attempts) {
    try {
      const rows = await insertFn(payload);
      const row = Array.isArray(rows) ? rows[0] : rows;
      return { row, imageUrl, messageType: "image" };
    } catch (err) {
      lastErr = err;
      const hasImageUrl = Object.prototype.hasOwnProperty.call(payload, "image_url");
      const missingCol = hasImageUrl && isMissingImageUrlColumnError(err);
      const enumErr = payload.message_type === "image" && isImageEnumError(err);
      if (missingCol || enumErr) continue;
      // Unexpected error on a fallback payload — keep trying remaining softer payloads once.
      if (payload.message_type === "image") continue;
      if (hasImageUrl) continue;
      throw err;
    }
  }
  throw lastErr || Object.assign(new Error("图片消息写入失败"), { status: 500 });
}
