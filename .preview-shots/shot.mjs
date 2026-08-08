const { chromium } = require('playwright');
(async () => {
  const base = process.env.BASE;
  const out = process.env.OUT;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await page.goto(base + '/customer-service/login/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.fill('input[name="account"]', 'service@meow.test');
  await page.fill('input[name="password"]', 'McjTest@12345678');
  await page.click('button[type="submit"]');
  await page.waitForURL(/customer-service\/(dashboard|conversations)/, { timeout: 30000 }).catch(()=>{});
  await page.waitForTimeout(1500);
  await page.goto(base + '/customer-service/conversations', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForSelector('.cs-chat-layout, .cs-conversation, .cs-empty', { timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: out + '/01-cs-compact.png', fullPage: false });

  const waitingTab = page.locator('[data-conv-filter="waiting"]');
  if (await waitingTab.count()) await waitingTab.click();
  await page.waitForTimeout(500);
  const unread = page.locator('.cs-conversation .cs-conv-unread').first();
  if (await unread.count()) {
    await unread.locator('xpath=ancestor::button[contains(@class,"cs-conversation")]').click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: out + '/02-unread-cleared.png', fullPage: false });
  } else {
    const activeTab = page.locator('[data-conv-filter="active"]');
    if (await activeTab.count()) await activeTab.click();
    await page.waitForTimeout(400);
    const first = page.locator('.cs-conversation').first();
    if (await first.count()) { await first.click(); await page.waitForTimeout(1500); }
    await page.screenshot({ path: out + '/02-unread-cleared.png', fullPage: false });
  }

  const endBtn = page.locator('[data-end]').first();
  if (await endBtn.count()) {
    page.once('dialog', async d => { await d.accept(); });
    await endBtn.click();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: out + '/03-after-end-list.png', fullPage: false });
  } else {
    const take = page.locator('[data-take]').first();
    if (await take.count()) {
      await take.click();
      await page.waitForTimeout(2000);
      page.once('dialog', async d => { await d.accept(); });
      const end2 = page.locator('[data-end]').first();
      if (await end2.count()) { await end2.click(); await page.waitForTimeout(2500); }
    }
    await page.screenshot({ path: out + '/03-after-end-list.png', fullPage: false });
  }

  const boss = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await boss.goto(base + '/login.html', { waitUntil: 'networkidle', timeout: 60000 });
  const email = boss.locator('input[name="email"], input[name="account"], input[type="email"]').first();
  const pass = boss.locator('input[name="password"], input[type="password"]').first();
  if (await email.count()) {
    await email.fill('boss@meow.test');
    await pass.fill('McjTest@12345678');
    const submit = boss.locator('button[type="submit"], [data-login-confirm]').first();
    await submit.click();
    await boss.waitForTimeout(2500);
  }
  await boss.goto(base + '/support.html', { waitUntil: 'networkidle', timeout: 60000 });
  await boss.waitForTimeout(2500);
  const sess = boss.locator('.support-session, [data-open-order-conversation], .support-order-card').first();
  if (await sess.count()) { await sess.click(); await boss.waitForTimeout(2000); }
  await boss.screenshot({ path: out + '/04-boss-ended.png', fullPage: false });

  const emojiCount = await page.locator('[data-cs-emoji], [data-cs-attach]').count();
  console.log('emoji_attach_count=' + emojiCount);
  console.log('done');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
