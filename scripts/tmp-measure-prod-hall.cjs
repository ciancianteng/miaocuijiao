const { chromium } = require('playwright-core');
const path = require('path');
(async () => {
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
  } catch (e1) {
    try {
      browser = await chromium.launch({ channel: 'msedge', headless: true });
    } catch (e2) {
      const exe = chromium.executablePath();
      browser = await chromium.launch({ executablePath: exe, headless: true });
    }
  }
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto('https://www.meowcuijiao.com/companion-center.html', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForSelector('.player-card', { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(5000);
  const data = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.player-card')];
    const first = cards[0];
    const media = first && first.querySelector('.companion-card-media');
    const cs = media ? getComputedStyle(media) : null;
    const sheets = [...document.querySelectorAll('link[rel=stylesheet]')].map(l => l.href);
    const verified = document.querySelector('.mcj-verified-badge');
    let before = null;
    if (verified) {
      try { before = getComputedStyle(verified, '::before').content; } catch (_) {}
    }
    const vh = window.innerHeight;
    const visible = cards.filter(c => {
      const r = c.getBoundingClientRect();
      return r.top < vh && r.bottom > 40;
    }).length;
    return {
      viewport: { w: window.innerWidth, h: vh },
      cardCount: cards.length,
      visibleCardsApprox: visible,
      firstCardOffsetHeight: first ? first.offsetHeight : null,
      firstCardRatio: first ? +(first.offsetHeight / vh).toFixed(3) : null,
      mediaAspectRatio: cs ? cs.aspectRatio : null,
      mediaHeight: media ? media.offsetHeight : null,
      mediaWidth: media ? media.offsetWidth : null,
      sheets,
      verifiedText: verified ? verified.textContent : null,
      verifiedBeforeContent: before,
      tagMore: !!document.querySelector('.companion-tag-more'),
      paddingBottom: getComputedStyle(document.querySelector('.companion-hall-page')||document.body).paddingBottom
    };
  });
  const cssUrl = data.sheets.find(s => /companion-center/.test(s));
  let cssProbe = null;
  if (cssUrl) {
    const res = await page.request.get(cssUrl);
    const text = await res.text();
    cssProbe = {
      url: cssUrl,
      len: text.length,
      hasBannerMarker: text.includes('Banner+Hall compact'),
      has169: /16\s*\/\s*9/.test(text),
      has1610: /16\s*\/\s*10/.test(text),
      has45: /4\s*\/\s*5/.test(text)
    };
  }
  console.log(JSON.stringify({ data, cssProbe }, null, 2));
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
