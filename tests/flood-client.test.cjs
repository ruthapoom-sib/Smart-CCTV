const test = require('node:test');
const assert = require('node:assert/strict');
const {create} = require('../scripts/flood-client.js');
test('older responses never replace new status and stop cancels polling', async () => {
  const pending=[], updates=[];
  const client=create({baseUrl:'http://api.local',fetchImpl:()=>new Promise(resolve=>pending.push(resolve)),pollMs:100000});
  client.start(value=>updates.push(value));
  client.refresh();
  pending[1]({ok:true,json:async()=>({cameras:[{id:'new'}]})});
  await new Promise(resolve=>setImmediate(resolve));
  pending[0]({ok:true,json:async()=>({cameras:[{id:'old'}]})});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(updates.length,1); assert.equal(updates[0].cameras[0].id,'new');
  client.stop(); assert.equal(client.running,false);
});
test('API failure invalidates status and authorization is only in headers', async () => {
  let captured;
  const client=create({baseUrl:'https://api.local',fetchImpl:async(url,options)=>{captured={url,options};return {ok:false,status:503};}});
  await assert.rejects(client.request('/api/flood/cameras',{token:'private'}),/API 503/);
  assert.equal(captured.options.headers.Authorization,'Bearer private');
  assert.equal(captured.url.includes('private'),false);
});
