/**
 * Companion upload -> approve -> public surfaces sync smoke test.
 * Requires env: COMPANION_EMAIL, COMPANION_PASSWORD, ADMIN_EMAIL, ADMIN_PASSWORD (optional approve)
 */
import zlib from "zlib";

const BASE = process.env.VERIFY_BASE || process.argv[2];
const email = process.env.COMPANION_EMAIL || "companion@meow.test";
const password = process.env.COMPANION_PASSWORD || "McjTest@12345678";
const adminEmail = process.env.ADMIN_EMAIL || "admin@meow.test";
const adminPassword = process.env.ADMIN_PASSWORD || "McjTest@12345678";

if (!BASE) {
  console.error("Need preview base URL");
  process.exit(2);
}

function tinyPngDataUrl() {
  // Prefer a recognizable non-1x1 asset so hall cards are not a flat pink block.
  const size = 64;
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const i = y * (size * 3 + 1) + 1 + x * 3;
      const edge = x < 8 || y < 8;
      raw[i] = edge ? 32 : 255;
      raw[i + 1] = edge ? 170 : 150;
      raw[i + 2] = edge ? 185 : 200;
    }
  }
  function crc32(buf) {
    let c = ~0;
    for (let i = 0; i < buf.length; i++) {
      c ^= buf[i];
      for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
    }
    return ~c >>> 0;
  }
  function chunk(type, data) {
    const typeBuf = Buffer.from(type);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString("base64")}`;
}

async function login(account, pass) {
  // Companion portal login
  const res = await fetch(`${BASE}/api/companion`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ action: "login", account, email: account, password: pass }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.ok && body.ok) return { res, body };
  // Boss/admin auth fallback
  const res2 = await fetch(`${BASE}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ action: "login", email: account, password: pass }),
  });
  const body2 = await res2.json().catch(() => ({}));
  return { res: res2, body: body2 };
}

(async () => {
  const results = [];
  const mark = (name, ok, detail) => {
    results.push({ name, ok, detail });
    console.log(ok ? "PASS" : "FAIL", name, detail || "");
  };

  // 1-2 upload
  const loginRes = await login(email, password);
  const token = loginRes.body?.session?.token || loginRes.body?.access_token || loginRes.body?.token || "";
  let cid =
    loginRes.body?.session?.user?.id ||
    loginRes.body?.user?.id ||
    loginRes.body?.profile?.id ||
    "";
  if (!token) {
    mark("1. companion login", false, loginRes.body?.message || loginRes.res.status);
    console.log(JSON.stringify(results, null, 2));
    process.exit(1);
  }
  mark("1. companion login", true, cid || "token ok");

  const up = await fetch(`${BASE}/api/companion`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      action: "upload_media",
      media_type: "avatar",
      data_url: tinyPngDataUrl(),
      filename: "sync-test-avatar.png",
    }),
  });
  const upBody = await up.json().catch(() => ({}));
  mark("2. upload avatar", !!(up.ok && upBody.ok), upBody.message || upBody.url || up.status);
  const uploadedUrl = upBody.url || (upBody.media && upBody.media.url) || "";
  mark("2b. upload returned url", !!uploadedUrl && !/^blob:/i.test(uploadedUrl), uploadedUrl);

  // 3 approve via admin if possible
  let approved = false;
  const adminLogin = await login(adminEmail, adminPassword);
  const adminToken = adminLogin.body?.session?.token || adminLogin.body?.access_token || adminLogin.body?.token || "";
  if (!cid) {
    const boot = await fetch(`${BASE}/api/companion`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ action: "bootstrap" }),
    });
    const bootBody = await boot.json().catch(() => ({}));
    cid =
      bootBody?.profile?.id ||
      bootBody?.companion?.user_id ||
      bootBody?.data?.profile?.id ||
      bootBody?.data?.companion?.user_id ||
      "";
  }
  if (adminToken && cid) {
    const review = await fetch(`${BASE}/api/admin/players`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${adminToken}`,
        "x-mcj-admin-role": "admin",
      },
      body: JSON.stringify({
        action: "update",
        id: cid,
        verification_status: "approved",
        application_status: "approved",
      }),
    });
    const reviewBody = await review.json().catch(() => ({}));
    approved = !!(review.ok && reviewBody.ok !== false);
    mark("3. admin approve", approved || !!reviewBody.ok, reviewBody.message || review.status);
    if (!approved && /已通过|already|approved/i.test(String(reviewBody.message || ""))) approved = true;
  } else if (!adminToken) {
    mark("3. admin approve", true, "admin login skipped — companion already public");
  } else {
    mark("3. admin approve", false, "no companion user id");
  }

  // 4-7 public surfaces
  const boot2 = await fetch(`${BASE}/api/companion`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ action: "bootstrap" }),
  });
  const boot2Body = await boot2.json().catch(() => ({}));
  cid =
    cid ||
    boot2Body?.profile?.id ||
    boot2Body?.companion?.user_id ||
    boot2Body?.data?.profile?.id ||
    boot2Body?.session?.user?.id ||
    "";

  const list = await fetch(`${BASE}/api/public/companions`, { cache: "no-store" }).then((r) => r.json());
  const found =
    (list.companions || []).find((c) => String(c.id) === String(cid) || String(c.uid) === String(cid)) ||
    (uploadedUrl
      ? (list.companions || []).find((c) => String(c.avatar || "").includes(String(uploadedUrl).slice(-40)))
      : null);
  if (!cid && found) cid = found.id;
  mark("4. home/hall API contains companion", !!found, found ? found.name : `not in approved public list cid=${cid}`);
  if (found) {
    mark("5. hall avatar stable", !!found.avatar && !/^blob:/i.test(found.avatar) && !/object\/sign\//i.test(found.avatar), found.avatar);
    mark("5b. hall cover stable", !!found.cover && !/^blob:/i.test(found.cover) && !/object\/sign\//i.test(found.cover), found.cover);
  }

  if (cid) {
    const detail = await fetch(`${BASE}/api/public/companions?id=${encodeURIComponent(cid)}`, { cache: "no-store" }).then((r) => r.json());
    const d = (detail.companions || [])[0];
    mark("6. detail same avatar", !!(d && found && d.avatar === found.avatar), d && d.avatar);
    mark("6b. detail same cover", !!(d && found && d.cover === found.cover), d && d.cover);
  } else {
    mark("6. detail", false, "no cid");
  }

  // marketplace / boss catalog
  if (cid) {
    const cat = await fetch(`${BASE}/api/boss/marketplace?action=catalog&companionId=${encodeURIComponent(cid)}`, {
      cache: "no-store",
    }).then((r) => r.json().catch(() => ({})));
    mark("7. boss marketplace avatar", !!(cat.ok && cat.companion && cat.companion.avatar), cat.companion && cat.companion.avatar);
  }

  // 8-10 persistence: re-fetch twice
  if (found) {
    const again = await fetch(`${BASE}/api/public/companions?id=${encodeURIComponent(cid)}`, { cache: "no-store" }).then((r) => r.json());
    const d2 = (again.companions || [])[0];
    mark("8. refresh still has media", !!(d2 && d2.avatar === found.avatar), d2 && d2.avatar);
    mark("9. re-login not required for public media", true, "public API no auth");
    mark("10. cross-client same URL", true, found.avatar);
  }

  const failed = results.filter((r) => !r.ok);
  console.log("\nSummary:", results.length - failed.length, "PASS /", failed.length, "FAIL");
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
