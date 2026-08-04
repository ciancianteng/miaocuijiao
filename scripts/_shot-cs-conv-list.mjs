import { chromium } from 'playwright-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, 'tmp-layout-shots');
fs.mkdirSync(outDir, { recursive: true });

const candidates = [
  process.env.CHROME_PATH,
  'C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe',
  'C:\\\\Program Files (x86)\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe',
  process.env.LOCALAPPDATA + '\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe',
  'C:\\\\Program Files\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe',
].filter(Boolean);

let exe = null;
for (const c of candidates) {
  try { if (fs.existsSync(c)) { exe = c; break; } } catch {}
}
if (!exe) throw new Error('No Chrome/Edge found');

const url = 'http://127.0.0.1:5173/scripts/tmp-cs-conv-list-preview.html';
const browser = await chromium.launch({ executablePath: exe, headless: true });

async function shot(name, size, opts = {}) {
  const page = await browser.newPage({ viewport: size });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('.cs-conversation', { state: 'attached', timeout: 10000 });
  await page.waitForTimeout(300);
  if (opts.mobileOnly) {
    await page.addStyleTag({
      content: `
        .preview-shell{grid-template-columns:1fr!important}
        .preview-side,.preview-note{display:none!important}
        .preview-main{padding:0!important;height:100vh!important}
        .preview-panel{width:100%!important;height:100vh!important;border-radius:0!important;border:0!important}
        .cs-chat-list{
          display:flex!important;
          position:static!important;
          inset:auto!important;
          transform:none!important;
          width:100%!important;
          max-width:100%!important;
          height:100%!important;
        }
      `,
    });
    await page.evaluate(() => {
      const list = document.querySelector('.cs-chat-list');
      if (list) list.classList.add('is-open');
    });
    await page.waitForTimeout(200);
  }
  const metrics = await page.evaluate(() => {
    const el = document.querySelector('.cs-conversation');
    const r = el.getBoundingClientRect();
    const texts = [...document.querySelectorAll('.cs-conversation')].slice(0, 3).map((n) => ({
      h: Math.round(n.getBoundingClientRect().height),
      name: n.querySelector('.cs-conv-name')?.textContent || '',
      meta: n.querySelector('.cs-conv-meta')?.textContent || '',
      tag: n.querySelector('.cs-conv-tag')?.textContent || '',
      preview: n.querySelector('.cs-conv-preview')?.textContent || '',
      time: n.querySelector('.cs-conv-time')?.textContent || '',
      unread: n.querySelector('.cs-conv-unread')?.textContent || '',
    }));
    return { h: Math.round(r.height), texts, visible: r.height > 0 && r.width > 0 };
  });
  const file = path.join(outDir, name);
  await page.screenshot({ path: file, fullPage: false });
  await page.close();
  return { file, metrics };
}

const desktop = await shot('cs-conv-list-desktop.png', { width: 1366, height: 900 });
const mobile = await shot('cs-conv-list-mobile.png', { width: 390, height: 844 }, { mobileOnly: true });
await browser.close();

const report = { desktop, mobile, at: new Date().toISOString() };
fs.writeFileSync(path.join(outDir, 'cs-conv-list-verify.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
