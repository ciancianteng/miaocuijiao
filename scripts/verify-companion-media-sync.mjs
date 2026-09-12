/**
 * Compare homepage popularity avatars vs public companions (hall) for same companionId.
 */
const BASE = process.env.VERIFY_BASE || process.argv[2];
if (!BASE) {
  console.error("Usage: node scripts/verify-companion-media-sync.mjs <preview-base-url>");
  process.exit(2);
}

function unstable(url) {
  const s = String(url || "");
  return /^(blob:|data:)/i.test(s) || /\/storage\/v1\/object\/sign\//i.test(s) || /localhost|127\.0\.0\.1/i.test(s);
}

(async () => {
  const [popRes, listRes] = await Promise.all([
    fetch(`${BASE}/api/popularity?action=home&period=weekly&limit=10`, { cache: "no-store" }),
    fetch(`${BASE}/api/public/companions`, { cache: "no-store" }),
  ]);
  const pop = await popRes.json();
  const list = await listRes.json();
  const items = Array.isArray(pop.items) ? pop.items : [];
  const companions = Array.isArray(list.companions) ? list.companions : [];
  const byId = Object.fromEntries(companions.map((c) => [String(c.id || c.uid), c]));

  console.log("popularity items:", items.length, "public companions:", companions.length);
  let fail = 0;
  for (const item of items) {
    const id = String(item.companionId || "");
    const c = byId[id];
    if (!c) {
      console.log("WARN missing in hall API:", id, item.nickname);
      continue;
    }
    const popAvatar = item.avatar || "";
    const hallAvatar = c.avatar || "";
    const hallCover = c.cover || "";
    const issues = [];
    if (unstable(popAvatar)) issues.push("pop avatar unstable");
    if (unstable(hallAvatar)) issues.push("hall avatar unstable");
    if (unstable(hallCover)) issues.push("hall cover unstable");
    // Same durable asset family: either equal, or both stable http(s)/relative
    if (popAvatar && hallAvatar && popAvatar !== hallAvatar && popAvatar !== hallCover) {
      // still OK if both are stable public URLs pointing to same companion media
      if (!unstable(popAvatar) && !unstable(hallAvatar)) {
        console.log("INFO avatar differs but both stable:", id, { popAvatar, hallAvatar, hallCover });
      } else {
        issues.push("avatar mismatch with unstable url");
      }
    }
    if (issues.length) {
      fail++;
      console.log("FAIL", id, item.nickname, issues.join(" | "), { popAvatar, hallAvatar, hallCover });
    } else {
      console.log("PASS", id, item.nickname || c.name, { popAvatar, hallAvatar, hallCover });
    }
  }

  // Sample detail for first overlapping companion
  const sample = items.find((i) => byId[String(i.companionId)]);
  if (sample) {
    const id = sample.companionId;
    const detailRes = await fetch(`${BASE}/api/public/companions?id=${encodeURIComponent(id)}`, { cache: "no-store" });
    const detail = await detailRes.json();
    const d = (detail.companions || [])[0];
    if (!d) {
      fail++;
      console.log("FAIL detail missing", id);
    } else {
      const hall = byId[String(id)];
      if (d.avatar !== hall.avatar || d.cover !== hall.cover) {
        console.log("INFO detail vs hall", { detailAvatar: d.avatar, hallAvatar: hall.avatar, detailCover: d.cover, hallCover: hall.cover });
      }
      if (unstable(d.avatar) || unstable(d.cover)) {
        fail++;
        console.log("FAIL detail unstable media", id, d.avatar, d.cover);
      } else {
        console.log("PASS detail", id, d.name);
      }
    }
  }

  console.log(fail ? `\nFAILED ${fail}` : "\nALL CHECKS PASS");
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(2);
});
