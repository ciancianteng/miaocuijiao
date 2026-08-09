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
  if (/^chat-images-private:/i.test(s)) return s;
  if (/^conv\//i.test(s)) return `chat-images-private:${s}`;
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
    if (/^chat-images-private:/i.test(c) || /^conv\//i.test(c)) return true;
    if (/\.(jpg|jpeg|png|webp)(\?|#|$)/i.test(c)) return true;
    if (/\/storage\/v1\/object\/(?:public|sign)\/chat-images(?:-private)?\//i.test(c)) return true;
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
 * Image content may be a durable storageRef (chat-images-private:path) or https URL.
 * Prefer decorateChatMessageSigned when returning to browsers so imageUrl is viewable.
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
  const storageRef =
    isImage && (/^chat-images-private:/i.test(contentRaw) || /^conv\//i.test(contentRaw.trim()))
      ? normalizeImageUrl(contentRaw)
      : isImage && /^chat-images-private:/i.test(String(imageUrl || ""))
        ? imageUrl
        : "";
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
    storageRef: storageRef || "",
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

/** Sign private chat image refs so clients get a short-lived https URL. */
export async function decorateChatMessageSigned(row = {}, extras = {}) {
  const base = decorateChatMessage(row, extras);
  if (base.messageType !== "image" && base.message_type !== "image") return base;
  const raw = base.storageRef || base.imageUrl || base.content || "";
  if (!raw) return base;
  try {
    const { signChatMediaUrl, parseChatStorageRef } = await import("./_chat-media.js");
    const signed = await signChatMediaUrl(base.storageRef || raw);
    const parsed = parseChatStorageRef(base.storageRef || row.content || row.image_url || raw);
    const storageRef =
      parsed?.bucket === "chat-images-private"
        ? `chat-images-private:${parsed.path}`
        : base.storageRef || "";
    if (signed && /^https?:\/\//i.test(signed)) {
      return {
        ...base,
        content: signed,
        image_url: signed,
        imageUrl: signed,
        storageRef: storageRef || base.storageRef || "",
      };
    }
  } catch {
    /* keep undecorated */
  }
  return base;
}

export async function decorateChatMessagesSigned(rows = [], extrasFn) {
  const list = Array.isArray(rows) ? rows : [];
  return Promise.all(
    list.map((row) =>
      decorateChatMessageSigned(row, typeof extrasFn === "function" ? extrasFn(row) || {} : extrasFn || {})
    )
  );
}

export function messagePreviewText(rowOrContent, messageType) {
  let type = String(messageType || "").trim().toLowerCase();
  let content = "";
  let senderRole = "";
  if (rowOrContent && typeof rowOrContent === "object") {
    type = String(type || rowOrContent.message_type || rowOrContent.messageType || "")
      .trim()
      .toLowerCase();
    content = String(rowOrContent.content || "");
    senderRole = String(rowOrContent.sender_role || rowOrContent.senderRole || "").toLowerCase();
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
  } else {
    content = String(rowOrContent || "");
    if (looksLikeImageMessage({ messageType: type, content })) return "[图片]";
  }

  if (type === "companion_card" || type === "player_card") return "客服向您推荐了陪玩";
  if (type === "product_card") return "客服已发送商品资料";
  if (type === "order_card") return "订单消息";

  const trimmed = content.trim();
  if (!trimmed) return "暂无消息";

  // Never leak raw JSON / program payloads into conversation list previews.
  if (trimmed.charAt(0) === "{" || trimmed.charAt(0) === "[") {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object") {
        const cardType = String(parsed.type || "").toLowerCase();
        if (cardType === "companion_card" || parsed.companionId || parsed.companion_id) {
          return "客服向您推荐了陪玩";
        }
        if (cardType === "product_card" || parsed.productId || parsed.product_id) {
          return "客服已发送商品资料";
        }
        if (cardType === "order_card" || parsed.orderId || parsed.order_id) {
          return "订单消息";
        }
        return "系统消息";
      }
    } catch {
      return "系统消息";
    }
  }

  if (/客服向您推荐陪玩|推荐陪玩|陪玩名片|推送陪玩/.test(trimmed)) return "客服向您推荐了陪玩";
  if (/已发送陪玩资料|陪玩资料/.test(trimmed)) return "客服已发送陪玩资料";
  if (/抢单/.test(trimmed) && /(等待|选择|老板)/.test(trimmed)) return "陪玩已抢单，等待您的选择";
  if (/已确认(线下)?付款|确认收款|发布到抢单大厅|付款凭证已/.test(trimmed)) return "客服已确认付款";
  if (/已选择陪玩|老板已选择|正式指定/.test(trimmed)) return "您已选择陪玩";
  if (/待陪玩确认|等待陪玩确认/.test(trimmed)) return "已指定陪玩，等待确认接单";
  if (/付款凭证|上传付款|待人工审核/.test(trimmed)) return "付款凭证相关消息";

  // Strip internal markers that sometimes leak into note-derived system text.
  const cleaned = trimmed
    .replace(/\[\[[^\]]+\]\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return senderRole === "system" ? "系统消息" : "新消息";
  if (cleaned.charAt(0) === "{" || cleaned.charAt(0) === "[") return "系统消息";
  return cleaned.length > 60 ? `${cleaned.slice(0, 60)}…` : cleaned;
}

/**
 * Persist one image message: prefer durable storageRef in content (+ image_url when column exists).
 * Falls back to __IMG__: tag when message_type enum lacks "image".
 * @param {(payload: object) => Promise<any>} insertFn
 * @param {object} basePayload fields besides message_type/content/image_url
 * @param {string} url storageRef (chat-images-private:path) or https URL
 */
export async function persistImageMessage(insertFn, basePayload, url) {
  const imageUrl = normalizeImageUrl(url);
  if (!imageUrl) {
    throw Object.assign(new Error("图片消息内容无效"), { status: 400 });
  }
  // Prefer durable private ref in content; signed https is re-issued on read.
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
