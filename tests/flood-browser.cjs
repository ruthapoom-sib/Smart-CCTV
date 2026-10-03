const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const {createServer}=require('../tools/serve.cjs');
(async()=>{
  const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('https://fonts.googleapis.com/**',r=>r.abort());
    await page.route('https://camerai1.iticfoundation.org/**',r=>r.fulfill({status:503,body:'offline'}));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    assert(await page.locator('#nav-analysis').isVisible(),'Analysis navigation is always visible');
    await page.click('[data-n="all"]');await page.waitForTimeout(500);
    assert.equal(await page.locator('.tile').count(),40);
    const all=await page.evaluate(()=>({active:[...document.querySelectorAll('.tile')].filter(t=>t.dataset.state!=='paused').length,
      width:document.querySelector('.tile').getBoundingClientRect().width,scroll:document.querySelector('#grid').scrollHeight>document.querySelector('#grid').clientHeight}));
    assert(all.active<=9 && all.width>=240 && all.scroll,JSON.stringify(all));
    await page.click('#nav-analysis');await page.locator('#analyst').waitFor({state:'visible'});
    assert.equal(await page.locator('.tile:not([data-state="paused"])').count(),0,'Analysis releases every player');
    await page.click('#nav-live');assert.equal(await page.locator('.tile').count(),40,'Live state survives');
    assert.deepEqual(errors,[]); console.log('PASS Analysis navigation, All sizing and bounded streams, player cleanup');
  } finally {await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
