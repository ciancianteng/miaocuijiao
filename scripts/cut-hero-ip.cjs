/**
 * Cut white/near-white background from Meow Cui Jiao hero IP reference → transparent PNG.
 */
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const SRC =
  process.argv[2] ||
  path.join(
    process.env.USERPROFILE || "",
    ".cursor/projects/c-Users-cianc-Desktop-meow-cuijiao-homepage-meow-cuijiao-homepage/assets",
    "c__Users_cianc_AppData_Roaming_Cursor_User_workspaceStorage_d300ec47d71058dd9b69ebaf5c691127_images_Image_20260910102209_3141_50-b1bcaf8a-da48-4978-ab60-f7721e3ccf41.jpg"
  );
const OUT_PNG = path.join(__dirname, "..", "assets", "meow-cuijiao-hero-ip.png");
const OUT_WEBP = path.join(__dirname, "..", "assets", "meow-cuijiao-hero-ip.webp");

async function main() {
  if (!fs.existsSync(SRC)) throw new Error("source missing: " + SRC);
  const { data, info } = await sharp(SRC)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  for (let i = 0; i < data.length; i += channels) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    // Soft white-key: keep pink edges / mustache / controller black.
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const chroma = max - min;
    const brightness = (r + g + b) / 3;
    // Near-white low-chroma → transparent
    if (brightness > 235 && chroma < 28) {
      data[i + 3] = 0;
    } else if (brightness > 210 && chroma < 18) {
      data[i + 3] = Math.min(data[i + 3], 40);
    } else if (brightness > 190 && chroma < 12) {
      data[i + 3] = Math.min(data[i + 3], 110);
    }
  }

  const base = sharp(data, { raw: { width, height, channels } });
  await base.clone().png().toFile(OUT_PNG);
  await base.clone().webp({ quality: 92 }).toFile(OUT_WEBP);
  const st = fs.statSync(OUT_PNG);
  console.log(JSON.stringify({ src: SRC, outPng: OUT_PNG, outWebp: OUT_WEBP, bytes: st.size, width, height }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
