import { companionDb } from "./_companion-media-store.js";

function cleanReplies(input) {
  const list = Array.isArray(input) ? input : [];
  return list
    .map((raw, index) => ({
      id: String(raw?.id || `qr${index + 1}`).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) || `qr${index + 1}`,
      title: String(raw?.title || "").trim().slice(0, 40),
      content: String(raw?.content || "").trim().slice(0, 500),
      enabled: raw?.enabled !== false && raw?.enabled !== "false",
      sort: Number.isFinite(Number(raw?.sort)) ? Number(raw.sort) : index,
    }))
    .filter((item) => item.title && item.content)
    .sort((a, b) => a.sort - b.sort)
    .slice(0, 50)
    .map((item, index) => ({ ...item, sort: index }));
}

async function readData() {
  const rows = await companionDb("platform_settings", "?id=eq.global&select=data&limit=1").catch(() => []);
  const data = rows?.[0]?.data;
  return data && typeof data === "object" && !Array.isArray(data) ? data : {};
}

export async function listQuickReplies({ enabledOnly = false } = {}) {
  const data = await readData();
  const replies = cleanReplies(data.csQuickReplies);
  return enabledOnly ? replies.filter((item) => item.enabled) : replies;
}

export async function saveQuickReplies(input) {
  const prev = await readData();
  const replies = cleanReplies(input);
  await companionDb("platform_settings", "?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      id: "global",
      data: { ...prev, csQuickReplies: replies },
      updated_at: new Date().toISOString(),
    }),
  });
  return replies;
}
