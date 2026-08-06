/**
 * Probe companion-apply assets for SyntaxError / capture attrs.
 */
import fs from "node:fs";

const files = [
  "src/companion-application.js",
  "src/mcj-upload.js",
  "dist/assets/companion-apply-BxnnyEcp.js",
  "dist/assets/mcj-upload-B5rgHGy5.js",
];

for (const f of files) {
  if (!fs.existsSync(f)) {
    console.log("MISS", f);
    continue;
  }
  const code = fs.readFileSync(f, "utf8");
  const captureHits = (code.match(/capture\s*=\s*["'](?:camera|environment|user)["']/g) || []).length;
  const captureTrue = (code.match(/capture:\s*opts\.capture\s*!==\s*false/g) || []).length;
  console.log(f, {
    bytes: code.length,
    captureAttrHits: captureHits,
    captureDefaultTrue: captureTrue,
  });
}

// Fetch staging
const base = "https://meow-cuijiao-homepage-staging.vercel.app";
const html = await (await fetch(base + "/companion-apply.html")).text();
const scripts = [...html.matchAll(/src="([^"]+\.js)"/g)].map((m) => m[1]);
console.log("staging scripts", scripts);
for (const src of scripts) {
  const url = src.startsWith("http") ? src : base + src;
  const code = await (await fetch(url)).text();
  const captureHits = (code.match(/capture\s*=\s*["'](?:camera|environment|user)["']/g) || []).length;
  console.log("staging", src, "bytes", code.length, "captureHits", captureHits);
  // Write temp and node --check for non-module chunks
  if (!/\bimport\b|\bexport\b/.test(code.slice(0, 200))) {
    try {
      // eslint-disable-next-line no-new-func
      new Function(code);
      console.log("  parse OK (classic)");
    } catch (e) {
      console.log("  PARSE FAIL", e.message);
    }
  }
}
