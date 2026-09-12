/**
 * Companion private doc upload acceptance (identity + deposit).
 * Usage: node scripts/e2e-companion-private-docs.mjs <preview-base>
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
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}
function makePng(size = 64) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const i = y * (size * 3 + 1) + 1 + x * 3;
      raw[i] = 40 + ((x * 3) % 180);
      raw[i + 1] = 80 + ((y * 2) % 120);
      raw[i + 2] = 160;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function dataUrl(buf) {
  return `data:image/png;base64,${buf.toString("base64")}`;
}

const results = [];
function mark(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(ok ? "PASS" : "FAIL", name, detail || "");
}

async function main() {
  const png = dataUrl(makePng(96));
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
  mark("login", !!token, cid || login.message);

  async function api(action, body = {}) {
    const res = await fetch(`${BASE}/api/companion`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ action, ...body }),
    });
    const json = await res.json().catch(() => ({}));
    return { res, json };
  }

  const front = await api("upload_private_doc", {
    doc_type: "id_front",
    data_url: png,
    filename: "id-front-test.png",
  });
  mark("1. upload id front", !!(front.res.ok && front.json.ok && front.json.url), front.json.message || front.json.url);

  const back = await api("upload_private_doc", {
    doc_type: "id_back",
    data_url: png,
    filename: "id-back-test.png",
  });
  mark("2. upload id back", !!(back.res.ok && back.json.ok && back.json.url), back.json.message || back.json.url);

  const proof = await api("upload_private_doc", {
    doc_type: "deposit_proof",
    data_url: png,
    filename: "deposit-proof-test.png",
  });
  mark("3. upload deposit proof", !!(proof.res.ok && proof.json.ok && proof.json.url), proof.json.message || proof.json.url);

  const boot = await fetch(`${BASE}/api/companion?action=bootstrap`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
  }).then((r) => r.json());
  const v = boot?.data?.verification || {};
  const d = boot?.data?.deposit || {};
  mark("4. bootstrap shows front thumb url", !!v.idFrontUrl && !/^data:/i.test(v.idFrontUrl), (v.idFrontUrl || "").slice(0, 80));
  mark("4b. bootstrap shows back thumb url", !!v.idBackUrl && !/^data:/i.test(v.idBackUrl), (v.idBackUrl || "").slice(0, 80));
  mark("4c. bootstrap shows proof thumb url", !!d.proofUrl && !/^data:/i.test(d.proofUrl), (d.proofUrl || "").slice(0, 80));

  // refresh / re-login persistence
  const login2 = await fetch(`${BASE}/api/companion`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "login",
      account: "companion@meow.test",
      password: "McjTest@12345678",
    }),
  }).then((r) => r.json());
  const token2 = login2.session?.token || "";
  const boot2 = await fetch(`${BASE}/api/companion?action=bootstrap`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token2}` },
  }).then((r) => r.json());
  const v2 = boot2?.data?.verification || {};
  const d2 = boot2?.data?.deposit || {};
  mark("5/6. after re-login still has media", !!(v2.idFrontUrl && v2.idBackUrl && d2.proofUrl));

  // public leak check
  const pub = await fetch(`${BASE}/api/public/companions?id=${encodeURIComponent(cid)}`, {
    cache: "no-store",
  }).then((r) => r.json());
  const row = (pub.companions || [])[0] || {};
  const leak =
    JSON.stringify(row).includes("idFront") ||
    JSON.stringify(row).includes("id_front") ||
    JSON.stringify(row).includes("proofUrl") ||
    JSON.stringify(row).includes("proof_path") ||
    JSON.stringify(row).includes("companion-identities") ||
    JSON.stringify(row).includes("companion-payment-proofs");
  mark("8. public API hides identity/deposit images", !leak, leak ? "LEAK" : "clean");

  // re-upload overwrite
  const front2 = await api("upload_private_doc", {
    doc_type: "id_front",
    data_url: png,
    filename: "id-front-reupload.png",
  });
  mark("9. re-upload covers old", !!(front2.res.ok && front2.json.ok && front2.json.url));

  // delete
  const del = await api("delete_private_doc", { doc_type: "id_front" });
  const boot3 = await fetch(`${BASE}/api/companion?action=bootstrap`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
  }).then((r) => r.json());
  const v3 = boot3?.data?.verification || {};
  mark(
    "10. delete syncs",
    !!(del.res.ok && del.json.ok) && !v3.idFrontUrl && !v3.hasIdFront,
    `hasIdFront=${v3.hasIdFront} url=${v3.idFrontUrl || ""}`
  );

  // restore front for less disruption
  await api("upload_private_doc", {
    doc_type: "id_front",
    data_url: png,
    filename: "id-front-restore.png",
  });

  const failed = results.filter((r) => !r.ok);
  console.log("\nSummary:", results.length - failed.length, "PASS /", failed.length, "FAIL");
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
