const test = require('node:test');
const assert = require('node:assert/strict');
test('export deduplicates cameras and retains shared intersection membership', () => {
  const { exportCatalog } = require('../tools/export-cameras.cjs');
  const data = exportCatalog();
  assert.equal(data.cameras.length, 40);
  assert.deepEqual(data.cameras.find(c => c.id === '13').groups, [4, 5]);
  assert.equal(data.cameras.find(c => c.id === '00').stream_url, 'https://camerai1.iticfoundation.org/hls/ccs00.m3u8');
  assert.equal(data.groups.length, 10);
});
