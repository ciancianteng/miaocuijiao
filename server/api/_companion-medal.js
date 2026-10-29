const MEDAL_RE = /\[\[MCJ_MEDAL:(pending|approved|rejected|revoked)\]\]/gi;

export function readMedalStatus(tags) {
  const m = String(tags || "").match(/\[\[MCJ_MEDAL:(pending|approved|rejected|revoked)\]\]/i);
  return m ? String(m[1]).toLowerCase() : "";
}

export function stripMedalMarker(tags) {
  return String(tags || "")
    .replace(MEDAL_RE, "")
    .replace(/,\s*,/g, ",")
    .replace(/^\s*,\s*|\s*,\s*$/g, "")
    .trim();
}

export function writeMedalStatus(tags, status) {
  const base = stripMedalMarker(tags);
  const s = String(status || "").trim().toLowerCase();
  if (!/^(pending|approved|rejected|revoked)$/.test(s)) return base;
  return `${base ? `${base} ` : ""}[[MCJ_MEDAL:${s}]]`;
}

export function medalDisplayTag() {
  return { id: "mcj-official-medal", name: "认证勋章", icon: "🏅", color: "#e8b4c8" };
}
