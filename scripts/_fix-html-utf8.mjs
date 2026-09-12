import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".vercel",
  "dist",
  "coverage",
  ".tools",
]);

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name)) continue;
      walk(p, out);
    } else if (ent.name.toLowerCase().endsWith(".html")) {
      out.push(p);
    }
  }
  return out;
}

function isValidUtf8(buf) {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buf);
    return true;
  } catch {
    return false;
  }
}

function nullCount(buf, limit = 8000) {
  let n = 0;
  const end = Math.min(buf.length, limit);
  for (let i = 0; i < end; i++) if (buf[i] === 0) n++;
  return n;
}

function looksLikeUtf16Le(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return true;
  const n = Math.min(buf.length, 4000);
  if (n < 20) return false;
  let oddNull = 0;
  for (let i = 1; i < n; i += 2) if (buf[i] === 0) oddNull++;
  return oddNull / (n / 2) > 0.4;
}

function looksLikeUtf16Be(buf) {
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return true;
  const n = Math.min(buf.length, 4000);
  if (n < 20) return false;
  let evenNull = 0;
  for (let i = 0; i < n; i += 2) if (buf[i] === 0) evenNull++;
  return evenNull / (n / 2) > 0.4;
}

function stripBom(buf) {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.subarray(3);
  }
  return buf;
}

function decodeToUtf8String(buf) {
  if (looksLikeUtf16Le(buf)) {
    return buf.toString("utf16le").replace(/^\uFEFF/, "");
  }
  if (looksLikeUtf16Be(buf)) {
    // swap bytes then decode as utf16le
    const swapped = Buffer.alloc(buf.length - (buf.length % 2));
    for (let i = 0; i + 1 < swapped.length; i += 2) {
      swapped[i] = buf[i + 1];
      swapped[i + 1] = buf[i];
    }
    return swapped.toString("utf16le").replace(/^\uFEFF/, "");
  }
  const noBom = stripBom(buf);
  if (isValidUtf8(noBom)) {
    return noBom.toString("utf8");
  }
  // Fallback: latin1 preserve bytes then drop replacement-like junk
  return noBom.toString("latin1");
}

function sanitizeHtmlText(text) {
  // Remove NULs and other C0 controls except \t \n \r
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code === 0) continue;
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) continue;
    if (code === 0xfffd) continue; // replacement char
    out += ch;
  }
  // Normalize newlines to LF
  out = out.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return out;
}

function gitShow(rel) {
  try {
    return execSync(`git show HEAD:${rel.replace(/\\/g, "/")}`, {
      encoding: "buffer",
      maxBuffer: 20 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return null;
  }
}

const cfg = fs.readFileSync(path.join(root, "vite.config.js"), "utf8");
const pagesMatch = cfg.match(/const pages = \[([\s\S]*?)\];/);
const vitePages = pagesMatch
  ? [...pagesMatch[1].matchAll(/"([^"]+\.html)"/g)].map((m) => m[1])
  : [];

const allHtml = walk(root);
const report = {
  scanned: allHtml.length,
  vitePages: vitePages.length,
  restoredFromGit: [],
  rewrittenUtf8: [],
  emptyAfter: [],
  stillBad: [],
};

for (const abs of allHtml) {
  const rel = path.relative(root, abs);
  const relPosix = rel.replace(/\\/g, "/");
  // Skip generated/tmp shot HTML that embeds binary PNGs as UTF-16-ish junk
  if (relPosix.includes("scripts/tmp-") || relPosix.includes("tmp-layout-shots")) {
    continue;
  }

  let buf = fs.readFileSync(abs);
  const needsRestore =
    buf.length < 50 ||
    !isValidUtf8(buf) ||
    looksLikeUtf16Le(buf) ||
    looksLikeUtf16Be(buf) ||
    nullCount(buf) > 20;

  if (needsRestore && buf.length < 50) {
    const fromGit = gitShow(relPosix);
    if (fromGit && fromGit.length >= 50) {
      buf = fromGit;
      report.restoredFromGit.push(relPosix);
    }
  } else if (needsRestore && buf.length >= 50) {
    // try decode/convert; if still empty-ish, fall back to git
    let text = sanitizeHtmlText(decodeToUtf8String(buf));
    if (text.trim().length < 50) {
      const fromGit = gitShow(relPosix);
      if (fromGit && fromGit.length >= 50) {
        buf = fromGit;
        report.restoredFromGit.push(relPosix);
      }
    }
  }

  let text = sanitizeHtmlText(decodeToUtf8String(buf));
  // If still tiny and listed in vite pages, restore from git again
  if (text.trim().length < 50) {
    const fromGit = gitShow(relPosix);
    if (fromGit && fromGit.length >= 50) {
      text = sanitizeHtmlText(decodeToUtf8String(fromGit));
      if (!report.restoredFromGit.includes(relPosix)) {
        report.restoredFromGit.push(relPosix);
      }
    }
  }

  const outBuf = Buffer.from(text, "utf8");
  const prev = fs.existsSync(abs) ? fs.readFileSync(abs) : Buffer.alloc(0);
  if (!prev.equals(outBuf)) {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, outBuf);
    report.rewrittenUtf8.push(relPosix);
  }

  if (outBuf.length < 50) report.emptyAfter.push(relPosix);
  if (!isValidUtf8(outBuf) || nullCount(outBuf) > 0) {
    report.stillBad.push(relPosix);
  }
}

// Ensure every vite page exists and is non-empty UTF-8
for (const page of vitePages) {
  const abs = path.join(root, page);
  if (!fs.existsSync(abs) || fs.statSync(abs).size < 50) {
    const fromGit = gitShow(page);
    if (fromGit && fromGit.length >= 50) {
      const text = sanitizeHtmlText(decodeToUtf8String(fromGit));
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, Buffer.from(text, "utf8"));
      report.restoredFromGit.push(page);
      report.rewrittenUtf8.push(page);
    } else {
      report.stillBad.push(page + " (missing, no git)");
    }
  }
}

console.log(JSON.stringify(report, null, 2));
