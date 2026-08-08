import fs from "fs";

const p = "server/api/public/companions.js";
let t = fs.readFileSync(p, "utf8");
const start = t.indexOf("async function loadCompanions(");
const end = t.indexOf("export default async function handler");
if (start < 0 || end < 0) throw new Error("markers missing");

const next = `async function mediaExtrasByProfile(profileIds = []) {
  const ids = [...new Set((profileIds || []).filter(Boolean))];
  if (!ids.length) return {};
  let rows = [];
  try {
    rows = await supabaseJson(
      restUrl(
        "companion_media",
        \`?companion_profile_id=in.(\${ids.map(encodeURIComponent).join(",")})&media_type=in.(avatar,gallery)&order=sort_order.asc&limit=2000&select=id,companion_profile_id,media_type,storage_bucket,storage_path,status\`
      ),
      { headers: headers() }
    );
  } catch (e) {
    if (/companion_media|schema cache|PGRST|does not exist/i.test(String(e.message || e))) return {};
    throw e;
  }
  const byProfile = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const pid = row.companion_profile_id;
    if (!pid) continue;
    if (!byProfile[pid]) byProfile[pid] = { avatarUrl: "", coverUrl: "" };
    const bucket = String(row.storage_bucket || "").trim();
    const path = String(row.storage_path || "").trim();
    if (!bucket || !path) continue;
    let url = "";
    try {
      if (bucket === "companion-public" || /public/i.test(bucket)) {
        url = publicObjectUrl(bucket, path);
      } else {
        url = await createSignedUrl(bucket, path, 60 * 60 * 12);
      }
    } catch (err) {
      console.warn("[public/companions] media URL resolve failed", bucket, path, err?.message || err);
      continue;
    }
    if (!url || !/^https?:\\/\\//i.test(url)) continue;
    if (row.media_type === "avatar" && !byProfile[pid].avatarUrl) byProfile[pid].avatarUrl = url;
    if (row.media_type === "gallery" && !byProfile[pid].coverUrl) byProfile[pid].coverUrl = url;
    if (row.media_type === "avatar" && !byProfile[pid].coverUrl) byProfile[pid].coverUrl = url;
  }
  return byProfile;
}

async function loadCompanions(id = "") {
  let query = id
    ? \`?or=(user_id.eq.\${encodeURIComponent(id)},companion_uid.eq.\${encodeURIComponent(String(id).replace(/^P/i, ""))})&verification_status=eq.approved&limit=1\`
    : "?verification_status=eq.approved&order=updated_at.desc&limit=300";
  let rows;
  try {
    rows = await supabaseJson(restUrl("companion_profiles", query), { headers: headers() });
  } catch (e) {
    if (id && /companion_uid|column/i.test(String(e.message || ""))) {
      rows = await supabaseJson(
        restUrl("companion_profiles", \`?user_id=eq.\${encodeURIComponent(id)}&verification_status=eq.approved&limit=1\`),
        { headers: headers() }
      );
    } else throw e;
  }
  const companions = Array.isArray(rows) ? rows : [];
  const userIds = [...new Set(companions.map((row) => row.user_id).filter(Boolean))];
  if (!userIds.length) return [];
  const profileIds = companions.map((row) => row.id).filter(Boolean);
  const [profiles, levels, servicesBundle, mediaMap] = await Promise.all([
    supabaseJson(
      restUrl("profiles", \`?id=in.(\${userIds.map(encodeURIComponent).join(",")})&role=eq.companion&status=eq.active&select=id,display_name,avatar_url,email,status,role\`),
      { headers: headers() }
    ),
    readLocalLevels().catch(() => []),
    loadPublicServices().catch(() => ({ services: [] })),
    mediaExtrasByProfile(profileIds).catch(() => ({})),
  ]);
  const catalog = Array.isArray(servicesBundle?.services) ? servicesBundle.services : [];
  const profileMap = Object.fromEntries((profiles || []).map((row) => [row.id, row]));
  const levelList = Array.isArray(levels) ? levels.map((l) => toPublicLevel(l)) : [];
  const mapped = companions
    .filter((row) => profileMap[row.user_id])
    .map((row) => publicCompanion(row, profileMap[row.user_id], levelList, catalog, mediaMap[row.id] || {}));
  return attachReviews(mapped);
}

`;

t = t.slice(0, start) + next + t.slice(end);
fs.writeFileSync(p, t);
console.log("patched loadCompanions");
