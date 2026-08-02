/**
 * Upload a recognizable 128x128 gradient PNG as avatar + cover for companion@meow.test
 * Usage: node scripts/upload-real-companion-media.mjs <preview-base>
 */
import zlib from "zlib";

const BASE = process.argv[2] || process.env.VERIFY_BASE;
if (!BASE) {
  console.error("Need preview base URL");
  process.exit(2);
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
  const crc = crc32(Buffer.concat([typeBuf, data]));
  crcBuf.writeUInt32BE(crc, 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/** Solid pinkish card with teal corner so visual QA isn't a flat 1x1 red pixel. */
function makePng(size = 128) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const i = y * (size * 3 + 1) + 1 + x * 3;
      const edge = x < 18 || y < 18;
      raw[i] = edge ? 40 : 255; // R
      raw[i + 1] = edge ? 180 : 140 + Math.floor((x / size) * 60); // G
      raw[i + 2] = edge ? 190 : 190 + Math.floor((y / size) * 40); // B
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function dataUrl(buf) {
  return `data:image/png;base64,${buf.toString("base64")}`;
}

async function main() {
  const png = makePng(128);
  const login = await fetch(`${BASE}/api/companion`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "login",
      account: "companion@meow.test",
      password: "McjTest@12345678",
    }),
  }).then((r) => r.json());
  const token = login.session?.token || "";
  const cid = login.session?.user?.id || "";
  if (!token) throw new Error("login failed " + JSON.stringify(login).slice(0, 200));

  async function upload(media_type, filename) {
    const res = await fetch(`${BASE}/api/companion`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        action: "upload_media",
        media_type,
        data_url: dataUrl(png),
        filename,
      }),
    });
    const body = await res.json();
    console.log(media_type, res.status, body.ok, body.url || body.message);
    return body;
  }

  const avatar = await upload("avatar", "real-sync-avatar.png");
  const cover = await upload("cover", "real-sync-cover.png");
  const list = await fetch(`${BASE}/api/public/companions`, { cache: "no-store" }).then((r) => r.json());
  const found = (list.companions || []).find((c) => String(c.id) === String(cid));
  console.log(
    JSON.stringify(
      {
        cid,
        public: found && {
          name: found.name,
          avatar: found.avatar,
          cover: found.cover,
          same: found.avatar === found.cover || (found.avatar && found.cover),
        },
        avatarUrl: avatar.url,
        coverUrl: cover.url,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
