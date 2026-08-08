/**
 * Multi-width overlap check for header + boss filter bar.
 * Exits 1 if any overlap found.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const WIDTHS = [1920, 1440, 1280, 1024, 768, 430, 390, 375, 320];
const BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:4173';
const OUT = path.join(__dirname, 'tmp-layout-shots');

function overlaps(a, b) {
  return !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
}

async function rects(page, selector) {
  return page.$$eval(selector, (els) =>
    els
      .filter((el) => {
        const s = getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      })
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          label: el.getAttribute('aria-label') || el.className || el.tagName,
          text: (el.textContent || '').trim().slice(0, 40),
          left: r.left,
          top: r.top,
          right: r.right,
          bottom: r.bottom,
          width: r.width,
          height: r.height,
        };
      })
  );
}

async function checkPage(page, width, url, kind) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(400);

  const shot = path.join(OUT, `${kind}-${width}.png`);
  await page.screenshot({ path: shot, fullPage: false });

  const issues = [];

  if (kind === 'header' || kind === 'verify') {
    const deskVisible = await page.evaluate(() => {
      const el = document.querySelector('.mcj-desk-nav');
      if (!el) return false;
      const s = getComputedStyle(el);
      return s.display !== 'none' && s.visibility !== 'hidden';
    });
    const mnavVisible = await page.evaluate(() => {
      const el = document.querySelector('.mcj-mnav');
      if (!el) return false;
      const s = getComputedStyle(el);
      return s.display !== 'none' && s.visibility !== 'hidden';
    });
    const starVisible = await page.evaluate(() => {
      const sels = ['.mcj-boss-star', '.header-star', '[data-favorite]', '[data-mcj-favorite]'];
      const legacy = sels.some((sel) => {
        const el = document.querySelector(sel);
        if (!el) return false;
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
      });
      const toggle = document.querySelector('.mcj-mnav-toggle');
      if (!toggle) return legacy;
      const icon = toggle.querySelector('.mcj-line-icon, .mcj-inline-icon, svg');
      if (!icon) return legacy;
      const s = getComputedStyle(icon);
      const r = icon.getBoundingClientRect();
      return legacy || (s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0);
    });

    if (width < 900) {
      if (deskVisible) issues.push('mobile shows desktop nav');
      if (!mnavVisible) issues.push('mobile missing mnav');
      if (starVisible) issues.push('star visible on mobile');
      const brand = await page.$('.mcj-mnav-brand');
      const toggle = await page.$('.mcj-mnav-toggle');
      if (!brand || !toggle) {
        issues.push('missing brand or toggle');
      } else {
        const br = await brand.boundingBox();
        const tr = await toggle.boundingBox();
        if (br && tr) {
          if (overlaps(
            { left: br.x, top: br.y, right: br.x + br.width, bottom: br.y + br.height },
            { left: tr.x, top: tr.y, right: tr.x + tr.width, bottom: tr.y + tr.height }
          )) {
            issues.push('brand overlaps toggle');
          }
          if (br.x > tr.x) issues.push('brand not left of toggle');
        }
      }
    } else {
      if (!deskVisible) issues.push('desktop missing desk nav');
      if (mnavVisible) issues.push('desktop shows mobile nav');
    }
  }

  if (kind === 'filter' || kind === 'verify') {
    const kids = await rects(page, '.boss-filter-bar > *');
    for (let i = 0; i < kids.length; i++) {
      for (let j = i + 1; j < kids.length; j++) {
        if (overlaps(kids[i], kids[j])) {
          issues.push(`filter overlap: [${i}]${kids[i].text || kids[i].label} x [${j}]${kids[j].text || kids[j].label}`);
        }
      }
    }
    // date must not cover search
    const dateEl = kids.find((k) => String(k.label).includes('注册日期') || k.label === '注册日期');
    const searchEl = kids.find((k) => String(k.label).includes('搜索') && k.width > 80);
    // fallback by index order: 0 vip, 1 status, 2 date, 3 search
    const date = kids[2];
    const search = kids[3];
    if (date && search && overlaps(date, search)) {
      issues.push('date covers search');
    }
  }

  return { width, kind, issues, shot };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const results = [];

  // Fixture page has both
  for (const w of WIDTHS) {
    results.push(await checkPage(page, w, `${BASE}/_layout-verify.html`, 'verify'));
  }

  // Real index header
  for (const w of WIDTHS) {
    results.push(await checkPage(page, w, `${BASE}/index.html`, 'header'));
  }

  await browser.close();

  let fail = 0;
  for (const r of results) {
    const status = r.issues.length ? 'FAIL' : 'PASS';
    if (r.issues.length) fail++;
    console.log(`${status} ${r.kind}@${r.width}: ${r.issues.length ? r.issues.join(' | ') : 'ok'} (${r.shot})`);
  }
  console.log(fail ? `\nFAILED: ${fail}` : '\nALL PASS');
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(2);
});
