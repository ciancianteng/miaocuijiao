/**
 * Remove solid white backdrop via corner flood-fill — keep white fur of Meow Cui Jiao IP.
 */
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const SRC = process.argv[2] || path.join(__dirname, "..", "assets", "_ref-cat-ip.jpg");
const OUT_PNG = path.join(__dirname, "..", "assets", "meow-cuijiao-hero-ip.png");
const OUT_WEBP = path.join(__dirname, "..", "assets", "meow-cuijiao-hero-ip.webp");

function isBg(r, g, b) {
  const brightness = (r + g + b) / 3;
  const chroma = Math.max(r, g, b) - Math.min(r, g, b);
  return brightness >= 245 && chroma <= 18;
}

async function main() {
  const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const N = width * height;
  const mark = new Uint8Array(N);
  const queue = [];

  function push(x, y) {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = y * width + x;
    if (mark[i]) return;
    const o = i * channels;
    if (!isBg(data[o], data[o + 1], data[o + 2])) return;
    mark[i] = 1;
    queue.push(i);
  }

  // Seed from edges
  for (let x = 0; x < width; x++) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    push(0, y);
    push(width - 1, y);
  }

  while (queue.length) {
    const i = queue.pop();
    const x = i % width;
    const y = (i / width) | 0;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }

  // Soften edge: also clear near-white neighbors of marked bg (1px feather)
  const soft = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (!mark[i]) continue;
    const x = i % width;
    const y = (i / width) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const ni = ny * width + nx;
        if (mark[ni]) continue;
        const o = ni * channels;
        const brightness = (data[o] + data[o + 1] + data[o + 2]) / 3;
        const chroma = Math.max(data[o], data[o + 1], data[o + 2]) - Math.min(data[o], data[o + 1], data[o + 2]);
        if (brightness > 232 && chroma < 22) soft[ni] = 1;
      }
    }
  }

  for (let i = 0; i < N; i++) {
    const o = i * channels;
    if (mark[i]) data[o + 3] = 0;
    else if (soft[i]) data[o + 3] = Math.min(data[o + 3], 60);
  }

  const base = sharp(data, { raw: { width, height, channels } });
  await base.clone().png().toFile(OUT_PNG);
  await base.clone().webp({ quality: 92 }).toFile(OUT_WEBP);
  fs.copyFileSync(OUT_PNG, path.join(__dirname, "..", "src", "assets", "meow-cuijiao-hero-ip.png"));
  fs.copyFileSync(OUT_WEBP, path.join(__dirname, "..", "src", "assets", "meow-cuijiao-hero-ip.webp"));
  console.log(JSON.stringify({ width, height, bgPixels: mark.reduce((a, b) => a + b, 0), out: OUT_WEBP }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
