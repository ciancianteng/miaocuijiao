/**
 * Manual Discord voice-room desk for one order.
 * Stored in that order's note marker. Does not allocate a Discord channel
 * and does not copy the username onto any other order.
 */
const MARK_RE = /\[\[MCJ_DISCORD_DESK:([\s\S]*?)\]\]/;

const ACCEPTED = new Set(["confirmed", "in_progress", "completed", "reviewed"]);

export function readDiscordDesk(note = "") {
  const match = String(note || "").match(MARK_RE);
  if (!match) {
    return { username: "", status: "", acked: false, submittedAt: "", invitedAt: "" };
  }
  try {
    const parsed = JSON.parse(match[1]);
    return {
      username: String(parsed.u || "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 80),
      status: String(parsed.s || ""),
      acked: parsed.ack === 1 || parsed.ack === true,
      submittedAt: String(parsed.at || ""),
      invitedAt: String(parsed.inv || ""),
    };
  } catch {
    return { username: "", status: "", acked: false, submittedAt: "", invitedAt: "" };
  }
}

export function upsertDiscordDesk(note, desk = {}) {
  const payload = JSON.stringify({
    u: String(desk.username || "").trim(),
    s: String(desk.status || ""),
    ack: desk.acked ? 1 : 0,
    at: desk.submittedAt || "",
    inv: desk.invitedAt || "",
  });
  const block = `[[MCJ_DISCORD_DESK:${payload}]]`;
  const raw = String(note || "");
  if (MARK_RE.test(raw)) return raw.replace(MARK_RE, block);
  const base = raw.trim();
  return base ? `${base}\n${block}` : block;
}

export function stripDiscordDeskMarker(text = "") {
  return String(text || "")
    .replace(/\[\[MCJ_DISCORD_DESK:[\s\S]*?\]\]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function isDiscordVoice(order = {}) {
  return String(order.voice_mode || order.voiceMode || "").trim().toLowerCase() === "discord";
}

export function paymentSettled(order = {}) {
  const status = String(order.status || "").trim().toLowerCase();
  if (!status || status === "awaiting_payment" || status === "cancelled" || status === "refunded") return false;
  if (order.paymentReview) return false;
  return true;
}

export function companionHasAccepted(order = {}) {
  return ACCEPTED.has(String(order.status || "").trim().toLowerCase());
}

export function normalizeDiscordUsername(raw) {
  const username = String(raw || "").replace(/[\u0000-\u001f]/g, "").trim();
  if (!username) return { ok: false, message: "请输入您的 Discord 用户名" };
  if (username.length > 80) return { ok: false, message: "Discord 用户名过长" };
  return { ok: true, username };
}

export function discordDeskPhase(order = {}) {
  const desk = readDiscordDesk(`${order.note || ""}\n${order.description || ""}`);
  if (!isDiscordVoice(order)) {
    return {
      active: false,
      phase: "none",
      statusLabel: "",
      username: "",
      showFill: false,
      showWait: false,
      paid: paymentSettled(order),
      companionAccepted: companionHasAccepted(order),
      acked: false,
    };
  }
  const paid = paymentSettled(order);
  const accepted = companionHasAccepted(order);
  let phase = "not_ready";
  let statusLabel = "";
  if (desk.status === "arranged") {
    phase = "arranged";
    statusLabel = "已安排语音房";
  } else if (desk.username) {
    phase = "waiting_invite";
    statusLabel = "等待客服邀请";
  } else if (paid && accepted) {
    phase = "need_id";
    statusLabel = "待填写 Discord ID";
  }
  return {
    active: true,
    phase,
    statusLabel,
    username: desk.username,
    showFill: phase === "need_id",
    showWait: phase === "waiting_invite" && !desk.acked,
    paid,
    companionAccepted: accepted,
    acked: !!desk.acked,
  };
}

export function discordDeskPublic(order = {}) {
  const phase = discordDeskPhase(order);
  return {
    discordUsername: phase.username,
    discordDeskStatus: phase.statusLabel,
    discordDeskPhase: phase.phase,
    discordShowFill: phase.showFill,
    discordShowWait: phase.showWait,
  };
}
