const {chromium}=require('playwright');
const {createServer}=require('../tools/serve.cjs');
const fs=require('node:fs');
const assert=require('node:assert/strict');
(async()=>{
  const base=process.env.FLOOD_API_URL||'http://127.0.0.1:8100';
  const health=await fetch(base+'/api/flood/health').then(r=>r.json());
  const cameras=await fetch(base+'/api/flood/cameras').then(r=>r.json());
  const server=createServer();await new Promise(r=>server.listen(8000,'127.0.0.1',r));
  const browser=await chromium.launch({headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
    // No mock API routes; public config points at the real local API.
    await page.goto('http://127.0.0.1:8000/#analyst?range=1h');
    await page.waitForFunction(()=>document.querySelector('#analysis-latest').children.length===40);
    const apiUnknown=cameras.cameras.filter(c=>c.reading.status==='unknown').length;
    assert.equal(Number(await page.locator('#summary-unknown').textContent()),apiUnknown);
    fs.mkdirSync('runtime/flood/qa',{recursive:true});await page.screenshot({path:'runtime/flood/qa/analysis-live.png'});
    assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,worker_available:health.worker.available,model_available:health.model.available,cameras:cameras.cameras.length,unknown:apiUnknown}));
  }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
