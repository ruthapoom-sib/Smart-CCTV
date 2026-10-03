const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../scripts/flood-core.js');
test('unknown, future, stale and zero stay distinct', () => {
  assert.equal(core.effective(null, 100000).status, 'unknown');
  const valid = {status:'clear',captured_at:100,water_coverage_pct:0,model_score:.1};
  assert.equal(core.effective(valid, 101000).water_coverage_pct, 0);
  assert.equal(core.effective(valid, 99000).status, 'unknown');
  assert.equal(core.effective(valid, 281000).water_coverage_pct, null);
  assert.equal(core.effective({status:'unconfigured'},100000).status,'unconfigured');
  assert.equal(core.label('active'),'พบน้ำสูง');
});
test('chart paths split at missing data without turning it into zero', () => {
  assert.equal(core.chartSegments([{water_mean_pct:null}], 'water_mean_pct').length,0);
  assert.equal(core.chartSegments([{water_mean_pct:0}], 'water_mean_pct').length,1);
  assert.deepEqual(core.chartSegments([{v:2},{v:null},{v:0}], 'v').map(s=>s.map(p=>p.index)),[[0],[2]]);
});
test('counts use unique camera IDs', () => {
  assert.equal(core.countStatuses([{id:'03',reading:{status:'unknown'}},{id:'03',reading:{status:'unknown'}}],0).unknown,1);
});
