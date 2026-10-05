const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { createServer } = require('../tools/serve.cjs');
const fs = require('node:fs');

(async () => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  let checks = 0;
  const check = (name, value) => { assert.ok(value, name); console.log(`PASS ${name}`); checks++; };
  try {
    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    // Only external data is replaced; the real UI, GSAP and player run normally.
    await context.route('https://camerai1.iticfoundation.org/**', route => route.fulfill({ status: 503, body: 'Offline', headers: { 'access-control-allow-origin': '*' } }));
    await context.route('https://fonts.googleapis.com/**', route => route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const menu = page.locator('#menu-toggle');
    check('mobile navigation has an accessible drawer trigger', await menu.count() === 1);
    await menu.click();
    check('drawer opens with modal semantics and moves focus inside', await page.locator('#sidebar').evaluate(el => el.getAttribute('aria-modal') === 'true' && el.contains(document.activeElement)));
    await page.locator('#sidebar-close').focus();
    await page.keyboard.press('Shift+Tab');
    check('drawer traps backward keyboard navigation', await page.locator('#sidebar').evaluate(el => el.contains(document.activeElement) && document.activeElement.id !== 'sidebar-close'));
    await page.keyboard.press('Escape');
    check('escape closes drawer and restores trigger focus', await menu.evaluate(el => el.getAttribute('aria-expanded') === 'false' && el === document.activeElement));
    await menu.click();
    await page.locator('#nav-analysis').click();
    await page.locator('#analyst').waitFor({ state: 'visible' });
    check('navigation closes mobile drawer', await menu.getAttribute('aria-expanded') === 'false');
    await menu.click();
    await page.locator('#drawer-backdrop').click({ position: { x: 380, y: 400 }, force: true });
    check('backdrop closes drawer', await menu.getAttribute('aria-expanded') === 'false');
    await menu.click();
    await page.setViewportSize({ width: 1440, height: 900 });
    check('desktop resize removes modal and inert state', await page.locator('#sidebar').evaluate(el => !el.hasAttribute('aria-modal') && !el.inert) && await page.locator('.app-main').evaluate(el => !el.inert));
    await page.locator('#nav-live').click();
    check('reduced motion never hides cards', await page.locator('.tile').evaluateAll(els => els.every(el => getComputedStyle(el).opacity === '1' && getComputedStyle(el).transform === 'none')));
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.locator('[data-n="16"]').click();
    check('dense camera layout retains visible footage and contained captions', await page.locator('.tile').evaluateAll(els => els.every(el => {
      const screen = el.querySelector('.screen').getBoundingClientRect();
      const caption = el.querySelector('.caption').getBoundingClientRect();
      return screen.height >= 40 && caption.bottom <= el.getBoundingClientRect().bottom + 1;
    })));
    await page.locator('[data-n="4"]').click();
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844 }, { width: 320, height: 720 }]) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(180);
      check(`no page overflow at ${viewport.width}px`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: `runtime/design-review/premium-live-${viewport.width}.png` });
    }
    await menu.click();
    await page.locator('#nav-analysis').click();
    await page.screenshot({ path: 'runtime/design-review/premium-analysis-mobile.png', fullPage: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: 'runtime/design-review/premium-analysis-desktop.png' });
    await context.close();

    const animated = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await animated.route('https://camerai1.iticfoundation.org/**', route => route.abort());
    const motion = await animated.newPage();
    motion.on('pageerror', error => errors.push(error.message));
    await motion.goto(`http://127.0.0.1:${server.address().port}`);
    check('bundled GSAP is loaded', await motion.evaluate(() => !!globalThis.gsap));
    for (let i = 0; i < 8; i++) {
      await motion.locator('#nav-live').click();
      await motion.locator(`[data-n="${i % 2 ? '4' : '9'}"]`).click();
      await motion.locator('#nav-analysis').click();
    }
    await motion.locator('#nav-live').click();
    await motion.waitForTimeout(750);
    check('rapid transitions restore visible cards with no inline transforms', await motion.locator('.tile').evaluateAll(els => els.every(el => getComputedStyle(el).opacity === '1' && !el.style.transform && !el.style.opacity)));
    check('finite motion leaves no active tweens', await motion.evaluate(() => gsap.globalTimeline.getChildren().filter(t => t.isActive()).length === 0));
    await motion.locator('#fs').click();
    await motion.waitForFunction(() => document.fullscreenElement === document.documentElement);
    check('fullscreen uses the real document without stale transforms', await motion.evaluate(() => document.fullscreenElement === document.documentElement && [...document.querySelectorAll('.tile')].every(el => !el.style.transform)));
    await motion.locator('#fs').click();
    await motion.waitForFunction(() => !document.fullscreenElement);
    await motion.emulateMedia({ reducedMotion: 'reduce' });
    await motion.locator('[data-n="16"]').click();
    check('switching to reduced motion immediately disables animation', await motion.locator('.tile').evaluateAll(els => els.every(el => !el.style.transform && !el.style.opacity)));
    await animated.close();

    const fallback = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await fallback.route('**/vendor/gsap-*.min.js', route => route.abort());
    await fallback.route('https://camerai1.iticfoundation.org/**', route => route.abort());
    const plain = await fallback.newPage();
    plain.on('pageerror', error => errors.push(error.message));
    await plain.goto(`http://127.0.0.1:${server.address().port}/#analyst?camera=03&range=7d`);
    check('direct Analysis entry shows the Thailand clock', await plain.locator('#clock').textContent() !== '--:--:--');
    await plain.locator('.skip-link').focus();
    await plain.keyboard.press('Enter');
    check('skip link focuses the current view without resetting route filters', await plain.evaluate(() => location.hash === '#analyst?camera=03&range=7d' && document.activeElement.id === 'analyst'));
    await plain.goto(`http://127.0.0.1:${server.address().port}`);
    await plain.locator('#menu-toggle').click();
    await plain.locator('#search').fill('ccs03');
    await plain.waitForTimeout(250);
    await plain.keyboard.press('Escape');
    check('GSAP failure preserves drawer, search and visible camera', await plain.locator('.tile').count() === 1 && await plain.locator('.tile').evaluate(el => getComputedStyle(el).opacity === '1'));
    check(`no JavaScript errors: ${JSON.stringify(errors)}`, errors.length === 0);
    fs.writeFileSync('runtime/design-review/premium-results.json', JSON.stringify({ checks, errors }, null, 2));
    console.log(`${checks} redesign checks passed`);
  } finally {
    await browser?.close();
    server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
