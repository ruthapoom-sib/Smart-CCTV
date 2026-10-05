const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { createServer } = require('../tools/serve.cjs');

(async () => {
  const server = createServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    await page.route('https://fonts.googleapis.com/**', r => r.abort());
    await page.route('https://camerai1.iticfoundation.org/**', r => r.fulfill({ status: 503, body: 'offline' }));

    const now = Date.now() / 1000;
    const rainSamples = [
      { id: '03', name: 'มุ่งหน้าชลบุรี', groups: [0], reading: { camera_id: '03', status: 'rainy', captured_at: now, processed_at: now, detector_score: 0.85, config_revision: 1, evidence_id: 'e'.repeat(32) } },
      { id: '05', name: 'มุ่งหน้าเมืองฉะเชิงเทรา', groups: [0], reading: { camera_id: '05', status: 'dry', captured_at: now, processed_at: now, detector_score: 0.05, config_revision: 1 } },
      { id: '07', name: 'แยกคอมเพล็กซ์', groups: [1], reading: { camera_id: '07', status: 'unconfigured', captured_at: 0, processed_at: 0, config_revision: 0 } },
    ];

    await page.route('http://127.0.0.1:8100/**', async r => {
      const url = new URL(r.request().url());
      const path = url.pathname;
      let body, status = 200;

      if (path.includes('/rain/health')) {
        body = { api: 'available', worker: { available: true }, target_interval_seconds: 60, fresh_age_seconds: 180 };
      } else if (path.includes('/rain/cameras') && !path.includes('config') && !path.includes('history')) {
        body = { generated_at: now, cameras: rainSamples };
      } else if (path.includes('/rain/analytics')) {
        const cam = url.searchParams.get('camera_id');
        body = {
          start: now - 3600, end: now, bucket_seconds: 300, camera_ids: cam ? [cam] : ['03', '05', '07'],
          buckets: [
            { start: now - 600, end: now - 300, valid_count: 2, unknown_count: 1, monitored_count: 3, rainy_count: 1, dry_count: 1, mean_score: 0.45, max_score: 0.85 },
            { start: now - 300, end: now, valid_count: 2, unknown_count: 1, monitored_count: 3, rainy_count: 1, dry_count: 1, mean_score: 0.45, max_score: 0.85 },
          ]
        };
      } else if (path.includes('/rain/events')) {
        body = {
          items: [
            { id: 'ev1', camera_id: '03', first_detected_at: now - 600, confirmed_at: now - 480, ended_at: null, peak_score: 0.85, start_evidence_id: 'e'.repeat(32) }
          ],
          next_cursor: null
        };
      } else if (path.includes('/flood/')) {
        body = { available: true, cameras: [], buckets: [], items: [] };
      } else {
        body = {};
      }
      return r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    });

    await page.goto(`http://127.0.0.1:${server.address().port}`);

    // Verify live page header redesign
    assert(await page.locator('#nav-live').isVisible(), 'Live tab visible');
    assert(await page.locator('#nav-analysis').isVisible(), 'Analysis tab visible');

    // Wait for tile badges to render
    const tile03 = page.locator('.tile[data-id="03"]');
    await page.waitForFunction(() => {
      const el = document.querySelector('.tile[data-id="03"] .rain-badge');
      return el && el.textContent.includes('ฝนตก');
    });

    const rainBadge03 = tile03.locator('.rain-badge');
    assert.equal(await rainBadge03.getAttribute('data-status'), 'rainy');
    assert((await rainBadge03.textContent()).includes('ฝนตก'));

    const rainBadge05 = page.locator('.tile[data-id="05"] .rain-badge');
    assert.equal(await rainBadge05.getAttribute('data-status'), 'dry');
    assert((await rainBadge05.textContent()).includes('ไม่พบฝน'));

    // Click rain badge to open rain detail dialog
    await rainBadge03.click();
    assert(await page.locator('#rain-detail').isVisible(), 'Rain detail dialog opens');
    assert((await page.locator('#rain-detail-title').textContent()).includes('CCS 03'));
    assert((await page.locator('#rain-detail-copy').textContent()).includes('ฝนตก'));

    // Click history button inside rain detail dialog -> navigates to Analysis with kind=rain
    await page.click('#rain-detail-history');
    await page.locator('#analyst').waitFor({ state: 'visible' });

    assert.equal(await page.locator('#analysis-main-title').textContent(), 'Analysis · ฝนตก');
    assert.equal(await page.locator('#kind-rain').getAttribute('aria-selected'), 'true');
    assert.equal(await page.locator('#analysis-camera').inputValue(), '03');

    // Check rain summary numbers for camera 03
    await page.waitForFunction(() => document.querySelector('#summary-active')?.textContent === '1');
    assert.equal(await page.locator('#summary-active').textContent(), '1');
    assert.equal(await page.locator('#summary-clear').textContent(), '0');

    // Switch camera filter to All cameras and verify overall summary counts
    await page.selectOption('#analysis-camera', '');
    await page.waitForFunction(() => document.querySelector('#summary-clear')?.textContent === '1');
    assert.equal(await page.locator('#summary-active').textContent(), '1');
    assert.equal(await page.locator('#summary-clear').textContent(), '1');
    assert.equal(await page.locator('#summary-unconfigured').textContent(), '1');

    // Switch kind tab to Flood
    await page.click('#kind-flood');
    await page.waitForFunction(() => document.querySelector('#analysis-main-title')?.textContent === 'Analysis · น้ำท่วม');
    assert.equal(await page.locator('#kind-flood').getAttribute('aria-selected'), 'true');

    // Switch back to kind Rain
    await page.click('#kind-rain');
    await page.waitForFunction(() => document.querySelector('#analysis-main-title')?.textContent === 'Analysis · ฝนตก');

    // Check mobile viewport responsiveness
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    assert(noOverflow, 'Mobile viewport must not have horizontal scrollbar');

    await page.click('#menu-toggle');
    await page.click('#nav-live');
    await page.waitForTimeout(300);
    const noOverflowLive = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    assert(noOverflowLive, 'Live mobile view must not have horizontal scrollbar');

    assert.deepEqual(errors, []);
    console.log('PASS Live camera redesign and rain detection browser validation');
    await page.close();
  } finally {
    await browser.close();
    await new Promise(r => server.close(r));
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
